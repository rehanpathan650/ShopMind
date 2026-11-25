import { z } from "zod";
import { q, pool, audit } from "../db.js";
import {
  LIMITS, customerName, money, moneyOrZero, note, phone,
  findCustomer, customerBalance, toolError, rupees,
} from "./shared.js";

const email = z.string().trim().email().max(254);

const duesQuery = (extraWhere = "") => `
  SELECT c.id, c.name, c.phone, c.credit_limit,
         SUM(l.amount)::numeric AS due,
         MAX(l.created_at) FILTER (WHERE l.amount < 0) AS last_payment_at,
         MIN(l.created_at) FILTER (WHERE l.amount > 0) AS oldest_credit_at
  FROM customers c
  JOIN ledger l ON l.customer_id = c.id AND l.shop_id = c.shop_id
  WHERE c.shop_id = $1 ${extraWhere}
  GROUP BY c.id
  HAVING SUM(l.amount) > $2
  ORDER BY SUM(l.amount) DESC, c.name`;

export const dues = (shop, min = 0, executor = pool) => q(duesQuery(), [shop, min], executor);

export const customerTools = {
  // ---------------------------------------------------------------- READ
  list_customers: {
    category: "customers",
    desc: "List customers with phone, current balance owed, credit limit and last activity. Optional search text.",
    schema: {
      search: z.string().trim().max(LIMITS.name).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    run: async (ctx, { search = "", limit = 200 }) => {
      const rows = await q(
        `SELECT c.id, c.name, c.phone, c.email, c.credit_limit, c.notes, c.created_at,
                COALESCE(SUM(l.amount), 0)::numeric AS balance,
                MAX(l.created_at) AS last_activity_at
         FROM customers c
         LEFT JOIN ledger l ON l.customer_id = c.id AND l.shop_id = c.shop_id
         WHERE c.shop_id = $1
           AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
         GROUP BY c.id ORDER BY c.name LIMIT $3`,
        [ctx.shopId, search, limit]
      );
      return { count: rows.length, customers: rows };
    },
  },

  get_dues: {
    category: "customers",
    desc: "Customers who owe money (credit / udhaar), largest first. Optionally only those above a minimum amount in rupees.",
    schema: { min_amount: moneyOrZero.optional() },
    run: async (ctx, { min_amount = 0 }) => {
      const rows = await dues(ctx.shopId, min_amount);
      if (!rows.length) return "No dues found.";
      return {
        total_due: rows.reduce((s, r) => s + r.due, 0),
        customers: rows.map((r) => ({
          name: r.name, due: r.due, phone: r.phone,
          over_credit_limit: r.credit_limit != null && r.due > r.credit_limit,
          last_payment_at: r.last_payment_at,
        })),
      };
    },
  },

  customer_statement: {
    category: "customers",
    desc: "Account statement for one customer: contact details, current balance, credit limit, and recent ledger entries with running balance.",
    schema: { customer: customerName, limit: z.number().int().min(1).max(200).optional() },
    run: async (ctx, { customer, limit = 30 }) => {
      const c = await findCustomer(ctx.shopId, customer);
      const entries = await q(
        `SELECT id, amount, kind, note, created_at,
                SUM(amount) OVER (ORDER BY created_at, id) AS running_balance
         FROM ledger WHERE shop_id = $1 AND customer_id = $2
         ORDER BY created_at DESC, id DESC LIMIT $3`,
        [ctx.shopId, c.id, limit]
      );
      const balance = await customerBalance(ctx.shopId, c.id);
      return { customer: c, balance, entries };
    },
  },

  dues_aging: {
    category: "customers",
    desc: "Accounts-receivable aging: how much is owed and for how long (0-30, 31-60, 61-90, 90+ days since the oldest unpaid credit).",
    schema: {},
    run: async (ctx) => {
      const rows = await dues(ctx.shopId, 0);
      const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      const detail = rows.map((r) => {
        const days = r.oldest_credit_at
          ? Math.floor((Date.now() - new Date(r.oldest_credit_at).getTime()) / 86_400_000)
          : 0;
        const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
        buckets[bucket] += r.due;
        return { name: r.name, due: r.due, days_outstanding: days, bucket };
      });
      return { total_due: detail.reduce((s, r) => s + r.due, 0), buckets, customers: detail };
    },
  },

  draft_reminder_message: {
    category: "customers",
    desc: "Draft a polite payment-reminder message (English + Hindi) for a customer, with their exact balance. Returns text only; nothing is sent.",
    schema: { customer: customerName, tone: z.enum(["gentle", "firm"]).optional() },
    run: async (ctx, { customer, tone = "gentle" }) => {
      const c = await findCustomer(ctx.shopId, customer);
      const balance = await customerBalance(ctx.shopId, c.id);
      if (balance <= 0) return `${c.name} has no outstanding balance.`;
      const [shop] = await q(`SELECT name FROM shops WHERE id = $1`, [ctx.shopId]);
      const en =
        tone === "firm"
          ? `Hello ${c.name}, this is ${shop.name}. Your outstanding balance of ${rupees(balance)} is overdue. Please clear it at the earliest.`
          : `Namaste ${c.name}! A friendly reminder from ${shop.name}: your balance is ${rupees(balance)}. Please pay when convenient. Thank you!`;
      const hi = `नमस्ते ${c.name} जी, ${shop.name} की ओर से याद दिलाना: आपका बकाया ${rupees(balance)} है। कृपया जल्द भुगतान करें। धन्यवाद!`;
      return { customer: c.name, phone: c.phone, balance, message_en: en, message_hi: hi, sent: false };
    },
  },

  // ---------------------------------------------------------------- WRITE
  create_customer: {
    category: "customers",
    write: true,
    desc: "Add a new customer with optional phone, email, address, credit limit and notes.",
    schema: {
      name: customerName,
      phone: phone.optional(),
      email: email.optional(),
      address: z.string().trim().max(300).optional(),
      credit_limit: moneyOrZero.optional(),
      notes: note.optional(),
    },
    summary: (a) => `Add customer "${a.name}"${a.phone ? ` (${a.phone})` : ""}`,
    run: async (ctx, a, executor = pool) => {
      try {
        const [row] = await q(
          `INSERT INTO customers (shop_id, name, phone, email, address, credit_limit, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, phone, email, address, credit_limit, notes`,
          [ctx.shopId, a.name, a.phone ?? null, a.email ?? null, a.address ?? null,
            a.credit_limit ?? null, a.notes ?? null],
          executor
        );
        return { message: `Added customer ${row.name}.`, customer: row };
      } catch (error) {
        if (error.code === "23505") throw toolError(409, `Customer "${a.name}" already exists.`);
        throw error;
      }
    },
  },

  update_customer: {
    category: "customers",
    write: true,
    desc: "Update a customer's name, phone, email, address, credit limit or notes.",
    schema: {
      customer: customerName,
      new_name: customerName.optional(),
      phone: phone.optional(),
      email: email.optional(),
      address: z.string().trim().max(300).optional(),
      credit_limit: moneyOrZero.optional(),
      notes: note.optional(),
    },
    summary: (a) => {
      const fields = ["new_name", "phone", "email", "address", "credit_limit", "notes"]
        .filter((k) => a[k] !== undefined)
        .map((k) => k.replace("_", " "));
      return `Update customer ${a.customer}: ${fields.join(", ") || "no changes"}`;
    },
    run: async (ctx, a, executor = pool) => {
      const c = await findCustomer(ctx.shopId, a.customer, executor);
      try {
        const [row] = await q(
          `UPDATE customers SET
             name = COALESCE($3, name), phone = COALESCE($4, phone), email = COALESCE($5, email),
             address = COALESCE($6, address), credit_limit = COALESCE($7, credit_limit),
             notes = COALESCE($8, notes)
           WHERE id = $1 AND shop_id = $2
           RETURNING id, name, phone, email, address, credit_limit, notes`,
          [c.id, ctx.shopId, a.new_name ?? null, a.phone ?? null, a.email ?? null,
            a.address ?? null, a.credit_limit ?? null, a.notes ?? null],
          executor
        );
        return { message: `Updated ${row.name}.`, customer: row };
      } catch (error) {
        if (error.code === "23505") throw toolError(409, `Customer "${a.new_name}" already exists.`);
        throw error;
      }
    },
  },

  delete_customer: {
    category: "customers",
    write: true,
    destructive: true,
    desc: "Permanently delete a customer. Refused if they still owe money or have credit with the shop.",
    schema: { customer: customerName },
    summary: (a) => `Delete customer "${a.customer}" and their ledger history`,
    run: async (ctx, a, executor = pool) => {
      const c = await findCustomer(ctx.shopId, a.customer, executor);
      const balance = await customerBalance(ctx.shopId, c.id, executor);
      if (Math.abs(balance) > 0.005) {
        throw toolError(409, `${c.name} has a non-zero balance of ${rupees(balance)}. Settle it before deleting.`);
      }
      await q(`DELETE FROM ledger WHERE shop_id = $1 AND customer_id = $2`, [ctx.shopId, c.id], executor);
      await q(`DELETE FROM customers WHERE id = $1 AND shop_id = $2`, [c.id, ctx.shopId], executor);
      return { message: `Deleted customer ${c.name}.` };
    },
  },

  record_credit_sale: {
    category: "customers",
    write: true,
    desc: "Record an amount a customer bought on credit (udhaar) without itemising products. For itemised sales use record_sale with payment_method 'credit'.",
    schema: { customer: customerName, amount: money, note: note.optional() },
    summary: (a) => `Add ${rupees(a.amount)} credit for ${a.customer}${a.note ? ` (${a.note})` : ""}`,
    run: async (ctx, a, executor = pool) => {
      const [c] = await q(
        `INSERT INTO customers (shop_id, name) VALUES ($1, $2)
         ON CONFLICT (shop_id, lower(name)) DO UPDATE SET name = customers.name
         RETURNING id, name, credit_limit`,
        [ctx.shopId, a.customer],
        executor
      );
      await q(
        `INSERT INTO ledger (shop_id, customer_id, amount, note, kind)
         VALUES ($1, $2, $3, $4, 'credit')`,
        [ctx.shopId, c.id, a.amount, a.note || "Credit sale"],
        executor
      );
      const balance = await customerBalance(ctx.shopId, c.id, executor);
      const warn =
        c.credit_limit != null && balance > c.credit_limit
          ? ` Warning: exceeds credit limit of ${rupees(c.credit_limit)}.`
          : "";
      return `Credit recorded for ${c.name}. Balance now ${rupees(balance)}.${warn}`;
    },
  },

  record_payment: {
    category: "customers",
    write: true,
    desc: "Record a payment received from an existing customer; reduces what they owe. Cannot exceed their balance.",
    schema: {
      customer: customerName,
      amount: money,
      method: z.enum(["cash", "upi", "card", "bank"]).optional(),
    },
    summary: (a) => `Record ${rupees(a.amount)} payment from ${a.customer}${a.method ? ` via ${a.method}` : ""}`,
    run: async (ctx, a, executor = pool) => {
      const c = await findCustomer(ctx.shopId, a.customer, executor);
      const balance = await customerBalance(ctx.shopId, c.id, executor);
      if (balance <= 0) throw toolError(409, `${c.name} has no outstanding balance.`);
      if (a.amount > balance + 0.005) {
        throw toolError(409, `${c.name} owes ${rupees(balance)}, less than the ${rupees(a.amount)} proposed.`);
      }
      await q(
        `INSERT INTO ledger (shop_id, customer_id, amount, note, kind)
         VALUES ($1, $2, $3, $4, 'payment')`,
        [ctx.shopId, c.id, -a.amount, `Payment received${a.method ? ` (${a.method})` : ""}`],
        executor
      );
      return `Payment of ${rupees(a.amount)} recorded from ${c.name}. Remaining: ${rupees(balance - a.amount)}.`;
    },
  },

  send_reminder: {
    category: "customers",
    write: true,
    desc: "Log payment reminders for named customers or everyone above a minimum due. Messaging is not connected yet, so nothing is actually delivered; use draft_reminder_message for the text.",
    schema: {
      customers: z.array(customerName).max(100).optional(),
      min_amount: moneyOrZero.optional(),
    },
    summary: (a) =>
      `Log payment reminders for ${
        a.customers?.length ? a.customers.join(", ") : `customers owing above ${rupees(a.min_amount ?? 0)}`
      }`,
    run: async (ctx, a, executor = pool) => {
      let rows = await dues(ctx.shopId, a.min_amount ?? 0, executor);
      if (a.customers?.length) {
        const wanted = new Set(a.customers.map((n) => n.toLowerCase()));
        rows = rows.filter((r) => wanted.has(r.name.toLowerCase()));
      }
      if (!rows.length) return "No matching customers owe money. No reminders logged.";
      for (const r of rows) {
        await audit(ctx.shopId, "system", "reminder_logged",
          { customer: r.name, due: r.due, delivery: "not_sent" }, executor);
      }
      return `Reminders logged for ${rows.map((r) => r.name).join(", ")}. No WhatsApp/SMS was sent.`;
    },
  },
};
