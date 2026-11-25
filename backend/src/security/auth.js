import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { q } from "../db.js";
import { httpError, isUuid } from "../lib/http.js";
import { resolveApiKey } from "./apiKeys.js";

// ==================================================
// SESSIONS
// Browser sessions live in an httpOnly, SameSite=Strict cookie so the
// token is never readable by page JavaScript (XSS can't steal it).
// Programmatic clients (MCP, scripts) use shop API keys as Bearer tokens.
// ==================================================

const { jwtSecret, cookieName, cookieSecure, sessionTtlSeconds } = config.auth;

export const signSession = ({ shopId, userId, tokenVersion }) =>
  jwt.sign({ shop: shopId, user: userId, ver: tokenVersion }, jwtSecret, {
    algorithm: "HS256",
    expiresIn: sessionTtlSeconds,
    issuer: "shopmind",
    audience: "shopmind-web",
  });

const cookieOptions = () => ({
  httpOnly: true,
  secure: cookieSecure,
  sameSite: "strict",
  path: "/",
});

export const setSessionCookie = (res, token) =>
  res.cookie(cookieName, token, { ...cookieOptions(), maxAge: sessionTtlSeconds * 1000 });

export const clearSessionCookie = (res) => res.clearCookie(cookieName, cookieOptions());

const verifySession = async (token) => {
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
      issuer: "shopmind",
      audience: "shopmind-web",
    });
  } catch {
    return null;
  }

  if (!payload || !isUuid(payload.shop) || !isUuid(payload.user)) return null;

  // Token version lets "log out everywhere" / password change revoke all sessions.
  const [user] = await q(
    `SELECT u.id, u.token_version, u.email, u.name, s.name AS shop_name
     FROM users u JOIN shops s ON s.id = u.shop_id
     WHERE u.id = $1 AND u.shop_id = $2`,
    [payload.user, payload.shop]
  );

  if (!user || user.token_version !== payload.ver) return null;

  return {
    shopId: payload.shop,
    userId: payload.user,
    email: user.email,
    shopName: user.shop_name,
    via: "session",
    scopes: ["read", "write", "owner"],
  };
};

/**
 * Authenticate via session cookie or `Authorization: Bearer sm_live_...`.
 * Attaches req.ctx = { shopId, userId, via, scopes, pending }.
 */
export const authenticate = ({ allowApiKey = true, allowSession = true } = {}) =>
  async (req, res, next) => {
    try {
      let ctx = null;
      const header = req.headers.authorization || "";

      if (header.startsWith("Bearer ")) {
        if (!allowApiKey) throw httpError(401, "API keys are not accepted here");
        const key = await resolveApiKey(header.slice(7).trim());
        if (!key) throw httpError(401, "Invalid, expired or revoked API key");
        {
          ctx = {
            shopId: key.shop_id,
            userId: key.user_id,
            apiKeyId: key.id,
            via: "api_key",
            actor: `api_key:${key.name}`,
            scopes: key.scopes,
          };
        }
      } else if (allowSession && req.cookies?.[cookieName]) {
        ctx = await verifySession(req.cookies[cookieName]);
        if (ctx) ctx.actor = ctx.userId;
      }

      if (!ctx) {
        if (req.cookies?.[cookieName]) clearSessionCookie(res);
        throw httpError(401, "Please log in again");
      }

      ctx.pending = [];
      req.ctx = ctx;
      next();
    } catch (error) {
      next(error.status ? error : httpError(401, "Please log in again"));
    }
  };

export const requireScope = (scope) => (req, _res, next) => {
  if (!req.ctx?.scopes?.includes(scope)) {
    return next(httpError(403, `This credential lacks the "${scope}" scope`));
  }
  next();
};

/**
 * CSRF defence for cookie-authenticated, state-changing requests.
 * Browsers cannot send a custom header cross-origin without a CORS
 * preflight, which our CORS allow-list rejects.
 */
export const csrfGuard = (req, _res, next) => {
  const safe = ["GET", "HEAD", "OPTIONS"].includes(req.method);
  const usesCookie = !req.headers.authorization && req.cookies?.[cookieName];
  if (!safe && usesCookie && req.get("x-requested-with") !== "ShopMind") {
    return next(httpError(403, "Missing CSRF header"));
  }
  next();
};
