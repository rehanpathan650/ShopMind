import { Router } from "express";
import { q, audit, withTransaction } from "../db.js";
import { config } from "../config.js";
import { wrap, httpError, isEmail, normalizeEmail } from "../lib/http.js";
import { authLimiter } from "../security/middleware.js";
import { passwordProblem, hashPassword, verifyPassword } from "../security/password.js";
import {
  authenticate, signSession, setSessionCookie, clearSessionCookie, csrfGuard,
} from "../security/auth.js";
import { seedDemo } from "../seed.js";

export const authRouter = Router();
const ownerOnly = authenticate({ allowApiKey: false });

const profile = (row) => ({
  shop: row.shop_name,
  email: row.email,
  name: row.name || null,
});

// ---------------------------------------------------------------- REGISTER
authRouter.post(
  "/register",
  authLimiter,
  csrfGuard,
  wrap(async (req, res) => {
    const { shop, email, password, name, demo = false } = req.body || {};

    if (typeof shop !== "string" || !shop.trim() || shop.trim().length > 120) {
      throw httpError(400, "A shop name is required (max 120 characters)");
    }
    if (!isEmail(email)) throw httpError(400, "A valid email address is required");
    const problem = passwordProblem(password);
    if (problem) throw httpError(400, problem);
    if (typeof demo !== "boolean") throw httpError(400, "demo must be true or false");
    if (name !== undefined && (typeof name !== "string" || name.length > 80)) {
      throw httpError(400, "Name must be at most 80 characters");
    }

    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await hashPassword(password);

    let account;
    try {
      account = await withTransaction(async (client) => {
        const [newShop] = await q(
          `INSERT INTO shops (name) VALUES ($1) RETURNING id, name`,
          [shop.trim()],
          client
        );
        const [user] = await q(
          `INSERT INTO users (shop_id, email, password_hash, name, last_login_at)
           VALUES ($1, $2, $3, $4, now()) RETURNING id, email, name, token_version`,
          [newShop.id, normalizedEmail, passwordHash, name?.trim() || null],
          client
        );
        if (demo) await seedDemo(newShop.id, client);
        await audit(newShop.id, user.id, "account_registered", { demo }, client);
        return { shop: newShop, user };
      });
    } catch (error) {
      // Same message for "already registered" to avoid an account-enumeration oracle
      // beyond what's unavoidable; status 409 lets the UI suggest logging in.
      if (error.code === "23505") throw httpError(409, "An account with this email already exists");
      throw error;
    }

    setSessionCookie(res, signSession({
      shopId: account.shop.id,
      userId: account.user.id,
      tokenVersion: account.user.token_version,
    }));
    res.status(201).json({ shop: account.shop.name, email: account.user.email, name: account.user.name });
  })
);

// ---------------------------------------------------------------- LOGIN
authRouter.post(
  "/login",
  authLimiter,
  csrfGuard,
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isEmail(email) || typeof password !== "string") {
      throw httpError(400, "Valid email and password are required");
    }

    const [user] = await q(
      `SELECT u.id, u.shop_id, u.email, u.name, u.password_hash, u.token_version,
              u.failed_logins, u.locked_until, s.name AS shop_name
       FROM users u JOIN shops s ON s.id = u.shop_id
       WHERE lower(u.email) = $1 LIMIT 1`,
      [normalizeEmail(email)]
    );

    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      throw httpError(429, "Too many failed attempts. Try again in a few minutes.");
    }

    const ok = await verifyPassword(password, user?.password_hash);

    if (!user || !ok) {
      if (user) {
        await q(
          `UPDATE users SET
             failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= $2
                                 THEN now() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`,
          [user.id, config.auth.maxFailedLogins, config.auth.lockoutMinutes]
        );
        await audit(user.shop_id, "anonymous", "login_failed", { ip: req.ip });
      }
      throw httpError(401, "Wrong email or password");
    }

    await q(
      `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [user.id]
    );
    await audit(user.shop_id, user.id, "account_login", { ip: req.ip });

    setSessionCookie(res, signSession({
      shopId: user.shop_id,
      userId: user.id,
      tokenVersion: user.token_version,
    }));
    res.json(profile(user));
  })
);

// ---------------------------------------------------------------- SESSION
authRouter.get(
  "/me",
  ownerOnly,
  wrap(async (req, res) => {
    const [row] = await q(
      `SELECT u.email, u.name, u.last_login_at, s.name AS shop_name
       FROM users u JOIN shops s ON s.id = u.shop_id WHERE u.id = $1`,
      [req.ctx.userId]
    );
    res.json({ ...profile(row), last_login_at: row.last_login_at });
  })
);

authRouter.post("/logout", csrfGuard, (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Revoke every session for this user (all devices). */
authRouter.post(
  "/logout-all",
  ownerOnly,
  csrfGuard,
  wrap(async (req, res) => {
    await q(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [req.ctx.userId]);
    await audit(req.ctx.shopId, req.ctx.userId, "sessions_revoked", {});
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

authRouter.post(
  "/password",
  authLimiter,
  ownerOnly,
  csrfGuard,
  wrap(async (req, res) => {
    const { current, next } = req.body || {};
    const [user] = await q(`SELECT password_hash FROM users WHERE id = $1`, [req.ctx.userId]);
    if (!(await verifyPassword(current, user?.password_hash))) {
      throw httpError(401, "Current password is incorrect");
    }
    const problem = passwordProblem(next);
    if (problem) throw httpError(400, problem);

    const [updated] = await q(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1
       WHERE id = $1 RETURNING token_version`,
      [req.ctx.userId, await hashPassword(next)]
    );
    await audit(req.ctx.shopId, req.ctx.userId, "password_changed", {});
    // Other sessions are revoked; keep this one alive with a fresh token.
    setSessionCookie(res, signSession({
      shopId: req.ctx.shopId,
      userId: req.ctx.userId,
      tokenVersion: updated.token_version,
    }));
    res.json({ ok: true });
  })
);
