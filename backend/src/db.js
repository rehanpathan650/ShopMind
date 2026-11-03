
import pg from "pg";

const { Pool } = pg;

// --------------------------------------------------
// DATABASE CONFIGURATION
// --------------------------------------------------

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured");
}

const getPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Connection pool settings
  max: getPositiveInteger(process.env.DB_POOL_MAX, 10),
  idleTimeoutMillis: getPositiveInteger(
    process.env.DB_IDLE_TIMEOUT_MS,
    30000
  ),
  connectionTimeoutMillis: getPositiveInteger(
    process.env.DB_CONNECTION_TIMEOUT_MS,
    10000
  ),

  // Do not force SSL here. Configure it through your PostgreSQL
  // connection string or provider-specific environment settings.
});

// Log unexpected errors on idle pooled connections.
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

// --------------------------------------------------
// QUERY HELPER
// --------------------------------------------------

/**
 * Execute a parameterized SQL query.
 *
 * @param {string} text SQL query
 * @param {Array} params Query parameters
 * @param {object} executor Pool or transaction client
 * @returns {Promise<Array>} Query result rows
 */
export const q = async (text, params = [], executor = pool) => {
  const result = await executor.query(text, params);
  return result.rows;
};

// --------------------------------------------------
// TRANSACTION HELPER
// --------------------------------------------------

/**
 * Execute multiple database operations atomically.
 *
 * All operations succeed together, or all are rolled back.
 *
 * Usage:
 *
 * await withTransaction(async (client) => {
 *   await q("INSERT ...", [...], client);
 *   await q("UPDATE ...", [...], client);
 * });
 *
 * @param {Function} callback Receives the transaction client
 * @returns {Promise<*>} Callback result
 */
export const withTransaction = async (callback) => {
  const client = await pool.connect();

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await callback(client);

    await client.query("COMMIT");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Database rollback failed:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
};

// --------------------------------------------------
// AUDIT LOGGING
// --------------------------------------------------

/**
 * Record an application event.
 *
 * An optional transaction client allows audit records
 * to be committed or rolled back with the operation.
 *
 * @param {string} shop Shop ID
 * @param {string} actor User/system/AI identifier
 * @param {string} event Event name
 * @param {object} detail Additional event details
 * @param {object} executor Pool or transaction client
 */
export const audit = async (
  shop,
  actor,
  event,
  detail = {},
  executor = pool
) => {
  const rows = await q(
    `INSERT INTO audit_log (shop_id, actor, event, detail)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [shop, actor, event, detail],
    executor
  );

  return rows[0];
};

// --------------------------------------------------
// DATABASE MIGRATIONS
// --------------------------------------------------

/**
 * Run idempotent schema migrations.
 *
 * Existing tables and records are preserved.
 * New columns and indexes are added when missing.
 */
export const migrate = async () => {
  await withTransaction(async (client) => {
    // ----------------------------------------------
    // CORE TABLES
    // ----------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID REFERENCES shops(id),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        name TEXT NOT NULL,
        phone TEXT
      );

      CREATE TABLE IF NOT EXISTS ledger (
        id BIGSERIAL PRIMARY KEY,
        shop_id UUID NOT NULL,
        customer_id UUID REFERENCES customers(id),
        amount NUMERIC NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        name TEXT NOT NULL,
        qty INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS pending_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL,
        tool TEXT,
        args JSONB,
        summary TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        shop_id UUID,
        actor TEXT,
        event TEXT,
        detail JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // ----------------------------------------------
    // BACKWARD-COMPATIBLE COLUMN MIGRATIONS
    // ----------------------------------------------

    await client.query(`
      ALTER TABLE pending_actions
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

      UPDATE pending_actions
      SET
        status = COALESCE(status, 'pending'),
        updated_at = COALESCE(updated_at, created_at, now());

      ALTER TABLE pending_actions
        ALTER COLUMN status SET DEFAULT 'pending',
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;
    `);

    // ----------------------------------------------
    // VALIDATE EXISTING DATA BEFORE UNIQUE INDEX
    // ----------------------------------------------

    // Existing accounts with emails differing only by case
    // must be resolved manually before enforcing uniqueness.
    const duplicateEmails = await client.query(`
      SELECT lower(trim(email)) AS normalized_email, COUNT(*) AS count
      FROM users
      GROUP BY lower(trim(email))
      HAVING COUNT(*) > 1
      LIMIT 10
    `);

    if (duplicateEmails.rows.length > 0) {
      const emails = duplicateEmails.rows
        .map((row) => row.normalized_email)
        .join(", ");

      throw new Error(
        `Cannot enforce case-insensitive email uniqueness. ` +
        `Resolve these duplicate accounts first: ${emails}`
      );
    }

    // ----------------------------------------------
    // DATA NORMALIZATION
    // ----------------------------------------------

    await client.query(`
      UPDATE users
      SET email = lower(trim(email))
      WHERE email <> lower(trim(email));
    `);

    // ----------------------------------------------
    // UNIQUE CONSTRAINTS AND INDEXES
    // ----------------------------------------------

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq
        ON users (lower(email));

      CREATE UNIQUE INDEX IF NOT EXISTS cust_uq
        ON customers (shop_id, lower(name));

      CREATE UNIQUE INDEX IF NOT EXISTS prod_uq
        ON products (shop_id, lower(name));
    `);

    // ----------------------------------------------
    // PERFORMANCE INDEXES
    // ----------------------------------------------

    await client.query(`
      CREATE INDEX IF NOT EXISTS ledger_shop_customer_created_idx
        ON ledger (shop_id, customer_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS pending_actions_shop_status_idx
        ON pending_actions (shop_id, status, created_at DESC);

      CREATE INDEX IF NOT EXISTS audit_log_shop_created_idx
        ON audit_log (shop_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS products_shop_name_idx
        ON products (shop_id, name);

      CREATE INDEX IF NOT EXISTS customers_shop_name_idx
        ON customers (shop_id, name);
    `);

    // ----------------------------------------------
    // PENDING ACTION STATUS VALIDATION
    // ----------------------------------------------

    // Fail safely if existing records contain unexpected
    // statuses instead of silently modifying their meaning.
    const invalidStatuses = await client.query(`
      SELECT DISTINCT status
      FROM pending_actions
      WHERE status NOT IN ('pending', 'done', 'cancelled')
      LIMIT 10
    `);

    if (invalidStatuses.rows.length > 0) {
      const statuses = invalidStatuses.rows
        .map((row) => row.status)
        .join(", ");

      throw new Error(
        `Unexpected pending action statuses found: ${statuses}. ` +
        `Resolve them before applying this migration.`
      );
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'pending_actions_status_check'
            AND conrelid = 'pending_actions'::regclass
        ) THEN
          ALTER TABLE pending_actions
            ADD CONSTRAINT pending_actions_status_check
            CHECK (status IN ('pending', 'done', 'cancelled'));
        END IF;
      END
      $$;
    `);
  });

  console.log("Database migrations completed successfully.");
};

// --------------------------------------------------
// DATABASE SHUTDOWN
// --------------------------------------------------

export const closeDatabase = async () => {
  await pool.end();
  console.log("PostgreSQL connection pool closed.");
};
