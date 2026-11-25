import { z } from "zod";
import { q, pool } from "../db.js";
import {
  LIMITS, productName, supplierName, quantity, moneyOrZero, note, phone, period, periodStart,
  findSupplier, toolError, rupees,
} from "./shared.js";

export const supplierTools = {
  list_suppliers: {
    category: "suppliers",
    desc: "List suppliers with contact details, total purchased, and last purchase date.",
    schema: { search: z.string().trim().max(LIMITS.name).optional() },
    run: async (ctx, { search = "" }) => {
      return q(
        `SELECT su.id, su.name, su.phone, su.notes, su.created_at,
                COALESCE(SUM(pu.total), 0) AS total_purchased,
                MAX(pu.created_at) AS last_purchase_at
         FROM suppliers su LEFT JOIN purchases pu ON pu.supplier_id = su.id
         WHERE su.shop_id = $1 AND ($2 = '' OR su.name ILIKE '%' || $2 || '%')
         GROUP BY su.id ORDER BY su.name`,
        [ctx.shopId, search]
      );
    },
  },

  list_purchases: {
    category: "suppliers",
    desc: "Stock purchases (goods received) in a period, optionally for one supplier.",
    schema: { period: period.optional(), supplier: supplierName.optional() },
    run: async (ctx, { period: p = "30d", supplier }) => {
      const rows = await q(
        `SELECT pu.id, pu.product_name, pu.qty, pu.unit_cost, pu.total, pu.created_at,
                su.name AS supplier
         FROM purchases pu LEFT JOIN suppliers su ON su.id = pu.supplier_id
         WHERE pu.shop_id = $1 AND pu.created_at >= ${periodStart(p)}
           AND ($2::text IS NULL OR su.name ILIKE $2)
         ORDER BY pu.created_at DESC LIMIT 500`,
        [ctx.shopId, supplier ?? null]
      );
      return { total: rows.reduce((s, r) => s + r.total, 0), purchases: rows };
    },
  },

  create_supplier: {
    category: "suppliers",
    write: true,
    desc: "Add a supplier / distributor.",
    schema: { name: supplierName, phone: phone.optional(), notes: note.optional() },
    summary: (a) => `Add supplier "${a.name}"`,
    run: async (ctx, a, executor = pool) => {
      try {
        const [row] = await q(
          `INSERT INTO suppliers (shop_id, name, phone, notes) VALUES ($1, $2, $3, $4)
           RETURNING id, name, phone, notes`,
          [ctx.shopId, a.name, a.phone ?? null, a.notes ?? null],
          executor
        );
        return { message: `Added supplier ${row.name}.`, supplier: row };
      } catch (error) {
        if (error.code === "23505") throw toolError(409, `Supplier "${a.name}" already exists.`);
        throw error;
      }
    },
  },

  update_supplier: {
    category: "suppliers",
    write: true,
    desc: "Update a supplier's name, phone or notes.",
    schema: {
      supplier: supplierName,
      new_name: supplierName.optional(),
      phone: phone.optional(),
      notes: note.optional(),
    },
    summary: (a) => `Update supplier ${a.supplier}`,
    run: async (ctx, a, executor = pool) => {
      const s = await findSupplier(ctx.shopId, a.supplier, executor, true);
      const [row] = await q(
        `UPDATE suppliers SET name = COALESCE($3, name), phone = COALESCE($4, phone),
           notes = COALESCE($5, notes)
         WHERE id = $1 AND shop_id = $2 RETURNING id, name, phone, notes`,
        [s.id, ctx.shopId, a.new_name ?? null, a.phone ?? null, a.notes ?? null],
        executor
      );
      return { message: `Updated ${row.name}.`, supplier: row };
    },
  },

  delete_supplier: {
    category: "suppliers",
    write: true,
    destructive: true,
    desc: "Delete a supplier. Their past purchases are kept without the supplier link.",
    schema: { supplier: supplierName },
    summary: (a) => `Delete supplier "${a.supplier}"`,
    run: async (ctx, a, executor = pool) => {
      const s = await findSupplier(ctx.shopId, a.supplier, executor, true);
      await q(`DELETE FROM suppliers WHERE id = $1 AND shop_id = $2`, [s.id, ctx.shopId], executor);
      return `Deleted supplier ${s.name}.`;
    },
  },

  record_purchase: {
    category: "suppliers",
    write: true,
    desc: "Record goods received from a supplier: adds stock, logs the purchase, and updates the product's cost price to the latest unit cost. Creates the product if new.",
    schema: {
      product: productName,
      qty: quantity,
      unit_cost: moneyOrZero,
      supplier: supplierName.optional(),
    },
    summary: (a) =>
      `Receive ${a.qty} × ${a.product} at ${rupees(a.unit_cost)} each` +
      (a.supplier ? ` from ${a.supplier}` : "") +
      ` (total ${rupees(a.qty * a.unit_cost)})`,
    run: async (ctx, a, executor = pool) => {
      const supplier = a.supplier ? await findSupplier(ctx.shopId, a.supplier, executor) : null;
      const [product] = await q(
        `INSERT INTO products (shop_id, name, qty, cost) VALUES ($1, $2, $3, $4)
         ON CONFLICT (shop_id, lower(name))
         DO UPDATE SET qty = products.qty + EXCLUDED.qty, cost = EXCLUDED.cost, updated_at = now()
         RETURNING id, name, qty`,
        [ctx.shopId, a.product, a.qty, a.unit_cost],
        executor
      );
      const total = Math.round(a.qty * a.unit_cost * 100) / 100;
      await q(
        `INSERT INTO purchases (shop_id, supplier_id, product_id, product_name, qty, unit_cost, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.shopId, supplier?.id ?? null, product.id, product.name, a.qty, a.unit_cost, total],
        executor
      );
      return `Received ${a.qty} ${product.name}${supplier ? ` from ${supplier.name}` : ""} for ${rupees(total)}. Stock now ${product.qty}.`;
    },
  },
};
