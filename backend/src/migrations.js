import { withTransaction } from "./db.js";

/**
 * Idempotent schema migrations. Safe to run on every boot:
 * existing tables and rows are preserved, new columns/tables are added.
 */
export const migrate = async () => {
  await withTransaction(async (client) => {
    // Serialize concurrent boots (e.g. two instances starting together).
    await client.query("SELECT pg_advisory_xact_lock(727274)");

    // ---------------- Core tables (original schema) ----------------
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

    // ---------------- Column additions ----------------
    await client.query(`
      ALTER TABLE shops
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS phone TEXT,
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS gstin TEXT,
        ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 10;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS email TEXT,
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS credit_limit NUMERIC,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS sku TEXT,
        ADD COLUMN IF NOT EXISTS category TEXT,
        ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'unit',
        ADD COLUMN IF NOT EXISTS price NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cost NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reorder_level INTEGER,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

      ALTER TABLE ledger
        ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'adjustment',
        ADD COLUMN IF NOT EXISTS sale_id UUID;

      ALTER TABLE pending_actions
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat',
        ADD COLUMN IF NOT EXISTS created_by TEXT,
        ADD COLUMN IF NOT EXISTS result TEXT,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

      UPDATE pending_actions
      SET status = COALESCE(status, 'pending'),
          updated_at = COALESCE(updated_at, created_at, now()),
          expires_at = COALESCE(expires_at, created_at + interval '24 hours', now());

      ALTER TABLE pending_actions
        ALTER COLUMN status SET DEFAULT 'pending',
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;
    `);

    // ---------------- New tables ----------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        payment_method TEXT NOT NULL DEFAULT 'cash'
          CHECK (payment_method IN ('cash', 'upi', 'card', 'credit')),
        total NUMERIC NOT NULL CHECK (total >= 0),
        discount NUMERIC NOT NULL DEFAULT 0,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'completed'
          CHECK (status IN ('completed', 'void')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id BIGSERIAL PRIMARY KEY,
        sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        qty INTEGER NOT NULL CHECK (qty > 0),
        unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
        unit_cost NUMERIC NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        category TEXT NOT NULL,
        amount NUMERIC NOT NULL CHECK (amount > 0),
        note TEXT,
        spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        name TEXT NOT NULL,
        phone TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        qty INTEGER NOT NULL CHECK (qty > 0),
        unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
        total NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        user_id UUID NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // ---------------- Data checks before unique indexes ----------------
    const duplicateEmails = await client.query(`
      SELECT lower(trim(email)) AS email
      FROM users GROUP BY lower(trim(email)) HAVING COUNT(*) > 1 LIMIT 10
    `);
    if (duplicateEmails.rows.length > 0) {
      throw new Error(
        "Cannot enforce case-insensitive email uniqueness. Resolve duplicates: " +
          duplicateEmails.rows.map((r) => r.email).join(", ")
      );
    }

    await client.query(`
      UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
    `);

    // ---------------- Indexes ----------------
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));
      CREATE UNIQUE INDEX IF NOT EXISTS cust_uq ON customers (shop_id, lower(name));
      CREATE UNIQUE INDEX IF NOT EXISTS prod_uq ON products (shop_id, lower(name));
      CREATE UNIQUE INDEX IF NOT EXISTS supplier_uq ON suppliers (shop_id, lower(name));

      CREATE INDEX IF NOT EXISTS ledger_shop_customer_created_idx
        ON ledger (shop_id, customer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS pending_actions_shop_status_idx
        ON pending_actions (shop_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_log_shop_created_idx
        ON audit_log (shop_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS products_shop_name_idx ON products (shop_id, name);
      CREATE INDEX IF NOT EXISTS customers_shop_name_idx ON customers (shop_id, name);
      CREATE INDEX IF NOT EXISTS sales_shop_created_idx ON sales (shop_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items (sale_id);
      CREATE INDEX IF NOT EXISTS sale_items_product_idx ON sale_items (product_id);
      CREATE INDEX IF NOT EXISTS expenses_shop_spent_idx ON expenses (shop_id, spent_on DESC);
      CREATE INDEX IF NOT EXISTS purchases_shop_created_idx ON purchases (shop_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS api_keys_shop_idx ON api_keys (shop_id);
    `);

    // ---------------- Pending action status constraint ----------------
    const invalidStatuses = await client.query(`
      SELECT DISTINCT status FROM pending_actions
      WHERE status NOT IN ('pending', 'done', 'cancelled', 'expired') LIMIT 10
    `);
    if (invalidStatuses.rows.length > 0) {
      throw new Error(
        "Unexpected pending action statuses: " +
          invalidStatuses.rows.map((r) => r.status).join(", ")
      );
    }

    await client.query(`
      ALTER TABLE pending_actions DROP CONSTRAINT IF EXISTS pending_actions_status_check;
      ALTER TABLE pending_actions
        ADD CONSTRAINT pending_actions_status_check
        CHECK (status IN ('pending', 'done', 'cancelled', 'expired'));
    `);
  });

  console.log("Database migrations completed successfully.");
};
