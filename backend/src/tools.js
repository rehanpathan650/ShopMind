// Every tool receives ctx.shopId from the verified JWT, never from the AI. That is the tenant wall.
import { z } from "zod";
import { q, audit } from "./db.js";

const duesSql = `SELECT c.name, SUM(l.amount)::float due FROM customers c JOIN ledger l ON l.customer_id=c.id
  WHERE c.shop_id=$1 GROUP BY c.id HAVING SUM(l.amount)>$2 ORDER BY due DESC`;
export const dues = (shop, min = 0) => q(duesSql, [shop, min]);
export const stock = (shop, p = "") =>
  q("SELECT name, qty FROM products WHERE shop_id=$1 AND name ILIKE $2 ORDER BY name", [shop, `%${p}%`]);
const balance = async (shop, id) =>
  (await q("SELECT COALESCE(SUM(amount),0)::float b FROM ledger WHERE shop_id=$1 AND customer_id=$2", [shop, id]))[0].b;

export const tools = {
  get_dues: {
    desc: "List customers who owe money (credit/udhaar), optionally only above a minimum amount in rupees.",
    schema: { min_amount: z.number().optional() },
    run: async (c, { min_amount = 0 }) => {
      const r = await dues(c.shopId, min_amount);
      return r.length ? r.map((x) => `${x.name}: ₹${x.due}`).join("\n") : "No dues found.";
    },
  },
  get_stock: {
    desc: "Show stock quantities, optionally filtered by product name.",
    schema: { product: z.string().optional() },
    run: async (c, { product }) => {
      const r = await stock(c.shopId, product);
      return r.length ? r.map((x) => `${x.name}: ${x.qty}`).join("\n") : "No matching products.";
    },
  },
  add_stock: {
    write: true,
    desc: "Add quantity to a product's stock (creates the product if new).",
    schema: { product: z.string(), quantity: z.number().int() },
    summary: (a) => `Add ${a.quantity} × ${a.product} to stock`,
    run: async (c, a) => {
      const [r] = await q(
        `INSERT INTO products(shop_id,name,qty) VALUES($1,$2,$3)
         ON CONFLICT (shop_id, lower(name)) DO UPDATE SET qty = products.qty + EXCLUDED.qty RETURNING name, qty`,
        [c.shopId, a.product.trim(), a.quantity]);
      return `Stock of ${r.name} is now ${r.qty}.`;
    },
  },
  record_credit_sale: {
    write: true,
    desc: "Record that a customer bought on credit (udhaar). Increases what they owe.",
    schema: { customer: z.string(), amount: z.number().positive(), note: z.string().optional() },
    summary: (a) => `Add ₹${a.amount} credit for ${a.customer}${a.note ? ` (${a.note})` : ""}`,
    run: async (c, a) => {
      const [cu] = await q(
        `INSERT INTO customers(shop_id,name) VALUES($1,$2)
         ON CONFLICT (shop_id, lower(name)) DO UPDATE SET name=customers.name RETURNING id,name`,
        [c.shopId, a.customer.trim()]);
      await q("INSERT INTO ledger(shop_id,customer_id,amount,note) VALUES($1,$2,$3,$4)", [c.shopId, cu.id, a.amount, a.note]);
      return `${cu.name} now owes ₹${await balance(c.shopId, cu.id)}.`;
    },
  },
  record_payment: {
    write: true,
    desc: "Record a payment received from a customer. Reduces what they owe.",
    schema: { customer: z.string(), amount: z.number().positive() },
    summary: (a) => `Record ₹${a.amount} payment from ${a.customer}`,
    run: async (c, a) => {
      const [cu] = await q("SELECT id,name FROM customers WHERE shop_id=$1 AND name ILIKE $2 LIMIT 1", [c.shopId, `%${a.customer}%`]);
      if (!cu) return `No customer matching "${a.customer}".`;
      await q("INSERT INTO ledger(shop_id,customer_id,amount,note) VALUES($1,$2,$3,'payment')", [c.shopId, cu.id, -a.amount]);
      return `${cu.name} now owes ₹${await balance(c.shopId, cu.id)}.`;
    },
  },
  send_reminder: {
    write: true,
    desc: "Send payment reminders to named customers, or to everyone owing above min_amount.",
    schema: { customers: z.array(z.string()).optional(), min_amount: z.number().optional() },
    summary: (a) => `Send payment reminders to ${a.customers?.join(", ") || `all owing over ₹${a.min_amount ?? 0}`}`,
    run: async (c, a) => {
      let t = await dues(c.shopId, a.min_amount ?? 0);
      if (a.customers?.length) t = t.filter((x) => a.customers.some((n) => x.name.toLowerCase().includes(n.toLowerCase())));
      // Plug the WhatsApp Cloud API / SMS provider in here. For now reminders are queued and audited.
      for (const x of t) await audit(c.shopId, "system", "reminder_queued", x);
      return t.length ? `Reminders queued for ${t.length}: ${t.map((x) => x.name).join(", ")}.` : "No matching customers owe money.";
    },
  },
};
