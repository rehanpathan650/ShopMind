import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Anthropic from "@anthropic-ai/sdk";
import { q, audit, migrate } from "./db.js";
import { tools, dues, stock } from "./tools.js";
import { connect } from "./mcp.js";

const SECRET = process.env.JWT_SECRET || "dev-secret";
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const ai = new Anthropic();
const SYSTEM = `You are ShopMind, an assistant for an Indian shop owner. Use the tools for every fact; never invent numbers.
Amounts are in rupees. Tools that change data are only staged and need the owner's confirmation, so say so. Reply briefly and plainly, like texting.`;

const app = express();
app.use(cors(), express.json());
const wrap = (f) => (req, res) => f(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

const auth = (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || "").slice(7), SECRET);
    req.ctx = { shopId: p.shop, userId: p.user, pending: [] };
    next();
  } catch { res.status(401).json({ error: "Please log in again" }); }
};
const token = (shop, user) => jwt.sign({ shop, user }, SECRET, { expiresIn: "7d" });

async function seed(shop) {
  for (const [n, a] of [["Sharma Traders", 18500], ["Patil Constructions", 12000], ["Kale Hardware", 4200]]) {
    const [c] = await q("INSERT INTO customers(shop_id,name) VALUES($1,$2) RETURNING id", [shop, n]);
    await q("INSERT INTO ledger(shop_id,customer_id,amount,note) VALUES($1,$2,$3,'opening balance')", [shop, c.id, a]);
  }
  for (const [n, k] of [["Cement bags", 70], ["TMT steel rods", 240], ["PVC pipes", 85]])
    await q("INSERT INTO products(shop_id,name,qty) VALUES($1,$2,$3)", [shop, n, k]);
}

app.post("/api/auth/register", wrap(async (req, res) => {
  const { shop, email, password, demo } = req.body;
  if (!shop || !email || (password || "").length < 6) return res.status(400).json({ error: "Shop name, email and a 6+ character password are required" });
  if ((await q("SELECT 1 FROM users WHERE email=$1", [email]))[0]) return res.status(409).json({ error: "Email already registered" });
  const [s] = await q("INSERT INTO shops(name) VALUES($1) RETURNING id", [shop]);
  const [u] = await q("INSERT INTO users(shop_id,email,password_hash) VALUES($1,$2,$3) RETURNING id", [s.id, email, await bcrypt.hash(password, 10)]);
  if (demo) await seed(s.id);
  res.json({ token: token(s.id, u.id), shop });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const [u] = await q("SELECT u.id,u.shop_id,u.password_hash,s.name FROM users u JOIN shops s ON s.id=u.shop_id WHERE email=$1", [req.body.email]);
  if (!u || !(await bcrypt.compare(req.body.password || "", u.password_hash))) return res.status(401).json({ error: "Wrong email or password" });
  res.json({ token: token(u.shop_id, u.id), shop: u.name });
}));

app.post("/api/chat", auth, wrap(async (req, res) => {
  const mcp = await connect(req.ctx);
  try {
    const defs = (await mcp.listTools()).tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const msgs = req.body.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    for (let i = 0; i < 6; i++) {
      const r = await ai.messages.create({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: defs, messages: msgs });
      const uses = r.content.filter((b) => b.type === "tool_use");
      if (!uses.length) return res.json({ reply: r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), pending: req.ctx.pending });
      msgs.push({ role: "assistant", content: r.content });
      const results = [];
      for (const u of uses) {
        const o = await mcp.callTool({ name: u.name, arguments: u.input });
        results.push({ type: "tool_result", tool_use_id: u.id, content: o.content[0].text });
      }
      msgs.push({ role: "user", content: results });
    }
    res.json({ reply: "That took too many steps. Try asking more simply.", pending: req.ctx.pending });
  } finally { await mcp.close(); }
}));

app.post("/api/actions/:id/:verb", auth, wrap(async (req, res) => {
  const { id, verb } = req.params;
  const status = verb === "confirm" ? "done" : "cancelled";
  // Atomic claim: an action can be confirmed once, and only by the shop that owns it.
  const [p] = await q("UPDATE pending_actions SET status=$3 WHERE id=$1 AND shop_id=$2 AND status='pending' RETURNING tool,args,summary", [id, req.ctx.shopId, status]);
  if (!p) return res.status(404).json({ error: "Action not found or already handled" });
  const result = verb === "confirm" ? await tools[p.tool].run(req.ctx, p.args) : "Cancelled.";
  await audit(req.ctx.shopId, req.ctx.userId, `${verb}:${p.tool}`, { summary: p.summary, result });
  res.json({ result });
}));

app.get("/api/overview", auth, wrap(async (req, res) => res.json({ dues: await dues(req.ctx.shopId), stock: await stock(req.ctx.shopId) })));
app.get("/api/audit", auth, wrap(async (req, res) =>
  res.json(await q("SELECT actor,event,detail,created_at FROM audit_log WHERE shop_id=$1 ORDER BY id DESC LIMIT 30", [req.ctx.shopId]))));
app.get("/health", (_, res) => res.send("ok"));

await migrate();
app.listen(4000, () => console.log("ShopMind API on :4000"));
