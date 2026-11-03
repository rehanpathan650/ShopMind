
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Anthropic from "@anthropic-ai/sdk";

import {
  q,
  audit,
  migrate,
  withTransaction,
  closeDatabase,
} from "./db.js";

import { tools, dues, stock } from "./tools.js";
import { connect, handleRemoteMcp } from "./mcp.js";

// ==================================================
// CONFIGURATION
// ==================================================

const SECRET = process.env.JWT_SECRET;

if (!SECRET || SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}

const AI_PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();

const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ||
  process.env.MODEL ||
  "claude-sonnet-5-5";

const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

const MAX_TOOL_ROUNDS = 6;
const MAX_CHAT_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_TOTAL_MESSAGE_LENGTH = 30000;

const PORT = Number.parseInt(process.env.PORT || "4000", 10);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid port number");
}

if (!["anthropic", "groq"].includes(AI_PROVIDER)) {
  throw new Error(`Unsupported AI_PROVIDER: ${AI_PROVIDER}`);
}

if (AI_PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY must be configured");
}

if (AI_PROVIDER === "groq" && !process.env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY must be configured");
}

const ai =
  AI_PROVIDER === "anthropic"
    ? new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: 60000,
        maxRetries: 2,
      })
    : null;

const SYSTEM = `
You are ShopMind, an assistant for an Indian shop owner.

RULES:
1. Use the available tools to retrieve business facts. Never invent numbers,
   customer balances, product quantities, or transaction results.
2. All monetary amounts are in Indian rupees (INR).
3. Read operations can be executed directly.
4. Data-changing operations are staged for owner confirmation.
5. Never claim a write operation has been completed merely because it was staged.
6. Clearly tell the owner when an action needs confirmation.
7. Never claim that a payment reminder was actually sent unless the messaging
   integration confirms delivery.
8. Keep responses brief, clear, and conversational.
9. For stock removal, use remove_stock with the requested quantity.
10. If the owner asks to remove ALL stock, use clear_stock.
11. If the owner asks to set stock to a specific quantity, use adjust_stock.
12. Never guess a product's current quantity. Use get_stock when needed.
13. Never claim an inventory change is complete before owner confirmation.
14. When calling an inventory write tool, always use the exact product name
    from get_stock or the exact name explicitly provided by the owner.
15. Never use generic placeholders such as "product", "item", or "unknown"
    as product names.
16. If the owner selects one product from a list, use that exact product name.
17. If the product identity is unclear, ask the owner to clarify instead
    of staging an inventory action.
18. Never stage a stock operation with guessed or placeholder arguments.
`;

// ==================================================
// EXPRESS APP
// ==================================================

const app = express();

app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Configure allowed frontend origins.
// Example:
// CORS_ORIGINS=https://shopmind-frontend.vercel.app,http://localhost:5173

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.CORS_ORIGIN ||
  ""
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must be configured in production");
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients that do not send an Origin header.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    exposedHeaders: ["Mcp-Session-Id"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
  })
);

app.use(express.json({ limit: "1mb" }));

// ==================================================
// ERROR HANDLING
// ==================================================

const wrap = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch((error) => {
      console.error("Request error:", error);

      if (res.headersSent) {
        return next(error);
      }

      const status =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 600
          ? error.status
          : 500;

      res.status(status).json({
        error:
          status >= 500
            ? "Internal server error"
            : error.message,
      });
    });

// Handle malformed JSON and other Express middleware errors.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }

  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  console.error("Express middleware error:", error);

  return res.status(error.status || 500).json({
    error: error.status && error.status < 500
      ? error.message
      : "Internal server error",
  });
});

// ==================================================
// VALIDATION HELPERS
// ==================================================

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const isValidEmail = (email) =>
  typeof email === "string" &&
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const normalizeEmail = (email) => email.trim().toLowerCase();

const isValidUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

// ==================================================
// AUTHENTICATION
// ==================================================

const auth = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      throw new Error("Missing bearer token");
    }

    const encodedToken = header.slice(7).trim();

    if (!encodedToken) {
      throw new Error("Missing bearer token");
    }

    const payload = jwt.verify(encodedToken, SECRET, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload !== "object" ||
      !isValidUuid(payload.shop) ||
      !isValidUuid(payload.user)
    ) {
      throw new Error("Invalid token payload");
    }

    req.ctx = {
      shopId: payload.shop,
      userId: payload.user,
      pending: [],
    };

    next();
  } catch {
    res.status(401).json({ error: "Please log in again" });
  }
};

const token = (shop, user) =>
  jwt.sign(
    { shop, user },
    SECRET,
    {
      algorithm: "HS256",
      expiresIn: "7d",
    }
  );

// ==================================================
// DEMO DATA
// ==================================================

async function seed(shop, client) {
  const customers = [
    ["Sharma Traders", 18500],
    ["Patil Constructions", 12000],
    ["Kale Hardware", 4200],
  ];

  for (const [name, amount] of customers) {
    const [customer] = await q(
      `INSERT INTO customers (shop_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [shop, name],
      client
    );

    await q(
      `INSERT INTO ledger (shop_id, customer_id, amount, note)
       VALUES ($1, $2, $3, $4)`,
      [shop, customer.id, amount, "opening balance"],
      client
    );
  }

  const products = [
    ["Cement bags", 70],
    ["TMT steel rods", 240],
    ["PVC pipes", 85],
  ];

  for (const [name, quantity] of products) {
    await q(
      `INSERT INTO products (shop_id, name, qty)
       VALUES ($1, $2, $3)`,
      [shop, name, quantity],
      client
    );
  }
}

// ==================================================
// CHAT MESSAGE VALIDATION
// ==================================================

function getChatMessages(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createHttpError(400, "Invalid request body");
  }

  if (!Array.isArray(body.messages)) {
    throw createHttpError(400, "messages must be an array");
  }

  if (body.messages.length === 0) {
    throw createHttpError(400, "At least one message is required");
  }

  if (body.messages.length > 100) {
    throw createHttpError(400, "Too many messages");
  }

  const messages = body.messages.slice(-MAX_CHAT_MESSAGES);

  let totalLength = 0;

  const validated = messages.map((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      throw createHttpError(
        400,
        "Each message must have a user/assistant role and text content"
      );
    }

    const content = message.content.trim();

    if (!content) {
      throw createHttpError(400, "Messages cannot be empty");
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      throw createHttpError(400, "A message is too long");
    }

    totalLength += content.length;

    return {
      role: message.role,
      content,
    };
  });

  if (totalLength > MAX_TOTAL_MESSAGE_LENGTH) {
    throw createHttpError(400, "Conversation is too long");
  }

  if (!validated.some((message) => message.role === "user")) {
    throw createHttpError(400, "At least one user message is required");
  }

  return validated;
}

// ==================================================
// MCP TOOL DEFINITIONS
// ==================================================

function getAnthropicToolDefinitions(toolsFromMcp) {
  return toolsFromMcp.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || {
      type: "object",
      properties: {},
    },
  }));
}

function getGroqToolDefinitions(toolsFromMcp) {
  return toolsFromMcp.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
      },
    },
  }));
}

// ==================================================
// MCP TOOL EXECUTION HELPERS
// ==================================================

function getToolOutput(result) {
  const content = (result.content || [])
    .map((item) => {
      if (item.type === "text") {
        return item.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");

  if (result.isError) {
    return `Tool execution error: ${content || "Unknown tool error"}`;
  }

  return content || "No result returned.";
}

function validateToolCall(name, allowedTools) {
  if (typeof name !== "string" || !allowedTools.has(name)) {
    throw createHttpError(400, `Unsupported tool requested: ${name}`);
  }
}

function parseToolArguments(rawArguments, name) {
  let args;

  try {
    args =
      typeof rawArguments === "string"
        ? JSON.parse(rawArguments || "{}")
        : rawArguments;
  } catch {
    throw new Error(`Invalid arguments returned for tool: ${name}`);
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Invalid argument format for tool: ${name}`);
  }

  return args;
}

// ==================================================
// GROQ TOOL-CALLING LOOP
// ==================================================

async function runGroq(messages, defs, mcp) {
  const groqTools = getGroqToolDefinitions(defs);
  const allowedTools = new Set(defs.map((tool) => tool.name));

  const conversation = [
    { role: "system", content: SYSTEM },
    ...messages,
  ];

  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: conversation,
          tools: groqTools,
          tool_choice: "auto",
          max_tokens: 1024,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("Invalid response received from Groq");
    }

    if (!response.ok) {
      console.error("Groq API error:", {
        status: response.status,
        message: data.error?.message,
      });

      throw new Error(
        data.error?.message || `Groq API error: ${response.status}`
      );
    }

    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("Groq returned an empty response");
    }

    const calls = assistantMessage.tool_calls || [];

    if (calls.length === 0) {
      return assistantMessage.content || "";
    }

    // Preserve the assistant's tool-call message in conversation history.
    conversation.push(assistantMessage);

    for (const call of calls) {
      const name = call.function?.name;

      validateToolCall(name, allowedTools);

      if (!call.id) {
        throw new Error("Groq returned a tool call without an ID");
      }

      const args = parseToolArguments(
        call.function?.arguments,
        name
      );

      let output;

      try {
        const result = await mcp.callTool({
          name,
          arguments: args,
        });

        output = getToolOutput(result);
      } catch (error) {
        console.error(`Groq tool execution failed (${name}):`, error);
        output = `Tool execution error: ${error.message}`;
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
  }

  return "That took too many steps. Try asking more simply.";
}

// ==================================================
// ANTHROPIC TOOL-CALLING LOOP
// ==================================================

async function runAnthropic(messages, defs, mcp) {
  const conversation = [...messages];

  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    const result = await ai.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: getAnthropicToolDefinitions(defs),
      messages: conversation,
    });

    const toolCalls = result.content.filter(
      (block) => block.type === "tool_use"
    );

    if (toolCalls.length === 0) {
      return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }

    conversation.push({
      role: "assistant",
      content: result.content,
    });

    const toolResults = [];

    for (const call of toolCalls) {
      validateToolCall(
        call.name,
        new Set(defs.map((tool) => tool.name))
      );

      let content;
      let isError = false;

      try {
        const output = await mcp.callTool({
          name: call.name,
          arguments: call.input,
        });

        content = getToolOutput(output);
        isError = Boolean(output.isError);
      } catch (error) {
        console.error(
          `Anthropic tool execution failed (${call.name}):`,
          error
        );

        content = `Tool execution error: ${error.message}`;
        isError = true;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content,
        is_error: isError,
      });
    }

    conversation.push({
      role: "user",
      content: toolResults,
    });
  }

  return "That took too many steps. Try asking more simply.";
}

// ==================================================
// AUTH: REGISTER
// ==================================================

app.post(
  "/api/auth/register",
  wrap(async (req, res) => {
    const { shop, email, password, demo = false } = req.body || {};

    if (
      typeof shop !== "string" ||
      !shop.trim() ||
      shop.trim().length > 120
    ) {
      return res.status(400).json({
        error: "A valid shop name is required (maximum 120 characters)",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "A valid email address is required",
      });
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        error: "Password must contain between 8 and 128 characters",
      });
    }

    if (typeof demo !== "boolean") {
      return res.status(400).json({
        error: "demo must be a boolean",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const shopName = shop.trim();

    try {
      const account = await withTransaction(async (client) => {
        const [existing] = await q(
          "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
          [normalizedEmail],
          client
        );

        if (existing) {
          throw createHttpError(409, "Email already registered");
        }

        const [newShop] = await q(
          `INSERT INTO shops (name)
           VALUES ($1)
           RETURNING id`,
          [shopName],
          client
        );

        const passwordHash = await bcrypt.hash(password, 12);

        const [newUser] = await q(
          `INSERT INTO users (shop_id, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [newShop.id, normalizedEmail, passwordHash],
          client
        );

        if (demo) {
          await seed(newShop.id, client);
        }

        await audit(
          newShop.id,
          newUser.id,
          "account_registered",
          { demo },
          client
        );

        return {
          shopId: newShop.id,
          userId: newUser.id,
        };
      });

      return res.status(201).json({
        token: token(account.shopId, account.userId),
        shop: shopName,
      });
    } catch (error) {
      // Protect against simultaneous registration requests.
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Email already registered",
        });
      }

      throw error;
    }
  })
);

// ==================================================
// AUTH: LOGIN
// ==================================================

app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const { email, password } = req.body || {};

    if (!isValidEmail(email) || typeof password !== "string") {
      return res.status(400).json({
        error: "Valid email and password are required",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const [user] = await q(
      `SELECT
         u.id,
         u.shop_id,
         u.password_hash,
         s.name
       FROM users u
       JOIN shops s ON s.id = u.shop_id
       WHERE lower(u.email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: "Wrong email or password",
      });
    }

    await audit(
      user.shop_id,
      user.id,
      "account_login",
      {}
    );

    return res.json({
      token: token(user.shop_id, user.id),
      shop: user.name,
    });
  })
);

// ==================================================
// AI CHAT
// ==================================================

app.post(
  "/api/chat",
  auth,
  wrap(async (req, res) => {
    const messages = getChatMessages(req.body);

    const mcp = await connect(req.ctx);

    try {
      const defs = (await mcp.listTools()).tools;

      let reply;

      if (AI_PROVIDER === "groq") {
        reply = await runGroq(messages, defs, mcp);
      } else {
        reply = await runAnthropic(messages, defs, mcp);
      }

      return res.json({
        reply,
        pending: req.ctx.pending,
      });
    } finally {
      try {
        await mcp.close();
      } catch (error) {
        console.error("Failed to close MCP client:", error);
      }
    }
  })
);

// ==================================================
// REMOTE MCP ENDPOINT
// ==================================================

// Uses the same verified ShopMind JWT.
// Remote MCP connections expose read-only tools.

app.post(
  "/mcp",
  auth,
  async (req, res) => {
    try {
      await handleRemoteMcp(req, res);
    } catch (error) {
      console.error("Remote MCP error:", error);

      if (!res.headersSent) {
        res.status(500).json({
          error: "MCP request failed",
        });
      }
    }
  }
);

app.get(
  "/mcp",
  auth,
  (_, res) => res.status(405).set("Allow", "POST").end()
);

app.delete(
  "/mcp",
  auth,
  (_, res) => res.status(405).set("Allow", "POST").end()
);

// ==================================================
// ACTION CONFIRMATION / CANCELLATION
// ==================================================

app.post(
  "/api/actions/:id/:verb",
  auth,
  wrap(async (req, res) => {
    const { id, verb } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: "Invalid action ID",
      });
    }

    if (!["confirm", "cancel"].includes(verb)) {
      return res.status(400).json({
        error: "Action must be confirmed or cancelled",
      });
    }

    const response = await withTransaction(async (client) => {
      // Lock the pending action so concurrent requests cannot
      // execute the same operation twice.
      const [pendingAction] = await q(
        `SELECT id, tool, args, summary, status
         FROM pending_actions
         WHERE id = $1
           AND shop_id = $2
           AND status = 'pending'
         FOR UPDATE`,
        [id, req.ctx.shopId],
        client
      );

      if (!pendingAction) {
        throw createHttpError(
          404,
          "Action not found or already handled"
        );
      }

      let result;

      if (verb === "confirm") {
        const tool = tools[pendingAction.tool];

        if (
          !tool ||
          !tool.write ||
          typeof tool.run !== "function"
        ) {
          throw new Error("Invalid or unsupported pending action");
        }

        // IMPORTANT:
        // tools.js must accept the transaction client as its third argument
        // and pass it to all database queries made by this operation.
        result = await tool.run(
          req.ctx,
          pendingAction.args,
          client
        );
      } else {
        result = "Cancelled.";
      }

      const newStatus = verb === "confirm" ? "done" : "cancelled";

      await q(
        `UPDATE pending_actions
         SET status = $3,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
        [id, req.ctx.shopId, newStatus],
        client
      );

      await audit(
        req.ctx.shopId,
        req.ctx.userId,
        `${verb}:${pendingAction.tool}`,
        {
          actionId: id,
          summary: pendingAction.summary,
          result,
        },
        client
      );

      return { result };
    });

    return res.json(response);
  })
);

// ==================================================
// BUSINESS OVERVIEW
// ==================================================

app.get(
  "/api/overview",
  auth,
  wrap(async (req, res) => {
    const [customerDues, productStock] = await Promise.all([
      dues(req.ctx.shopId),
      stock(req.ctx.shopId),
    ]);

    return res.json({
      dues: customerDues,
      stock: productStock,
    });
  })
);

// ==================================================
// AUDIT LOG
// ==================================================

app.get(
  "/api/audit",
  auth,
  wrap(async (req, res) => {
    const logs = await q(
      `SELECT actor, event, detail, created_at
       FROM audit_log
       WHERE shop_id = $1
       ORDER BY id DESC
       LIMIT 30`,
      [req.ctx.shopId]
    );

    return res.json(logs);
  })
);

// ==================================================
// HEALTH CHECKS
// ==================================================

// Liveness: confirms that the application process is running.
app.get("/health", (_, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// Readiness: confirms that the database is reachable.
app.get(
  "/ready",
  wrap(async (_, res) => {
    await q("SELECT 1");

    return res.status(200).json({
      status: "ready",
      database: "connected",
    });
  })
);

// ==================================================
// STARTUP
// ==================================================

await migrate();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`ShopMind API listening on port ${PORT}`);
  console.log(`AI provider: ${AI_PROVIDER}`);
});

// ==================================================
// GRACEFUL SHUTDOWN
// ==================================================

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`${signal} received. Shutting down ShopMind API...`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 15000);

  forceExit.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });

      server.closeIdleConnections?.();
    });

    await closeDatabase();

    clearTimeout(forceExit);

    console.log("ShopMind API shut down successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error);
    process.exit(1);
  }
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
