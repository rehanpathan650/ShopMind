import crypto from "node:crypto";
import { q } from "../db.js";

// ==================================================
// SHOP API KEYS
// Format: sm_live_<43 chars base64url>. Only a SHA-256 hash is stored;
// the plaintext is shown to the owner exactly once at creation.
// ==================================================

export const API_KEY_PREFIX = "sm_live_";
export const SCOPES = ["read", "write"];

export const hashKey = (key) =>
  crypto.createHash("sha256").update(key, "utf8").digest("hex");

export const generateKey = () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
};

export const looksLikeApiKey = (value) =>
  typeof value === "string" &&
  value.startsWith(API_KEY_PREFIX) &&
  value.length >= 40 &&
  value.length <= 80 &&
  /^[A-Za-z0-9_-]+$/.test(value);

/**
 * Resolve an API key to its shop context, or null if invalid/revoked/expired.
 * Lookup is by hash (indexed, unique), so it is not timing-sensitive.
 */
export const resolveApiKey = async (key) => {
  if (!looksLikeApiKey(key)) return null;

  const [row] = await q(
    `UPDATE api_keys
     SET last_used_at = now()
     WHERE key_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING id, shop_id, user_id, name, scopes`,
    [hashKey(key)]
  );

  return row || null;
};
