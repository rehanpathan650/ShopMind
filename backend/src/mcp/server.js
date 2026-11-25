import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { tools } from "../tools/index.js";
import { runRead, stageWrite } from "../actions.js";
import { businessSummary } from "../tools/analytics.js";
import { q } from "../db.js";

const SERVER_INFO = { name: "shopmind", version: "2.0.0" };

const INSTRUCTIONS = `ShopMind exposes one shop's inventory, customers, credit ledger, sales,
expenses and suppliers. Read tools return live data. Write tools never execute directly:
they stage a pending action that the shop owner must approve in the ShopMind dashboard.
Always tell the user that a staged change still needs approval.`;

/**
 * Turn a thrown error into a message safe to show the model/client.
 */
const safeMessage = (error) => {
  if (error?.expose || (error?.status && error.status < 500)) return error.message;
  console.error("MCP tool execution failed:", error);
  return "The operation could not be completed. Please try again.";
};

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/**
 * Build an MCP server scoped to one authenticated shop.
 *
 * @param ctx      Authenticated context { shopId, userId, scopes, actor, pending }
 * @param source   "chat" (in-app assistant) or "mcp" (remote client)
 */
export function buildServer(ctx, { source = "chat" } = {}) {
  if (!ctx?.shopId || !ctx?.userId) throw new Error("Invalid authenticated shop context");

  const canWrite = ctx.scopes?.includes("write");
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  // ---------------------------------------------------------------- TOOLS
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.write && !canWrite) continue; // read-only credentials never see write tools

    server.registerTool(
      name,
      {
        title: name.replace(/_/g, " "),
        description: tool.write
          ? `${tool.desc} [Requires owner approval: this call only stages the change.]`
          : tool.desc,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: !tool.write,
          destructiveHint: Boolean(tool.destructive),
          idempotentHint: !tool.write,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          if (tool.write) {
            const action = await stageWrite(ctx, name, args, source);
            return text(
              `NOT EXECUTED YET. Staged for owner approval (action ${action.id}): ${action.summary}. ` +
                "The owner must confirm it in ShopMind before it takes effect."
            );
          }
          return text(await runRead(ctx, name, args));
        } catch (error) {
          return { ...text(safeMessage(error)), isError: true };
        }
      }
    );
  }

  // ---------------------------------------------------------------- RESOURCES
  server.registerResource(
    "shop-summary",
    "shopmind://summary",
    { title: "Business summary", description: "Live KPIs for the shop", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await businessSummary(ctx.shopId)) }],
    })
  );

  server.registerResource(
    "inventory",
    "shopmind://inventory",
    { title: "Inventory", description: "All products with stock and prices", mimeType: "application/json" },
    async (uri) => {
      const rows = await q(
        `SELECT name, sku, category, unit, qty, price, cost FROM products WHERE shop_id = $1 ORDER BY name`,
        [ctx.shopId]
      );
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(rows) }] };
    }
  );

  server.registerResource(
    "pending-approvals",
    "shopmind://approvals",
    { title: "Pending approvals", description: "Changes waiting for owner approval", mimeType: "application/json" },
    async (uri) => {
      const rows = await q(
        `SELECT id, tool, summary, source, created_at, expires_at FROM pending_actions
         WHERE shop_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at DESC`,
        [ctx.shopId]
      );
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(rows) }] };
    }
  );

  // ---------------------------------------------------------------- PROMPTS
  server.registerPrompt(
    "daily_briefing",
    { title: "Daily briefing", description: "Morning summary: sales, dues, low stock, to-dos" },
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Give me my daily shop briefing. Use business_summary, low_stock_report and dues_aging, then list the 3 most important things I should do today.",
        },
      }],
    })
  );

  server.registerPrompt(
    "collections_plan",
    {
      title: "Collections plan",
      description: "Plan which customers to chase for payment",
      argsSchema: { min_amount: z.string().optional() },
    },
    ({ min_amount }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Build a collections plan for customers owing more than ₹${min_amount || "0"}. Use dues_aging and customer_insights, prioritise by amount and age, and draft a reminder for the top 3 with draft_reminder_message.`,
        },
      }],
    })
  );

  server.registerPrompt(
    "restock_plan",
    { title: "Restock plan", description: "What to reorder and from whom" },
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Use low_stock_report, top_products and list_suppliers to build a restock plan with quantities and estimated cost.",
        },
      }],
    })
  );

  return server;
}

// ==================================================
// IN-PROCESS CLIENT (used by the in-app AI assistant)
// ==================================================

export async function connect(ctx) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(ctx, { source: "chat" });
  const client = new Client({ name: "shopmind-chat", version: SERVER_INFO.version });

  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }

  return {
    listTools: () => client.listTools(),
    callTool: (params) => client.callTool(params),
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

// ==================================================
// REMOTE MCP (Streamable HTTP, stateless, API-key authenticated)
// ==================================================

export async function handleRemoteMcp(req, res) {
  const server = buildServer(req.ctx, { source: "mcp" });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.once("close", () => {
    Promise.allSettled([transport.close(), server.close()]);
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
