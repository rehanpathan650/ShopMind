
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { tools } from "./tools.js";
import { q, audit, withTransaction } from "./db.js";

// ==================================================
// CONFIGURATION
// ==================================================

const SERVER_INFO = {
  name: "shopmind",
  version: "1.2.0",
};

const CLIENT_INFO = {
  name: "shopmind-chat",
  version: "1.2.0",
};

// ==================================================
// CONTEXT VALIDATION
// ==================================================

function validateContext(ctx) {
  if (
    !ctx ||
    typeof ctx.shopId !== "string" ||
    typeof ctx.userId !== "string"
  ) {
    throw new Error("Invalid authenticated shop context");
  }
}

// ==================================================
// TOOL ERROR HANDLING
// ==================================================

function getSafeErrorMessage(error) {
  // Log the actual error on the server, but don't expose
  // database details, SQL, or stack traces to the model/client.
  console.error("MCP tool execution failed:", error);

  return "The requested operation could not be completed. Please try again.";
}

// ==================================================
// MCP SERVER BUILDER
// ==================================================

/**
 * Build an MCP server scoped to one authenticated shop.
 *
 * Internal chat:
 * - Can access read tools.
 * - Can stage write tools for owner confirmation.
 *
 * Remote MCP:
 * - Exposes read tools only.
 * - Cannot stage or execute write operations.
 *
 * @param {object} ctx Verified JWT context
 * @param {object} options Server configuration
 * @returns {McpServer}
 */
export function buildServer(ctx, { readOnly = false } = {}) {
  validateContext(ctx);

  const server = new McpServer(SERVER_INFO);

  for (const [name, tool] of Object.entries(tools)) {
    // Remote MCP clients must never receive write tools.
    if (readOnly && tool.write) {
      continue;
    }

    if (
      !tool ||
      !tool.schema ||
      typeof tool.run !== "function"
    ) {
      throw new Error(`Invalid MCP tool configuration: ${name}`);
    }

    if (tool.write && typeof tool.summary !== "function") {
      throw new Error(`Write tool is missing a summary function: ${name}`);
    }

    server.registerTool(
      name,
      {
        description: tool.desc || "",
        inputSchema: tool.schema,
      },
      async (args) => {
        try {
          let output;

          // ------------------------------------------
          // WRITE TOOL: STAGE FOR OWNER APPROVAL
          // ------------------------------------------

          if (tool.write) {
            if (readOnly) {
              throw new Error("Write operations are disabled");
            }

            const summary = tool.summary(args);

            if (
              typeof summary !== "string" ||
              !summary.trim() ||
              summary.length > 1000
            ) {
              throw new Error("Invalid action summary");
            }

            // Store the pending action and audit record
            // together. Either both succeed or neither does.
            const pending = await withTransaction(async (client) => {
              const [action] = await q(
                `INSERT INTO pending_actions
                  (shop_id, tool, args, summary, status)
                 VALUES ($1, $2, $3, $4, 'pending')
                 RETURNING id`,
                [
                  ctx.shopId,
                  name,
                  args,
                  summary,
                ],
                client
              );

              await audit(
                ctx.shopId,
                "ai",
                `staged:${name}`,
                {
                  actionId: action.id,
                  arguments: args,
                  summary,
                },
                client
              );

              return action;
            });

            // Keep the pending action available to the chat response.
            if (Array.isArray(ctx.pending)) {
              ctx.pending.push({
                id: pending.id,
                summary,
              });
            }

            output =
              `NOT EXECUTED. Staged for owner confirmation: ${summary}. ` +
              "Ask the owner to confirm before considering this operation complete.";
          }

          // ------------------------------------------
          // READ TOOL: EXECUTE DIRECTLY
          // ------------------------------------------

          else {
            output = await tool.run(ctx, args);

            await audit(
              ctx.shopId,
              "ai",
              `read:${name}`,
              args
            );
          }

          return {
            content: [
              {
                type: "text",
                text:
                  typeof output === "string"
                    ? output
                    : JSON.stringify(output),
              },
            ],
          };
        } catch (error) {
          const message = getSafeErrorMessage(error);

          return {
            content: [
              {
                type: "text",
                text: message,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

// ==================================================
// INTERNAL MCP CLIENT
// ==================================================

/**
 * Create an in-memory MCP connection for ShopMind's own AI orchestration.
 *
 * The returned client exposes:
 * - listTools()
 * - callTool()
 * - close()
 *
 * close() also closes the server to prevent resource leaks.
 *
 * @param {object} ctx Authenticated shop context
 * @returns {Promise<object>}
 */
export async function connect(ctx) {
  validateContext(ctx);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const server = buildServer(ctx);

  const client = new Client(CLIENT_INFO);

  let serverConnected = false;
  let clientConnected = false;
  let closed = false;

  try {
    await server.connect(serverTransport);
    serverConnected = true;

    await client.connect(clientTransport);
    clientConnected = true;

    return {
      listTools: (...args) => client.listTools(...args),

      callTool: (...args) => client.callTool(...args),

      close: async () => {
        if (closed) return;

        closed = true;

        const errors = [];

        if (clientConnected) {
          try {
            await client.close();
          } catch (error) {
            errors.push(error);
          }
        }

        if (serverConnected) {
          try {
            await server.close();
          } catch (error) {
            errors.push(error);
          }
        }

        if (errors.length > 0) {
          console.error("MCP connection cleanup errors:", errors);
        }
      },
    };
  } catch (error) {
    // Clean up partially established connections.
    if (clientConnected) {
      try {
        await client.close();
      } catch (closeError) {
        console.error("MCP client cleanup failed:", closeError);
      }
    }

    if (serverConnected) {
      try {
        await server.close();
      } catch (closeError) {
        console.error("MCP server cleanup failed:", closeError);
      }
    }

    throw error;
  }
}

// ==================================================
// REMOTE MCP: READ-ONLY HTTP ENDPOINT
// ==================================================

/**
 * Handle one stateless Streamable HTTP MCP request.
 *
 * The Express auth middleware must verify the JWT before
 * this function is called.
 *
 * Only read tools are registered for remote clients.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 */
export async function handleRemoteMcp(req, res) {
  validateContext(req.ctx);

  const server = buildServer(req.ctx, {
    readOnly: true,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;

    cleanedUp = true;

    const results = await Promise.allSettled([
      server.close(),
      transport.close(),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Remote MCP cleanup failed:", result.reason);
      }
    }
  };

  // Release resources when the HTTP response closes.
  res.once("close", () => {
    void cleanup();
  });

  try {
    await server.connect(transport);

    await transport.handleRequest(
      req,
      res,
      req.body
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
}
