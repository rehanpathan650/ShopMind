// ==================================================
// CENTRAL CONFIGURATION
// Every environment variable is read and validated here, once.
// ==================================================

const env = process.env;

const int = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const isProduction = env.NODE_ENV === "production";

// ---------- Required secrets ----------

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured");
}

if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}

// ---------- AI provider ----------

const aiProvider = (env.AI_PROVIDER || "anthropic").toLowerCase();

if (!["anthropic", "groq"].includes(aiProvider)) {
  throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}`);
}

if (aiProvider === "anthropic" && !env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY must be configured (get one at https://platform.claude.com/settings/keys)"
  );
}

if (aiProvider === "groq" && !env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY must be configured when AI_PROVIDER=groq");
}

const effort = (env.AI_EFFORT || "medium").toLowerCase();

if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
  throw new Error("AI_EFFORT must be one of low, medium, high, xhigh, max");
}

// ---------- CORS ----------

const corsOrigins = (env.CORS_ORIGINS || env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (isProduction && corsOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must be configured in production");
}

export const config = Object.freeze({
  isProduction,
  port: int(env.PORT, 4000, { max: 65535 }),
  trustProxy: bool(env.TRUST_PROXY, false),
  corsOrigins,

  db: {
    url: env.DATABASE_URL,
    poolMax: int(env.DB_POOL_MAX, 10),
    idleTimeoutMs: int(env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMs: int(env.DB_CONNECTION_TIMEOUT_MS, 10_000),
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    sessionTtlSeconds: int(env.SESSION_TTL_HOURS, 24 * 7) * 3600,
    cookieName: "sm_session",
    cookieSecure: bool(env.COOKIE_SECURE, isProduction),
    maxFailedLogins: int(env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(env.LOCKOUT_MINUTES, 15),
  },

  ai: {
    provider: aiProvider,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    // Claude Opus 5.5 is the default; override with ANTHROPIC_MODEL
    // (e.g. claude-sonnet-5-5 for lower cost).
    anthropicModel: env.ANTHROPIC_MODEL || env.MODEL || "claude-opus-5-5",
    effort,
    // Server-side refusal fallbacks (re-run a declined request on a fallback model).
    fallbacks: bool(env.AI_FALLBACKS, true),
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL || "qwen/qwen3.8-27b",
    maxToolRounds: int(env.AI_MAX_TOOL_ROUNDS, 8, { max: 20 }),
  },

  limits: {
    pendingActionTtlHours: int(env.PENDING_ACTION_TTL_HOURS, 24),
    chatPerMinute: int(env.RATE_CHAT_PER_MIN, 20),
    apiPerMinute: int(env.RATE_API_PER_MIN, 300),
    authPer15Min: int(env.RATE_AUTH_PER_15MIN, 20),
  },
});
