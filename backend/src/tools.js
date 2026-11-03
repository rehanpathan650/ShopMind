import { z } from "zod";
import { q, pool, audit } from "./db.js";

// ==================================================
// CONSTANTS
// ==================================================

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_CUSTOMER_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;

const MAX_STOCK_QUANTITY = 1_000_000;
const MAX_DB_INTEGER = 2_147_483_647;
const MAX_TRANSACTION_AMOUNT = 1_000_000_000;

// ==================================================
// VALIDATION SCHEMAS
// ==================================================

const productNameSchema = z
  .string()
  .trim()
  .min(1, "Product name is required")
  .max(MAX_PRODUCT_NAME_LENGTH)
  .refine(
    (name) =>
      ![
        "product",
        "item",
        "product name",
        "unknown",
      ].includes(name.toLowerCase()),
    "Use the actual product name, not a generic placeholder."
  )
  .describe(
    "The exact product name from the shop's inventory, such as 'Cement bag'. Never use generic words like 'product' or 'item'."
  );

const customerNameSchema = z
  .string()
  .trim()
  .min(1, "Customer name is required")
  .max(MAX_CUSTOMER_NAME_LENGTH);

const positiveAmountSchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_TRANSACTION_AMOUNT);

const minimumAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_TRANSACTION_AMOUNT);

// ==================================================
// HELPERS
// ==================================================

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const formatRupees = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    throw new Error("Invalid monetary value returned by database");
  }

  return inrFormatter.format(value);
};

const createToolError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

// ==================================================
// DATABASE HELPERS
// ==================================================

export const dues = async (shop, min = 0, executor = pool) => {
  const rows = await q(
    `SELECT
       c.id,
       c.name,
       SUM(l.amount)::numeric AS due
     FROM customers c
     INNER JOIN ledger l
       ON l.customer_id = c.id
       AND l.shop_id = c.shop_id
     WHERE c.shop_id = $1
     GROUP BY c.id, c.name
     HAVING SUM(l.amount) > $2
     ORDER BY SUM(l.amount) DESC, c.name ASC`,
    [shop, min],
    executor
  );

  return rows.map((row) => ({
    ...row,
    due: Number(row.due),
  }));
};

export const stock = async (shop, product = "", executor = pool) => {
  const search = typeof product === "string" ? product.trim() : "";

  return q(
    `SELECT name, qty
     FROM products
     WHERE shop_id = $1
       AND ($2 = '' OR name ILIKE $3)
     ORDER BY name ASC
     LIMIT 200`,
    [shop, search, `%${search}%`],
    executor
  );
};

const balance = async (shop, customerId, executor = pool) => {
  const [row] = await q(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS balance
     FROM ledger
     WHERE shop_id = $1
       AND customer_id = $2`,
    [shop, customerId],
    executor
  );

  return Number(row.balance);
};

// ==================================================
// PRODUCT LOOKUP
// ==================================================

/**
 * Resolve a product using:
 * 1. Exact case-insensitive match.
 * 2. Unique partial match.
 *
 * Locks the selected product row when used inside
 * the action confirmation transaction.
 */
const findProduct = async (shop, productName, executor = pool) => {
  const name = productName.trim();

  const [exact] = await q(
    `SELECT id, name, qty
     FROM products
     WHERE shop_id = $1
       AND lower(name) = lower($2)
     LIMIT 1
     FOR UPDATE`,
    [shop, name],
    executor
  );

  if (exact) {
    return exact;
  }

  const matches = await q(
    `SELECT id, name, qty
     FROM products
     WHERE shop_id = $1
       AND position(lower($2) in lower(name)) > 0
     ORDER BY name ASC
     LIMIT 6
     FOR UPDATE`,
    [shop, name],
    executor
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw createToolError(
      409,
      `Multiple products match "${name}": ${matches
        .map((item) => item.name)
        .join(", ")}. Please specify the exact product name.`
    );
  }

  throw createToolError(
    404,
    `Product "${name}" was not found in your inventory.`
  );
};

// ==================================================
// CUSTOMER LOOKUP
// ==================================================

const findCustomer = async (shop, customerName, executor = pool) => {
  const name = customerName.trim();

  const [exactMatch] = await q(
    `SELECT id, name
     FROM customers
     WHERE shop_id = $1
       AND lower(name) = lower($2)
     LIMIT 1
     FOR UPDATE`,
    [shop, name],
    executor
  );

  if (exactMatch) {
    return {
      customer: exactMatch,
      ambiguous: false,
    };
  }

  const matches = await q(
    `SELECT id, name
     FROM customers
     WHERE shop_id = $1
       AND position(lower($2) in lower(name)) > 0
     ORDER BY name ASC
     LIMIT 6
     FOR UPDATE`,
    [shop, name],
    executor
  );

  if (matches.length === 1) {
    return {
      customer: matches[0],
      ambiguous: false,
    };
  }

  if (matches.length > 1) {
    return {
      customer: null,
      ambiguous: true,
      matches: matches.map((item) => item.name),
    };
  }

  return {
    customer: null,
    ambiguous: false,
    matches: [],
  };
};

// ==================================================
// MCP TOOL DEFINITIONS
// ==================================================

export const tools = {

  // --------------------------------------------------
  // GET CUSTOMER DUES
  // --------------------------------------------------

  get_dues: {
    desc:
      "List customers who owe money (credit/udhaar), " +
      "optionally filtering customers above a minimum amount in rupees.",

    schema: {
      min_amount: minimumAmountSchema.optional(),
    },

    run: async (ctx, { min_amount = 0 }) => {
      const rows = await dues(ctx.shopId, min_amount);

      if (!rows.length) {
        return "No dues found.";
      }

      return rows
        .map((customer) =>
          `${customer.name}: ${formatRupees(customer.due)}`
        )
        .join("\n");
    },
  },

  // --------------------------------------------------
  // GET STOCK
  // --------------------------------------------------

  get_stock: {
    desc:
      "Show current inventory quantities. " +
      "Can search by full or partial product name.",

    schema: {
      product: z
        .string()
        .trim()
        .max(MAX_PRODUCT_NAME_LENGTH)
        .optional(),
    },

    run: async (ctx, { product = "" }) => {
      const rows = await stock(ctx.shopId, product);

      if (!rows.length) {
        return "No matching products.";
      }

      return rows
        .map((item) => `${item.name}: ${item.qty} units`)
        .join("\n");
    },
  },

  // --------------------------------------------------
  // ADD STOCK
  // --------------------------------------------------

  add_stock: {
    write: true,

    desc:
      "Add a positive quantity to a product's stock. " +
      "Creates the product if it does not exist. " +
      "Requires owner confirmation.",

    schema: {
      product: productNameSchema,

      quantity: z
        .number()
        .int()
        .positive()
        .max(MAX_STOCK_QUANTITY),
    },

    summary: (args) =>
      `Add ${args.quantity} × ${args.product} to stock`,

    run: async (ctx, args, executor = pool) => {
      const [result] = await q(
        `INSERT INTO products (shop_id, name, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (shop_id, lower(name))
         DO UPDATE SET
           qty = products.qty + EXCLUDED.qty
         WHERE products.qty <= 2147483647 - EXCLUDED.qty
         RETURNING name, qty`,
        [
          ctx.shopId,
          args.product.trim(),
          args.quantity,
        ],
        executor
      );

      if (!result) {
        throw createToolError(
          409,
          "Stock quantity would exceed the supported database limit."
        );
      }

      return (
        `${result.name}: added ${args.quantity} units. ` +
        `Current stock: ${result.qty} units.`
      );
    },
  },

  // --------------------------------------------------
  // REMOVE A SPECIFIC QUANTITY
  // --------------------------------------------------

  remove_stock: {
    write: true,

    desc:
      "Remove a specified positive quantity from an existing product. " +
      "Never allow inventory to become negative. " +
      "Use get_stock first when the owner asks to remove all available units. " +
      "Requires owner confirmation.",

    schema: {
      product: productNameSchema,

      quantity: z
        .number()
        .int()
        .positive()
        .max(MAX_STOCK_QUANTITY),
    },

    summary: (args) =>
      `Remove ${args.quantity} × ${args.product} from stock`,

    run: async (ctx, args, executor = pool) => {
      const product = await findProduct(
        ctx.shopId,
        args.product,
        executor
      );

      if (product.qty < args.quantity) {
        throw createToolError(
          409,
          `${product.name} has only ${product.qty} units available. ` +
          `Cannot remove ${args.quantity} units.`
        );
      }

      const [result] = await q(
        `UPDATE products
         SET qty = qty - $3
         WHERE id = $1
           AND shop_id = $2
           AND qty >= $3
         RETURNING name, qty`,
        [
          product.id,
          ctx.shopId,
          args.quantity,
        ],
        executor
      );

      if (!result) {
        throw createToolError(
          409,
          "Stock changed before the removal could be completed. Please check inventory again."
        );
      }

      return (
        `${args.quantity} units removed from ${result.name}. ` +
        `Remaining stock: ${result.qty} units.`
      );
    },
  },

  // --------------------------------------------------
  // SET STOCK TO AN EXACT QUANTITY
  // --------------------------------------------------

  adjust_stock: {
    write: true,

    desc:
      "Set an existing product's stock to an exact quantity. " +
      "The quantity may be zero. " +
      "Use this when the owner wants to correct inventory to a known count. " +
      "Requires owner confirmation.",

    schema: {
      product: productNameSchema,

      quantity: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_DB_INTEGER),
    },

    summary: (args) =>
      `Set ${args.product} stock to ${args.quantity} units`,

    run: async (ctx, args, executor = pool) => {
      const product = await findProduct(
        ctx.shopId,
        args.product,
        executor
      );

      const [result] = await q(
        `UPDATE products
         SET qty = $3
         WHERE id = $1
           AND shop_id = $2
         RETURNING name, qty`,
        [
          product.id,
          ctx.shopId,
          args.quantity,
        ],
        executor
      );

      if (!result) {
        throw createToolError(
          409,
          "Could not update inventory. Please try again."
        );
      }

      return (
        `${result.name} stock adjusted from ${product.qty} ` +
        `to ${result.qty} units.`
      );
    },
  },

  // --------------------------------------------------
  // CLEAR ALL STOCK
  // --------------------------------------------------

  clear_stock: {
    write: true,

    desc:
      "Remove ALL available units of an existing product by setting its " +
      "quantity to zero. Use this when the owner says remove all, clear all, " +
      "or empty the stock of a product. Do not estimate the quantity. " +
      "Requires owner confirmation.",

    schema: {
      product: productNameSchema,
    },

    summary: (args) =>
      `Remove all ${args.product} from stock (set quantity to zero)`,

    run: async (ctx, args, executor = pool) => {
      const product = await findProduct(
        ctx.shopId,
        args.product,
        executor
      );

      const [result] = await q(
        `UPDATE products
         SET qty = 0
         WHERE id = $1
           AND shop_id = $2
         RETURNING name, qty`,
        [
          product.id,
          ctx.shopId,
        ],
        executor
      );

      if (!result) {
        throw createToolError(
          409,
          "Could not clear inventory. Please try again."
        );
      }

      return (
        `All ${product.qty} units of ${result.name} have been removed. ` +
        `Current stock: 0 units.`
      );
    },
  },

  // --------------------------------------------------
  // RECORD CREDIT SALE
  // --------------------------------------------------

  record_credit_sale: {
    write: true,

    desc:
      "Record a customer's credit purchase (udhaar). " +
      "Increases the customer's outstanding balance. " +
      "Requires owner confirmation.",

    schema: {
      customer: customerNameSchema,

      amount: positiveAmountSchema,

      note: z
        .string()
        .trim()
        .max(MAX_NOTE_LENGTH)
        .optional(),
    },

    summary: (args) =>
      `Add ${formatRupees(args.amount)} credit for ${args.customer}` +
      (args.note ? ` (${args.note})` : ""),

    run: async (ctx, args, executor = pool) => {
      const [customer] = await q(
        `INSERT INTO customers (shop_id, name)
         VALUES ($1, $2)
         ON CONFLICT (shop_id, lower(name))
         DO UPDATE SET name = customers.name
         RETURNING id, name`,
        [
          ctx.shopId,
          args.customer.trim(),
        ],
        executor
      );

      await q(
        `INSERT INTO ledger
          (shop_id, customer_id, amount, note)
         VALUES ($1, $2, $3, $4)`,
        [
          ctx.shopId,
          customer.id,
          args.amount,
          args.note?.trim() || "Credit sale",
        ],
        executor
      );

      const newBalance = await balance(
        ctx.shopId,
        customer.id,
        executor
      );

      return (
        `Credit sale recorded for ${customer.name}. ` +
        `Current outstanding balance: ${formatRupees(newBalance)}.`
      );
    },
  },

  // --------------------------------------------------
  // RECORD PAYMENT
  // --------------------------------------------------

  record_payment: {
    write: true,

    desc:
      "Record a payment received from an existing customer. " +
      "Reduces the customer's outstanding balance. " +
      "Requires owner confirmation.",

    schema: {
      customer: customerNameSchema,
      amount: positiveAmountSchema,
    },

    summary: (args) =>
      `Record ${formatRupees(args.amount)} payment from ${args.customer}`,

    run: async (ctx, args, executor = pool) => {
      const match = await findCustomer(
        ctx.shopId,
        args.customer,
        executor
      );

      if (match.ambiguous) {
        throw createToolError(
          409,
          `Multiple customers match "${args.customer}": ` +
          `${match.matches.join(", ")}. Please specify the exact customer.`
        );
      }

      if (!match.customer) {
        throw createToolError(
          404,
          `Customer "${args.customer}" was not found. No payment was recorded.`
        );
      }

      const customer = match.customer;

      // The customer row is locked by findCustomer inside
      // the confirmation transaction, preventing concurrent
      // payment confirmations from racing against each other.
      const currentBalance = await balance(
        ctx.shopId,
        customer.id,
        executor
      );

      if (currentBalance <= 0) {
        throw createToolError(
          409,
          `${customer.name} has no outstanding balance. No payment was recorded.`
        );
      }

      if (args.amount > currentBalance) {
        throw createToolError(
          409,
          `${customer.name} owes ${formatRupees(currentBalance)}, ` +
          `but the proposed payment is ${formatRupees(args.amount)}. ` +
          "No payment was recorded."
        );
      }

      await q(
        `INSERT INTO ledger
          (shop_id, customer_id, amount, note)
         VALUES ($1, $2, $3, $4)`,
        [
          ctx.shopId,
          customer.id,
          -args.amount,
          "Payment received",
        ],
        executor
      );

      const newBalance = await balance(
        ctx.shopId,
        customer.id,
        executor
      );

      return (
        `Payment of ${formatRupees(args.amount)} recorded from ${customer.name}. ` +
        `Remaining balance: ${formatRupees(newBalance)}.`
      );
    },
  },

  // --------------------------------------------------
  // PREPARE PAYMENT REMINDERS
  // --------------------------------------------------

  send_reminder: {
    write: true,

    desc:
      "Prepare payment reminder records for named customers," +
      "or customers owing above a minimum amount. " +
      "Requires owner confirmation. " +
      "This prototype does not actually send WhatsApp or SMS messages.",

    schema: {
      customers: z
        .array(customerNameSchema)
        .max(100)
        .optional(),

      min_amount: minimumAmountSchema.optional(),
    },

    summary: (args) =>
      `Prepare payment reminders for ${
        args.customers?.length
          ? args.customers.join(", ")
          : `customers owing above ${formatRupees(args.min_amount ?? 0)}`
      }`,

    run: async (ctx, args, executor = pool) => {
      const minimum = args.min_amount ?? 0;

      let customers = await dues(
        ctx.shopId,
        minimum,
        executor
      );

      if (args.customers?.length) {
        const requestedNames = args.customers.map((name) =>
          name.trim().toLowerCase()
        );

        customers = customers.filter((customer) =>
          requestedNames.includes(customer.name.toLowerCase())
        );
      }

      if (!customers.length) {
        return "No matching customers owe money. No reminder records were created.";
      }

      for (const customer of customers) {
        await audit(
          ctx.shopId,
          "system",
          "reminder_prepared",
          {
            customer: customer.name,
            due: customer.due,
            deliveryStatus: "not_sent",
          },
          executor
        );
      }

      return (
        `Reminder preparation recorded for ${customers.length} customers: ` +
        `${customers.map((customer) => customer.name).join(", ")}. ` +
        "No WhatsApp or SMS messages have been sent."
      );
    },
  },
};
