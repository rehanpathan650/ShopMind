import { z } from "zod";
import { inventoryTools } from "./inventory.js";
import { customerTools } from "./customers.js";
import { salesTools } from "./sales.js";
import { expenseTools } from "./expenses.js";
import { supplierTools } from "./suppliers.js";
import { analyticsTools } from "./analytics.js";

// ==================================================
// TOOL REGISTRY
// Single source of truth used by the AI chat, the MCP server and the REST API.
//
// Tool shape:
//   category  - grouping for docs/UI
//   desc      - description shown to the model
//   schema    - zod raw shape for arguments
//   write     - true if it changes data (requires approval when AI/API-initiated)
//   destructive - true if it deletes or voids data
//   summary(args) - one-line human description of a write
//   run(ctx, args, executor?) - performs the work, returns object | string
// ==================================================

const modules = [
  inventoryTools,
  customerTools,
  salesTools,
  expenseTools,
  supplierTools,
  analyticsTools,
];

export const tools = Object.freeze(Object.assign({}, ...modules));

// Validate the registry at boot so misconfigured tools fail fast.
for (const [name, tool] of Object.entries(tools)) {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) throw new Error(`Bad tool name: ${name}`);
  if (!tool.desc || !tool.schema || typeof tool.run !== "function") {
    throw new Error(`Invalid tool definition: ${name}`);
  }
  if (tool.write && typeof tool.summary !== "function") {
    throw new Error(`Write tool missing summary(): ${name}`);
  }
  tool.validator = z.object(tool.schema).strict();
}

/**
 * Validate raw arguments for a tool. Throws a 400 with readable issues.
 */
export const parseArgs = (name, raw) => {
  const tool = tools[name];
  if (!tool) {
    const error = new Error(`Unknown tool: ${name}`);
    error.status = 404;
    error.expose = true;
    throw error;
  }
  const result = tool.validator.safeParse(raw ?? {});
  if (!result.success) {
    const error = new Error(
      "Invalid arguments: " +
        result.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
    );
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return { tool, args: result.data };
};

/**
 * Public catalog (no functions) for docs, the developer page and GET /api/tools.
 */
export const catalog = () =>
  Object.entries(tools).map(([name, t]) => ({
    name,
    category: t.category,
    description: t.desc,
    write: Boolean(t.write),
    destructive: Boolean(t.destructive),
    input_schema: z.toJSONSchema(t.validator),
  }));
