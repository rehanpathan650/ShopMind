import { q, audit, withTransaction } from "./db.js";
import { config } from "./config.js";
import { parseArgs } from "./tools/index.js";
import { httpError } from "./lib/http.js";

// ==================================================
// TOOL EXECUTION ENGINE
//
// Reads run immediately. Writes follow "agents propose, humans approve":
//   - AI chat and API-key/MCP callers can only STAGE a write.
//   - The shop owner confirms it from the dashboard; it then runs in a
//     transaction together with its audit entry.
//   - Direct owner actions from the dashboard UI (session auth) run at once,
//     because the click itself is the human approval.
// ==================================================

const serialize = (output) =>
  typeof output === "string" ? output : JSON.stringify(output);

/**
 * Run a read tool.
 */
export const runRead = async (ctx, name, rawArgs) => {
  const { tool, args } = parseArgs(name, rawArgs);
  if (tool.write) throw httpError(400, `${name} changes data; it cannot run as a read.`);
  const output = await tool.run(ctx, args);
  await audit(ctx.shopId, ctx.actor || "system", `read:${name}`, { args, via: ctx.via });
  return output;
};

/**
 * Stage a write for owner approval. Returns { id, summary }.
 */
export const stageWrite = async (ctx, name, rawArgs, source) => {
  const { tool, args } = parseArgs(name, rawArgs);
  if (!tool.write) throw httpError(400, `${name} is a read tool; nothing to stage.`);

  const summary = tool.summary(args);
  if (typeof summary !== "string" || !summary.trim() || summary.length > 1000) {
    throw httpError(500, "Invalid action summary");
  }

  const action = await withTransaction(async (client) => {
    const [row] = await q(
      `INSERT INTO pending_actions
         (shop_id, tool, args, summary, status, source, created_by, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, now() + make_interval(hours => $7))
       RETURNING id, summary, tool, created_at, expires_at`,
      [ctx.shopId, name, args, summary, source, ctx.actor || "ai", config.limits.pendingActionTtlHours],
      client
    );
    await audit(ctx.shopId, source === "chat" ? "ai" : ctx.actor, `staged:${name}`,
      { actionId: row.id, args, summary }, client);
    return row;
  });

  ctx.pending?.push({
    id: action.id,
    summary,
    tool: name,
    destructive: Boolean(tool.destructive),
  });
  return action;
};

/**
 * Run a write immediately on behalf of the logged-in owner (dashboard forms).
 */
export const runOwnerWrite = async (ctx, name, rawArgs) => {
  if (ctx.via !== "session") throw httpError(403, "Only the shop owner can run changes directly.");
  const { tool, args } = parseArgs(name, rawArgs);
  if (!tool.write) return runRead(ctx, name, args);

  return withTransaction(async (client) => {
    const output = await tool.run(ctx, args, client);
    await audit(ctx.shopId, ctx.userId, `run:${name}`,
      { args, summary: tool.summary(args), result: serialize(output).slice(0, 2000) }, client);
    return output;
  });
};

/**
 * Confirm or cancel a staged action. Row lock prevents double execution.
 */
export const resolveAction = async (ctx, id, verb) => {
  return withTransaction(async (client) => {
    const [action] = await q(
      `SELECT id, tool, args, summary, status, expires_at
       FROM pending_actions
       WHERE id = $1 AND shop_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [id, ctx.shopId],
      client
    );
    if (!action) throw httpError(404, "Action not found or already handled");

    if (new Date(action.expires_at) < new Date()) {
      await q(`UPDATE pending_actions SET status = 'expired', updated_at = now() WHERE id = $1`, [id], client);
      throw httpError(410, "This action expired. Ask again to re-create it.");
    }

    let result = "Cancelled.";
    if (verb === "confirm") {
      // Re-validate stored args against the current schema before running.
      const { tool, args } = parseArgs(action.tool, action.args);
      if (!tool.write) throw httpError(400, "Invalid pending action");
      result = await tool.run(ctx, args, client);
    }

    const resultText = serialize(result);
    await q(
      `UPDATE pending_actions SET status = $2, result = $3, updated_at = now() WHERE id = $1`,
      [id, verb === "confirm" ? "done" : "cancelled", resultText.slice(0, 4000)],
      client
    );
    await audit(ctx.shopId, ctx.userId, `${verb}:${action.tool}`,
      { actionId: id, summary: action.summary, result: resultText.slice(0, 2000) }, client);

    return { result, summary: action.summary };
  });
};

/**
 * Mark stale pending actions as expired (runs periodically).
 */
export const expireStaleActions = () =>
  q(`UPDATE pending_actions SET status = 'expired', updated_at = now()
     WHERE status = 'pending' AND expires_at <= now()`);
