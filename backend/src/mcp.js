import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tools } from "./tools.js";
import { q, audit } from "./db.js";

// One MCP server per request, bound to the authenticated shop.
function buildServer(ctx) {
  const s = new McpServer({ name: "shopmind", version: "1.0.0" });
  for (const [name, t] of Object.entries(tools)) {
    s.registerTool(name, { description: t.desc, inputSchema: t.schema }, async (args) => {
      let out;
      if (t.write) { // writes are only STAGED; the owner confirms in the UI
        const summary = t.summary(args);
        const [p] = await q("INSERT INTO pending_actions(shop_id,tool,args,summary) VALUES($1,$2,$3,$4) RETURNING id", [ctx.shopId, name, args, summary]);
        ctx.pending.push({ id: p.id, summary });
        await audit(ctx.shopId, "ai", `staged:${name}`, args);
        out = `NOT EXECUTED. Staged for owner confirmation: ${summary}. Ask the owner to confirm.`;
      } else {
        out = await t.run(ctx, args);
        await audit(ctx.shopId, "ai", `read:${name}`, args);
      }
      return { content: [{ type: "text", text: out }] };
    });
  }
  return s;
}

export async function connect(ctx) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(ctx).connect(st);
  const c = new Client({ name: "shopmind-chat", version: "1.0.0" });
  await c.connect(ct);
  return c;
}
