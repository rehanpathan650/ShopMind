import { Router } from "express";
import { q, audit } from "../db.js";
import { wrap, httpError, requireUuid, paging, toCsv } from "../lib/http.js";
import { authenticate, requireScope, csrfGuard } from "../security/auth.js";
import { apiLimiter, chatLimiter } from "../security/middleware.js";
import { generateKey, SCOPES } from "../security/apiKeys.js";
import { tools, catalog } from "../tools/index.js";
import { runRead, runOwnerWrite, stageWrite, resolveAction } from "../actions.js";
import { businessSummary } from "../tools/analytics.js";
import { dues } from "../tools/customers.js";
import { chat } from "../ai/agent.js";

// ==================================================
// AUTHENTICATED API
// Session cookie (dashboard) or `Authorization: Bearer sm_live_...` (API key).
// ==================================================

export const apiRouter = Router();

apiRouter.use(authenticate(), csrfGuard, apiLimiter);

const ownerOnly = (req, _res, next) =>
  req.ctx.via === "session"
    ? next()
    : next(httpError(403, "This endpoint is only available to the logged-in owner"));

// ---------------------------------------------------------------- TOOLS (REST)
apiRouter.get("/tools", (req, res) => {
  res.json({ tools: catalog() });
});

/**
 * Execute any tool by name.
 *  - Read tools: run immediately (needs "read").
 *  - Write tools from the owner's dashboard session: run immediately (the click is approval).
 *  - Write tools from an API key with "write": staged for owner approval (202).
 */
apiRouter.post(
  "/tools/:name",
  requireScope("read"),
  wrap(async (req, res) => {
    const name = req.params.name;
    const tool = tools[name];
    if (!tool) throw httpError(404, `Unknown tool: ${name}`);
    const args = req.body?.args ?? {};

    if (!tool.write) {
      return res.json({ result: await runRead(req.ctx, name, args) });
    }
    if (req.ctx.via === "session") {
      return res.json({ result: await runOwnerWrite(req.ctx, name, args) });
    }
    if (!req.ctx.scopes.includes("write")) {
      throw httpError(403, 'This API key lacks the "write" scope');
    }
    const action = await stageWrite(req.ctx, name, args, "api");
    res.status(202).json({
      status: "pending_approval",
      action_id: action.id,
      summary: action.summary,
      expires_at: action.expires_at,
    });
  })
);

// ---------------------------------------------------------------- AI CHAT
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 6000;
const MAX_TOTAL_LENGTH = 40_000;

const validateMessages = (body) => {
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    throw httpError(400, "messages must be a non-empty array");
  }
  if (body.messages.length > 200) throw httpError(400, "Too many messages");

  let total = 0;
  const messages = body.messages.slice(-MAX_MESSAGES).map((m) => {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      throw httpError(400, "Each message needs a user/assistant role and text content");
    }
    const content = m.content.trim();
    if (!content) throw httpError(400, "Messages cannot be empty");
    if (content.length > MAX_MESSAGE_LENGTH) throw httpError(400, "A message is too long");
    total += content.length;
    return { role: m.role, content };
  });

  if (total > MAX_TOTAL_LENGTH) throw httpError(400, "Conversation is too long; start a new chat");
  // The API requires the first message to be from the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) throw httpError(400, "At least one user message is required");
  return messages;
};

apiRouter.post(
  "/chat",
  ownerOnly,
  chatLimiter,
  wrap(async (req, res) => {
    const messages = validateMessages(req.body);
    res.json(await chat(req.ctx, messages));
  })
);

// ---------------------------------------------------------------- APPROVALS
apiRouter.get(
  "/actions",
  requireScope("read"),
  wrap(async (req, res) => {
    const status = ["pending", "done", "cancelled", "expired"].includes(req.query.status)
      ? req.query.status
      : "pending";
    const rows = await q(
      `SELECT id, tool, args, summary, status, source, created_by, result, created_at, updated_at, expires_at
       FROM pending_actions
       WHERE shop_id = $1 AND status = $2 AND (status <> 'pending' OR expires_at > now())
       ORDER BY created_at DESC LIMIT 100`,
      [req.ctx.shopId, status]
    );
    res.json(rows.map((r) => ({ ...r, destructive: Boolean(tools[r.tool]?.destructive) })));
  })
);

apiRouter.post(
  "/actions/:id/:verb",
  ownerOnly,
  wrap(async (req, res) => {
    const id = requireUuid(req.params.id, "action ID");
    const { verb } = req.params;
    if (!["confirm", "cancel"].includes(verb)) throw httpError(400, "Verb must be confirm or cancel");
    res.json(await resolveAction(req.ctx, id, verb));
  })
);

// ---------------------------------------------------------------- DASHBOARD DATA
apiRouter.get(
  "/overview",
  requireScope("read"),
  wrap(async (req, res) => {
    const [summary, customerDues, lowStock, daily] = await Promise.all([
      businessSummary(req.ctx.shopId),
      dues(req.ctx.shopId, 0),
      runToolData(req.ctx, "low_stock_report"),
      runToolData(req.ctx, "sales_report", { period: "30d" }),
    ]);
    res.json({
      summary,
      dues: customerDues.slice(0, 10),
      low_stock: lowStock,
      sales: daily,
    });
  })
);

// Tool run without audit noise, for dashboard aggregation.
function runToolData(ctx, name, args = {}) {
  return tools[name].run(ctx, tools[name].validator.parse(args));
}

apiRouter.get(
  "/audit",
  requireScope("read"),
  wrap(async (req, res) => {
    const { limit, offset } = paging(req.query, { defaultLimit: 50 });
    const filter = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
    const hideReads = req.query.reads !== "1";
    const rows = await q(
      `SELECT id, actor, event, detail, created_at FROM audit_log
       WHERE shop_id = $1
         AND ($2 = '' OR event ILIKE '%' || $2 || '%')
         AND (NOT $3 OR event NOT LIKE 'read:%')
       ORDER BY id DESC LIMIT $4 OFFSET $5`,
      [req.ctx.shopId, filter, hideReads, limit, offset]
    );
    res.json(rows);
  })
);

// ---------------------------------------------------------------- CSV EXPORT
const EXPORTS = {
  products: `SELECT name, sku, category, unit, qty, price, cost, reorder_level, updated_at
             FROM products WHERE shop_id = $1 ORDER BY name`,
  customers: `SELECT c.name, c.phone, c.email, c.credit_limit,
                     COALESCE(SUM(l.amount), 0) AS balance
              FROM customers c LEFT JOIN ledger l ON l.customer_id = c.id
              WHERE c.shop_id = $1 GROUP BY c.id ORDER BY c.name`,
  sales: `SELECT s.id, s.created_at, s.payment_method, s.total, s.discount, s.status, c.name AS customer
          FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
          WHERE s.shop_id = $1 ORDER BY s.created_at DESC`,
  ledger: `SELECT l.created_at, c.name AS customer, l.kind, l.amount, l.note
           FROM ledger l JOIN customers c ON c.id = l.customer_id
           WHERE l.shop_id = $1 ORDER BY l.created_at DESC`,
  expenses: `SELECT spent_on, category, amount, note FROM expenses
             WHERE shop_id = $1 ORDER BY spent_on DESC`,
};

apiRouter.get(
  "/export/:entity",
  requireScope("read"),
  wrap(async (req, res) => {
    const sql = EXPORTS[req.params.entity];
    if (!sql) throw httpError(404, "Unknown export");
    const rows = await q(sql, [req.ctx.shopId]);
    await audit(req.ctx.shopId, req.ctx.actor, "export", { entity: req.params.entity, rows: rows.length });
    res
      .type("text/csv")
      .set("Content-Disposition", `attachment; filename="shopmind-${req.params.entity}.csv"`)
      .send(toCsv(rows));
  })
);

// ---------------------------------------------------------------- SETTINGS
apiRouter.get(
  "/settings",
  ownerOnly,
  wrap(async (req, res) => {
    const [row] = await q(
      `SELECT name, phone, address, gstin, low_stock_threshold, created_at FROM shops WHERE id = $1`,
      [req.ctx.shopId]
    );
    res.json(row);
  })
);

apiRouter.patch(
  "/settings",
  ownerOnly,
  wrap(async (req, res) => {
    const b = req.body || {};
    const str = (v, max) => (v === undefined ? null : typeof v === "string" && v.trim().length <= max ? v.trim() : undefined);
    const name = str(b.name, 120);
    const phone = str(b.phone, 20);
    const address = str(b.address, 300);
    const gstin = b.gstin === undefined || b.gstin === "" ? null
      : /^[0-9A-Z]{15}$/.test(String(b.gstin).toUpperCase()) ? String(b.gstin).toUpperCase() : undefined;
    const threshold = b.low_stock_threshold === undefined ? null
      : Number.isInteger(b.low_stock_threshold) && b.low_stock_threshold >= 0 && b.low_stock_threshold <= 100000
        ? b.low_stock_threshold : undefined;

    if ([name, phone, address, gstin, threshold].includes(undefined) || name === "") {
      throw httpError(400, "Invalid settings value");
    }

    const [row] = await q(
      `UPDATE shops SET name = COALESCE($2, name), phone = COALESCE($3, phone),
         address = COALESCE($4, address), gstin = COALESCE($5, gstin),
         low_stock_threshold = COALESCE($6, low_stock_threshold)
       WHERE id = $1 RETURNING name, phone, address, gstin, low_stock_threshold`,
      [req.ctx.shopId, name, phone, address, gstin, threshold]
    );
    await audit(req.ctx.shopId, req.ctx.userId, "settings_updated", { fields: Object.keys(b) });
    res.json(row);
  })
);

// ---------------------------------------------------------------- API KEYS
apiRouter.get(
  "/keys",
  ownerOnly,
  wrap(async (req, res) => {
    res.json(
      await q(
        `SELECT id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at
         FROM api_keys WHERE shop_id = $1 ORDER BY created_at DESC`,
        [req.ctx.shopId]
      )
    );
  })
);

apiRouter.post(
  "/keys",
  ownerOnly,
  wrap(async (req, res) => {
    const { name, scopes = ["read"], expires_in_days } = req.body || {};
    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
      throw httpError(400, "Key name is required (max 60 characters)");
    }
    if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => SCOPES.includes(s))) {
      throw httpError(400, `Scopes must be a subset of: ${SCOPES.join(", ")}`);
    }
    if (expires_in_days !== undefined && expires_in_days !== null &&
        !(Number.isInteger(expires_in_days) && expires_in_days >= 1 && expires_in_days <= 365)) {
      throw httpError(400, "expires_in_days must be between 1 and 365");
    }
    const [{ count }] = await q(
      `SELECT COUNT(*) AS count FROM api_keys WHERE shop_id = $1 AND revoked_at IS NULL`,
      [req.ctx.shopId]
    );
    if (count >= 20) throw httpError(409, "Maximum of 20 active keys. Revoke one first.");

    const finalScopes = [...new Set(["read", ...scopes])];
    const { key, prefix, hash } = generateKey();
    const [row] = await q(
      `INSERT INTO api_keys (shop_id, user_id, name, prefix, key_hash, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END)
       RETURNING id, name, prefix, scopes, expires_at, created_at`,
      [req.ctx.shopId, req.ctx.userId, name.trim(), prefix, hash, finalScopes, expires_in_days ?? null]
    );
    await audit(req.ctx.shopId, req.ctx.userId, "api_key_created", { id: row.id, name: row.name, scopes: finalScopes });
    // The plaintext key is returned exactly once.
    res.status(201).json({ ...row, key });
  })
);

apiRouter.delete(
  "/keys/:id",
  ownerOnly,
  wrap(async (req, res) => {
    const id = requireUuid(req.params.id, "key ID");
    const [row] = await q(
      `UPDATE api_keys SET revoked_at = now()
       WHERE id = $1 AND shop_id = $2 AND revoked_at IS NULL RETURNING id, name`,
      [id, req.ctx.shopId]
    );
    if (!row) throw httpError(404, "Key not found or already revoked");
    await audit(req.ctx.shopId, req.ctx.userId, "api_key_revoked", { id, name: row.name });
    res.json({ ok: true });
  })
);
