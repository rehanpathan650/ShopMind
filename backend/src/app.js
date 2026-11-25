import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { q } from "./db.js";
import { securityHeaders, corsMiddleware, requestId, apiLimiter } from "./security/middleware.js";
import { authenticate, requireScope } from "./security/auth.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";
import { handleRemoteMcp } from "./mcp/server.js";
import { catalog } from "./tools/index.js";
import { wrap } from "./lib/http.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));

  // ---------------- Public ----------------
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", wrap(async (_req, res) => {
    await q("SELECT 1");
    res.json({ status: "ready", database: "connected" });
  }));
  // Public tool catalog for docs pages.
  app.get("/api/public/tools", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").json({
      tools: catalog().map(({ input_schema, ...rest }) => rest),
    });
  });

  // ---------------- Auth + API ----------------
  app.use("/api/auth", authRouter);
  app.use("/api", apiRouter);

  // ---------------- Remote MCP (API keys only) ----------------
  const mcpAuth = [authenticate({ allowSession: false }), apiLimiter, requireScope("read")];
  app.post("/mcp", ...mcpAuth, async (req, res, next) => {
    try {
      await handleRemoteMcp(req, res);
    } catch (error) {
      next(error);
    }
  });
  app.all("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use POST" }));

  // ---------------- 404 ----------------
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // ---------------- Errors ----------------
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    if (res.headersSent) return;

    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return res.status(400).json({ error: "Invalid JSON request body" });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large" });
    }

    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500;

    if (status >= 500) {
      console.error(`[${req.id}] ${req.method} ${req.path} failed:`, error);
    }

    // Internal details (SQL, stack traces) never leave the server.
    const message = status < 500 || error.expose ? error.message : "Internal server error";
    res.status(status).json({ error: message, request_id: req.id });
  });

  return app;
}
