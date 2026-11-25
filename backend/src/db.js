import pg from "pg";
import { config } from "./config.js";

const { Pool, types } = pg;

// Return NUMERIC as JS numbers (amounts are bounded well below 2^53).
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
// Return BIGINT counts as numbers.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
// Keep DATE as 'YYYY-MM-DD' (avoid timezone shifts from JS Date).
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

/**
 * Execute a parameterized query and return its rows.
 * Never interpolate user input into `text`.
 */
export const q = async (text, params = [], executor = pool) => {
  const result = await executor.query(text, params);
  return result.rows;
};

/**
 * Run a callback inside a transaction. Everything commits or nothing does.
 */
export const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Database rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Append an entry to the shop's audit log. The audit log is append-only:
 * no route updates or deletes rows from it.
 */
export const audit = async (shop, actor, event, detail = {}, executor = pool) => {
  const [row] = await q(
    `INSERT INTO audit_log (shop_id, actor, event, detail)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [shop, String(actor).slice(0, 120), String(event).slice(0, 120), detail],
    executor
  );
  return row;
};

export const closeDatabase = async () => {
  await pool.end();
};
