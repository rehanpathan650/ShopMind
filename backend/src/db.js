import pg from "pg";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (t, p) => pool.query(t, p).then((r) => r.rows);
export const audit = (shop, actor, event, detail = {}) =>
  q("INSERT INTO audit_log(shop_id,actor,event,detail) VALUES($1,$2,$3,$4)", [shop, actor, event, detail]);
export const migrate = () => pool.query(`
CREATE TABLE IF NOT EXISTS shops(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES shops, email text UNIQUE NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops, name text NOT NULL, phone text);
CREATE UNIQUE INDEX IF NOT EXISTS cust_uq ON customers(shop_id, lower(name));
CREATE TABLE IF NOT EXISTS ledger(id bigserial PRIMARY KEY, shop_id uuid NOT NULL, customer_id uuid REFERENCES customers, amount numeric NOT NULL, note text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops, name text NOT NULL, qty int NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS prod_uq ON products(shop_id, lower(name));
CREATE TABLE IF NOT EXISTS pending_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, tool text, args jsonb, summary text, status text DEFAULT 'pending', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log(id bigserial PRIMARY KEY, shop_id uuid, actor text, event text, detail jsonb, created_at timestamptz DEFAULT now());
`);
