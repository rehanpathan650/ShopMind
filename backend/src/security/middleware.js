import crypto from "node:crypto";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";

// ==================================================
// SECURITY HEADERS (helmet) — this is a JSON API, so lock everything down.
// ==================================================

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "no-referrer" },
  strictTransportSecurity: config.isProduction
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false,
});

// ==================================================
// CORS allow-list
// ==================================================

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // same-origin / server-to-server
    const normalized = origin.replace(/\/$/, "");
    if (config.corsOrigins.includes(normalized)) return callback(null, true);
    if (!config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(normalized)) {
      return callback(null, true);
    }
    const error = new Error("Origin not allowed");
    error.status = 403;
    return callback(error);
  },
  credentials: true,
  exposedHeaders: ["Mcp-Session-Id", "X-Request-Id"],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Mcp-Session-Id",
    "Mcp-Protocol-Version",
    "X-Requested-With",
  ],
  maxAge: 600,
});

// ==================================================
// REQUEST ID — correlates logs with client-visible errors.
// ==================================================

export const requestId = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
};

// ==================================================
// RATE LIMITING
// ==================================================

const limiter = (options) =>
  rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again shortly." },
    ...options,
  });

/** Brute-force protection for login/register (per IP). */
export const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: config.limits.authPer15Min,
});

/** AI chat is expensive: limit per shop, falling back to IP. */
export const chatLimiter = limiter({
  windowMs: 60 * 1000,
  limit: config.limits.chatPerMinute,
  keyGenerator: (req) => req.ctx?.shopId || ipKeyGenerator(req.ip),
});

/** General API ceiling (per credential, falling back to IP). */
export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: config.limits.apiPerMinute,
  keyGenerator: (req) => req.ctx?.apiKeyId || req.ctx?.shopId || ipKeyGenerator(req.ip),
});
