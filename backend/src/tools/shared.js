import { z } from "zod";
import { q, pool } from "../db.js";

// ==================================================
// LIMITS
// ==================================================

export const LIMITS = {
  name: 120,
  note: 500,
  stock: 1_000_000,
  dbInt: 2_147_483_647,
  amount: 1_000_000_000,
};

// ==================================================
// SHARED ZOD SCHEMAS
// ==================================================

const PLACEHOLDERS = ["product", "item", "product name", "unknown", "customer", "name"];

export const productName = z
  .string()
  .trim()
  .min(1, "Product name is required")
  .max(LIMITS.name)
  .refine((v) => !PLACEHOLDERS.includes(v.toLowerCase()), "Use the actual product name.")
  .describe("Exact product name from inventory, e.g. 'Cement bags'. Never a placeholder.");

export const customerName = z
  .string()
  .trim()
  .min(1, "Customer name is required")
  .max(LIMITS.name)
  .refine((v) => !PLACEHOLDERS.includes(v.toLowerCase()), "Use the actual customer name.")
  .describe("Exact customer name, e.g. 'Sharma Traders'.");

export const supplierName = z.string().trim().min(1).max(LIMITS.name);

export const money = z.number().finite().positive().max(LIMITS.amount);
export const moneyOrZero = z.number().finite().nonnegative().max(LIMITS.amount);
export const quantity = z.number().int().positive().max(LIMITS.stock);
export const note = z.string().trim().max(LIMITS.note);
export const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+\d][\d\s-]{5,19}$/, "Enter a valid phone number");
export const period = z
  .enum(["today", "7d", "30d", "90d", "month", "year"])
  .describe("Reporting window: today, last 7/30/90 days, this calendar month, or this year.");

export const PAYMENT_METHODS = ["cash", "upi", "card", "credit"];

// ==================================================
// FORMATTING
// ==================================================

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const rupees = (amount) => inr.format(Number(amount) || 0);

export const toolError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.expose = true; // safe to show to the model / user
  return error;
};

/**
 * Translate a period into a SQL lower bound (timestamptz).
 */
export const periodStart = (p = "30d") =>
  ({
    today: "date_trunc('day', now())",
    "7d": "now() - interval '7 days'",
    "30d": "now() - interval '30 days'",
    "90d": "now() - interval '90 days'",
    month: "date_trunc('month', now())",
    year: "date_trunc('year', now())",
  })[p] || "now() - interval '30 days'";

// ==================================================
// LOOKUPS (exact match first, then unique partial match)
// `lock` adds FOR UPDATE when called inside a write transaction.
// ==================================================

const resolveOne = async ({ table, columns, shop, name, label, executor, lock }) => {
  const forUpdate = lock ? "FOR UPDATE" : "";
  const [exact] = await q(
    `SELECT ${columns} FROM ${table}
     WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1 ${forUpdate}`,
    [shop, name.trim()],
    executor
  );
  if (exact) return exact;

  const matches = await q(
    `SELECT ${columns} FROM ${table}
     WHERE shop_id = $1 AND position(lower($2) in lower(name)) > 0
     ORDER BY name LIMIT 6 ${forUpdate}`,
    [shop, name.trim()],
    executor
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw toolError(
      409,
      `Multiple ${label}s match "${name}": ${matches.map((m) => m.name).join(", ")}. Please specify which one.`
    );
  }
  throw toolError(404, `${label[0].toUpperCase()}${label.slice(1)} "${name}" was not found.`);
};

export const findProduct = (shop, name, executor = pool, lock = executor !== pool) =>
  resolveOne({
    table: "products",
    columns: "id, name, qty, price, cost, unit, category, reorder_level, sku",
    shop, name, label: "product", executor, lock,
  });

export const findCustomer = (shop, name, executor = pool, lock = executor !== pool) =>
  resolveOne({
    table: "customers",
    columns: "id, name, phone, credit_limit",
    shop, name, label: "customer", executor, lock,
  });

export const findSupplier = (shop, name, executor = pool, lock = false) =>
  resolveOne({
    table: "suppliers",
    columns: "id, name, phone",
    shop, name, label: "supplier", executor, lock,
  });

export const customerBalance = async (shop, customerId, executor = pool) => {
  const [row] = await q(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS balance
     FROM ledger WHERE shop_id = $1 AND customer_id = $2`,
    [shop, customerId],
    executor
  );
  return Number(row.balance);
};

export const shopSettings = async (shop, executor = pool) => {
  const [row] = await q(
    `SELECT low_stock_threshold FROM shops WHERE id = $1`,
    [shop],
    executor
  );
  return row || { low_stock_threshold: 10 };
};
