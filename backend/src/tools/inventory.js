import { z } from "zod";
import { q, pool } from "../db.js";
import {
  LIMITS, productName, quantity, moneyOrZero,
  findProduct, toolError, rupees,
} from "./shared.js";

const category = z.string().trim().min(1).max(60);
const unit = z.string().trim().min(1).max(20).describe("Unit of measure, e.g. bag, kg, piece");
const sku = z.string().trim().min(1).max(40);

// Effective reorder level: product-specific, else shop default.
const REORDER = "COALESCE(p.reorder_level, s.low_stock_threshold)";

export const inventoryTools = {
  // ---------------------------------------------------------------- READ
  list_products: {
    category: "inventory",
    desc: "List inventory with quantity, price, cost, category and stock status. Optionally filter by search text, category, or only low-stock items.",
    schema: {
      search: z.string().trim().max(LIMITS.name).optional(),
      category: category.optional(),
      low_stock_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    run: async (ctx, { search = "", category: cat, low_stock_only = false, limit = 200 }) => {
      const rows = await q(
        `SELECT p.id, p.name, p.sku, p.category, p.unit, p.qty, p.price, p.cost,
                ${REORDER} AS reorder_level,
                (p.qty <= ${REORDER}) AS low_stock,
                p.updated_at
         FROM products p JOIN shops s ON s.id = p.shop_id
         WHERE p.shop_id = $1
           AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%')
           AND ($3::text IS NULL OR lower(p.category) = lower($3))
           AND (NOT $4 OR p.qty <= ${REORDER})
         ORDER BY p.name
         LIMIT $5`,
        [ctx.shopId, search, cat ?? null, low_stock_only, limit]
      );
      return { count: rows.length, products: rows };
    },
  },

  get_stock: {
    category: "inventory",
    desc: "Quick stock check: current quantity for products matching a full or partial name. Use before any stock change.",
    schema: { product: z.string().trim().max(LIMITS.name).optional() },
    run: async (ctx, { product = "" }) => {
      const rows = await q(
        `SELECT name, qty, unit FROM products
         WHERE shop_id = $1 AND ($2 = '' OR name ILIKE '%' || $2 || '%')
         ORDER BY name LIMIT 200`,
        [ctx.shopId, product]
      );
      return rows.length ? rows : "No matching products.";
    },
  },

  product_details: {
    category: "inventory",
    desc: "Full profile of one product: stock, pricing, margin, inventory value, 30-day sales velocity, days of stock cover, and recent purchases.",
    schema: { product: productName },
    run: async (ctx, { product }) => {
      const p = await findProduct(ctx.shopId, product);
      const [velocity] = await q(
        `SELECT COALESCE(SUM(si.qty), 0) AS sold_30d,
                COALESCE(SUM(si.qty * si.unit_price), 0) AS revenue_30d
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.shop_id = $1 AND si.product_id = $2 AND s.status = 'completed'
           AND s.created_at >= now() - interval '30 days'`,
        [ctx.shopId, p.id]
      );
      const purchases = await q(
        `SELECT pu.qty, pu.unit_cost, pu.created_at, su.name AS supplier
         FROM purchases pu LEFT JOIN suppliers su ON su.id = pu.supplier_id
         WHERE pu.shop_id = $1 AND pu.product_id = $2
         ORDER BY pu.created_at DESC LIMIT 5`,
        [ctx.shopId, p.id]
      );
      const dailyRate = velocity.sold_30d / 30;
      return {
        ...p,
        margin_per_unit: p.price - p.cost,
        margin_pct: p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 1000) / 10 : null,
        stock_value_at_cost: p.qty * p.cost,
        sold_last_30_days: velocity.sold_30d,
        revenue_last_30_days: velocity.revenue_30d,
        days_of_cover: dailyRate > 0 ? Math.round(p.qty / dailyRate) : null,
        recent_purchases: purchases,
      };
    },
  },

  low_stock_report: {
    category: "inventory",
    desc: "Products at or below their reorder level, with a suggested reorder quantity based on the last 30 days of sales.",
    schema: {},
    run: async (ctx) => {
      const rows = await q(
        `SELECT p.name, p.qty, p.unit, ${REORDER} AS reorder_level,
                COALESCE(v.sold, 0) AS sold_30d
         FROM products p
         JOIN shops s ON s.id = p.shop_id
         LEFT JOIN (
           SELECT si.product_id, SUM(si.qty) AS sold
           FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
           WHERE sa.shop_id = $1 AND sa.status = 'completed'
             AND sa.created_at >= now() - interval '30 days'
           GROUP BY si.product_id
         ) v ON v.product_id = p.id
         WHERE p.shop_id = $1 AND p.qty <= ${REORDER}
         ORDER BY (p.qty::float / GREATEST(${REORDER}, 1)) ASC, p.name`,
        [ctx.shopId]
      );
      return rows.map((r) => ({
        ...r,
        // Cover ~30 days of demand, at least back up to 2x the reorder level.
        suggested_reorder_qty: Math.max(
          Math.ceil(r.sold_30d - r.qty),
          r.reorder_level * 2 - r.qty,
          1
        ),
      }));
    },
  },

  inventory_valuation: {
    category: "inventory",
    desc: "Total inventory value at cost and at selling price, broken down by category.",
    schema: {},
    run: async (ctx) => {
      const rows = await q(
        `SELECT COALESCE(category, 'Uncategorised') AS category,
                COUNT(*) AS products, SUM(qty) AS units,
                SUM(qty * cost) AS value_at_cost, SUM(qty * price) AS value_at_price
         FROM products WHERE shop_id = $1
         GROUP BY 1 ORDER BY value_at_cost DESC`,
        [ctx.shopId]
      );
      const total = rows.reduce(
        (acc, r) => ({
          value_at_cost: acc.value_at_cost + r.value_at_cost,
          value_at_price: acc.value_at_price + r.value_at_price,
        }),
        { value_at_cost: 0, value_at_price: 0 }
      );
      return { ...total, potential_gross_profit: total.value_at_price - total.value_at_cost, by_category: rows };
    },
  },

  // ---------------------------------------------------------------- WRITE
  create_product: {
    category: "inventory",
    write: true,
    desc: "Create a new product with optional opening stock, price, cost, category, unit, SKU and reorder level.",
    schema: {
      name: productName,
      qty: z.number().int().nonnegative().max(LIMITS.stock).optional(),
      price: moneyOrZero.optional(),
      cost: moneyOrZero.optional(),
      category: category.optional(),
      unit: unit.optional(),
      sku: sku.optional(),
      reorder_level: z.number().int().nonnegative().max(LIMITS.stock).optional(),
    },
    summary: (a) =>
      `Create product "${a.name}"` +
      (a.qty ? ` with ${a.qty} in stock` : "") +
      (a.price ? ` at ${rupees(a.price)}` : ""),
    run: async (ctx, a, executor = pool) => {
      try {
        const [row] = await q(
          `INSERT INTO products (shop_id, name, qty, price, cost, category, unit, sku, reorder_level)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'unit'), $8, $9)
           RETURNING id, name, qty, price, cost, category, unit, sku, reorder_level`,
          [ctx.shopId, a.name, a.qty ?? 0, a.price ?? 0, a.cost ?? 0,
            a.category ?? null, a.unit ?? null, a.sku ?? null, a.reorder_level ?? null],
          executor
        );
        return { message: `Created ${row.name}.`, product: row };
      } catch (error) {
        if (error.code === "23505") throw toolError(409, `A product named "${a.name}" already exists.`);
        throw error;
      }
    },
  },

  update_product: {
    category: "inventory",
    write: true,
    desc: "Update a product's details: rename, price, cost, category, unit, SKU or reorder level. Does not change quantity (use stock tools for that).",
    schema: {
      product: productName,
      new_name: productName.optional(),
      price: moneyOrZero.optional(),
      cost: moneyOrZero.optional(),
      category: category.optional(),
      unit: unit.optional(),
      sku: sku.optional(),
      reorder_level: z.number().int().nonnegative().max(LIMITS.stock).optional(),
    },
    summary: (a) => {
      const changes = ["new_name", "price", "cost", "category", "unit", "sku", "reorder_level"]
        .filter((k) => a[k] !== undefined)
        .map((k) => `${k.replace("_", " ")} → ${["price", "cost"].includes(k) ? rupees(a[k]) : a[k]}`);
      return `Update ${a.product}: ${changes.join(", ") || "no changes"}`;
    },
    run: async (ctx, a, executor = pool) => {
      const p = await findProduct(ctx.shopId, a.product, executor);
      try {
        const [row] = await q(
          `UPDATE products SET
             name = COALESCE($3, name), price = COALESCE($4, price), cost = COALESCE($5, cost),
             category = COALESCE($6, category), unit = COALESCE($7, unit), sku = COALESCE($8, sku),
             reorder_level = COALESCE($9, reorder_level), updated_at = now()
           WHERE id = $1 AND shop_id = $2
           RETURNING id, name, qty, price, cost, category, unit, sku, reorder_level`,
          [p.id, ctx.shopId, a.new_name ?? null, a.price ?? null, a.cost ?? null,
            a.category ?? null, a.unit ?? null, a.sku ?? null, a.reorder_level ?? null],
          executor
        );
        return { message: `Updated ${row.name}.`, product: row };
      } catch (error) {
        if (error.code === "23505") throw toolError(409, `A product named "${a.new_name}" already exists.`);
        throw error;
      }
    },
  },

  delete_product: {
    category: "inventory",
    write: true,
    destructive: true,
    desc: "Permanently delete a product from inventory. Past sales keep the product name for history.",
    schema: { product: productName },
    summary: (a) => `Delete product "${a.product}" permanently`,
    run: async (ctx, a, executor = pool) => {
      const p = await findProduct(ctx.shopId, a.product, executor);
      await q(`DELETE FROM products WHERE id = $1 AND shop_id = $2`, [p.id, ctx.shopId], executor);
      return { message: `Deleted ${p.name} (had ${p.qty} ${p.unit} in stock).` };
    },
  },

  add_stock: {
    category: "inventory",
    write: true,
    desc: "Add a positive quantity to a product's stock. Creates the product if it does not exist.",
    schema: { product: productName, quantity },
    summary: (a) => `Add ${a.quantity} × ${a.product} to stock`,
    run: async (ctx, a, executor = pool) => {
      const [row] = await q(
        `INSERT INTO products (shop_id, name, qty) VALUES ($1, $2, $3)
         ON CONFLICT (shop_id, lower(name))
         DO UPDATE SET qty = products.qty + EXCLUDED.qty, updated_at = now()
         WHERE products.qty <= ${LIMITS.dbInt} - EXCLUDED.qty
         RETURNING name, qty`,
        [ctx.shopId, a.product, a.quantity],
        executor
      );
      if (!row) throw toolError(409, "Stock quantity would exceed the supported limit.");
      return `${row.name}: added ${a.quantity}. Current stock: ${row.qty}.`;
    },
  },

  remove_stock: {
    category: "inventory",
    write: true,
    desc: "Remove a specific positive quantity from a product (damage, loss, internal use). Never lets stock go negative. For sales, use record_sale instead.",
    schema: { product: productName, quantity, reason: z.string().trim().max(200).optional() },
    summary: (a) => `Remove ${a.quantity} × ${a.product} from stock${a.reason ? ` (${a.reason})` : ""}`,
    run: async (ctx, a, executor = pool) => {
      const p = await findProduct(ctx.shopId, a.product, executor);
      if (p.qty < a.quantity) {
        throw toolError(409, `${p.name} has only ${p.qty} available; cannot remove ${a.quantity}.`);
      }
      const [row] = await q(
        `UPDATE products SET qty = qty - $3, updated_at = now()
         WHERE id = $1 AND shop_id = $2 AND qty >= $3 RETURNING name, qty`,
        [p.id, ctx.shopId, a.quantity],
        executor
      );
      return `Removed ${a.quantity} from ${row.name}. Remaining: ${row.qty}.`;
    },
  },

  adjust_stock: {
    category: "inventory",
    write: true,
    desc: "Set a product's stock to an exact counted quantity (stock-take correction). May be zero.",
    schema: { product: productName, quantity: z.number().int().nonnegative().max(LIMITS.dbInt) },
    summary: (a) => `Set ${a.product} stock to ${a.quantity}`,
    run: async (ctx, a, executor = pool) => {
      const p = await findProduct(ctx.shopId, a.product, executor);
      await q(
        `UPDATE products SET qty = $3, updated_at = now() WHERE id = $1 AND shop_id = $2`,
        [p.id, ctx.shopId, a.quantity],
        executor
      );
      return `${p.name} stock adjusted from ${p.qty} to ${a.quantity}.`;
    },
  },

  clear_stock: {
    category: "inventory",
    write: true,
    desc: "Set ALL stock of a product to zero (when the owner says remove all / clear / empty). Do not estimate quantities.",
    schema: { product: productName },
    summary: (a) => `Clear all ${a.product} stock (set to zero)`,
    run: async (ctx, a, executor = pool) => {
      const p = await findProduct(ctx.shopId, a.product, executor);
      await q(
        `UPDATE products SET qty = 0, updated_at = now() WHERE id = $1 AND shop_id = $2`,
        [p.id, ctx.shopId],
        executor
      );
      return `All ${p.qty} units of ${p.name} removed. Current stock: 0.`;
    },
  },
};
