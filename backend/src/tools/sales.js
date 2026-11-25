import { z } from "zod";
import { q, pool } from "../db.js";
import {
  productName, customerName, quantity, moneyOrZero, note, period, periodStart,
  PAYMENT_METHODS, findProduct, findCustomer, customerBalance, toolError, rupees,
} from "./shared.js";
import { isUuid } from "../lib/http.js";

const saleItem = z.object({
  product: productName,
  qty: quantity,
  unit_price: moneyOrZero.optional().describe("Override price per unit; defaults to the product's listed price."),
});

export const salesTools = {
  // ---------------------------------------------------------------- READ
  list_sales: {
    category: "sales",
    desc: "Recent sales (bills) with total, payment method, customer and item count. Filter by period, payment method or customer.",
    schema: {
      period: period.optional(),
      payment_method: z.enum(PAYMENT_METHODS).optional(),
      customer: customerName.optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    run: async (ctx, { period: p = "30d", payment_method, customer, limit = 100 }) => {
      const rows = await q(
        `SELECT s.id, s.created_at, s.total, s.discount, s.payment_method, s.status, s.note,
                c.name AS customer,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.shop_id = $1 AND s.created_at >= ${periodStart(p)}
           AND ($2::text IS NULL OR s.payment_method = $2)
           AND ($3::text IS NULL OR c.name ILIKE $3)
         ORDER BY s.created_at DESC LIMIT $4`,
        [ctx.shopId, payment_method ?? null, customer ?? null, limit]
      );
      return { count: rows.length, sales: rows };
    },
  },

  sale_details: {
    category: "sales",
    desc: "Full bill for one sale by its ID: line items, prices, customer, payment method and status.",
    schema: { sale_id: z.string().uuid() },
    run: async (ctx, { sale_id }) => {
      const [sale] = await q(
        `SELECT s.*, c.name AS customer FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.id = $1 AND s.shop_id = $2`,
        [sale_id, ctx.shopId]
      );
      if (!sale) throw toolError(404, "Sale not found.");
      const items = await q(
        `SELECT product_name, qty, unit_price, qty * unit_price AS line_total
         FROM sale_items WHERE sale_id = $1 ORDER BY id`,
        [sale_id]
      );
      return { ...sale, items };
    },
  },

  sales_report: {
    category: "sales",
    desc: "Revenue report for a period: total revenue, bills, average bill, gross profit, split by payment method, and daily revenue series.",
    schema: { period: period.optional() },
    run: async (ctx, { period: p = "30d" }) => {
      const start = periodStart(p);
      const [totals] = await q(
        `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS revenue,
                COALESCE(AVG(total), 0) AS avg_bill
         FROM sales WHERE shop_id = $1 AND status = 'completed' AND created_at >= ${start}`,
        [ctx.shopId]
      );
      const [profit] = await q(
        `SELECT COALESCE(SUM(si.qty * (si.unit_price - si.unit_cost)), 0) AS gross_profit
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.shop_id = $1 AND s.status = 'completed' AND s.created_at >= ${start}`,
        [ctx.shopId]
      );
      const byMethod = await q(
        `SELECT payment_method, COUNT(*) AS bills, SUM(total) AS revenue
         FROM sales WHERE shop_id = $1 AND status = 'completed' AND created_at >= ${start}
         GROUP BY payment_method ORDER BY revenue DESC`,
        [ctx.shopId]
      );
      const daily = await q(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(s.total), 0) AS revenue,
                COUNT(s.id) AS bills
         FROM generate_series(date_trunc('day', ${start}), date_trunc('day', now()), interval '1 day') d
         LEFT JOIN sales s ON s.shop_id = $1 AND s.status = 'completed'
           AND date_trunc('day', s.created_at) = d
         GROUP BY d ORDER BY d`,
        [ctx.shopId]
      );
      return {
        period: p,
        revenue: totals.revenue,
        bills: totals.bills,
        avg_bill: Math.round(totals.avg_bill * 100) / 100,
        gross_profit: profit.gross_profit,
        by_payment_method: byMethod,
        daily,
      };
    },
  },

  top_products: {
    category: "sales",
    desc: "Best-selling products in a period, ranked by revenue or by quantity, with gross profit for each.",
    schema: {
      period: period.optional(),
      rank_by: z.enum(["revenue", "quantity", "profit"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    run: async (ctx, { period: p = "30d", rank_by = "revenue", limit = 10 }) => {
      const order = { revenue: "revenue", quantity: "qty", profit: "profit" }[rank_by];
      return q(
        `SELECT si.product_name AS product, SUM(si.qty) AS qty,
                SUM(si.qty * si.unit_price) AS revenue,
                SUM(si.qty * (si.unit_price - si.unit_cost)) AS profit
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.shop_id = $1 AND s.status = 'completed' AND s.created_at >= ${periodStart(p)}
         GROUP BY si.product_name ORDER BY ${order} DESC LIMIT $2`,
        [ctx.shopId, limit]
      );
    },
  },

  // ---------------------------------------------------------------- WRITE
  record_sale: {
    category: "sales",
    write: true,
    desc: "Record an itemised sale (bill). Deducts stock for each item, records revenue and cost, and if paid on credit adds the total to the customer's dues. Fails if any item lacks stock.",
    schema: {
      items: z.array(saleItem).min(1).max(50),
      payment_method: z.enum(PAYMENT_METHODS).optional().describe("cash (default), upi, card, or credit"),
      customer: customerName.optional().describe("Required when payment_method is credit."),
      discount: moneyOrZero.optional().describe("Flat discount in rupees on the whole bill."),
      note: note.optional(),
    },
    summary: (a) => {
      const items = a.items.map((i) => `${i.qty} × ${i.product}`).join(", ");
      const method = a.payment_method || "cash";
      return `Sell ${items}` +
        (a.customer ? ` to ${a.customer}` : "") +
        ` (${method}${a.discount ? `, ${rupees(a.discount)} off` : ""})`;
    },
    run: async (ctx, a, executor = pool) => {
      const method = a.payment_method || "cash";
      if (method === "credit" && !a.customer) {
        throw toolError(400, "A customer is required for a credit sale.");
      }

      let customer = null;
      if (a.customer) {
        if (method === "credit") {
          [customer] = await q(
            `INSERT INTO customers (shop_id, name) VALUES ($1, $2)
             ON CONFLICT (shop_id, lower(name)) DO UPDATE SET name = customers.name
             RETURNING id, name, credit_limit`,
            [ctx.shopId, a.customer],
            executor
          );
        } else {
          customer = await findCustomer(ctx.shopId, a.customer, executor);
        }
      }

      // Resolve and lock every product first, aggregating duplicate lines.
      const lines = [];
      for (const item of a.items) {
        const p = await findProduct(ctx.shopId, item.product, executor);
        const existing = lines.find((l) => l.product.id === p.id);
        const unitPrice = item.unit_price ?? p.price;
        if (existing) existing.qty += item.qty;
        else lines.push({ product: p, qty: item.qty, unitPrice });
      }
      for (const l of lines) {
        if (l.product.qty < l.qty) {
          throw toolError(409, `Not enough ${l.product.name}: ${l.product.qty} in stock, ${l.qty} requested.`);
        }
        if (!(l.unitPrice > 0)) {
          throw toolError(400, `${l.product.name} has no selling price. Provide unit_price or set its price first.`);
        }
      }

      const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const discount = Math.min(a.discount ?? 0, subtotal);
      const total = Math.round((subtotal - discount) * 100) / 100;

      const [sale] = await q(
        `INSERT INTO sales (shop_id, customer_id, payment_method, total, discount, note)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [ctx.shopId, customer?.id ?? null, method, total, discount, a.note ?? null],
        executor
      );

      for (const l of lines) {
        await q(
          `INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sale.id, l.product.id, l.product.name, l.qty, l.unitPrice, l.product.cost],
          executor
        );
        await q(
          `UPDATE products SET qty = qty - $3, updated_at = now()
           WHERE id = $1 AND shop_id = $2`,
          [l.product.id, ctx.shopId, l.qty],
          executor
        );
      }

      let creditNote = "";
      if (method === "credit") {
        await q(
          `INSERT INTO ledger (shop_id, customer_id, amount, note, kind, sale_id)
           VALUES ($1, $2, $3, $4, 'sale', $5)`,
          [ctx.shopId, customer.id, total, `Bill ${sale.id.slice(0, 8)}`, sale.id],
          executor
        );
        const balance = await customerBalance(ctx.shopId, customer.id, executor);
        creditNote = ` Added to ${customer.name}'s dues; balance now ${rupees(balance)}.`;
      }

      return {
        message: `Sale recorded: ${rupees(total)} via ${method}.${creditNote}`,
        sale_id: sale.id,
        total,
        items: lines.map((l) => ({ product: l.product.name, qty: l.qty, unit_price: l.unitPrice })),
      };
    },
  },

  void_sale: {
    category: "sales",
    write: true,
    destructive: true,
    desc: "Void (cancel) a completed sale by ID: restores stock and reverses any credit added to the customer's dues.",
    schema: { sale_id: z.string().uuid(), reason: z.string().trim().max(200).optional() },
    summary: (a) => `Void sale ${a.sale_id.slice(0, 8)}${a.reason ? ` (${a.reason})` : ""} and restore stock`,
    run: async (ctx, a, executor = pool) => {
      if (!isUuid(a.sale_id)) throw toolError(400, "Invalid sale ID.");
      const [sale] = await q(
        `SELECT id, status, total, payment_method, customer_id FROM sales
         WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
        [a.sale_id, ctx.shopId],
        executor
      );
      if (!sale) throw toolError(404, "Sale not found.");
      if (sale.status === "void") throw toolError(409, "Sale is already void.");

      const items = await q(`SELECT product_id, qty FROM sale_items WHERE sale_id = $1`, [sale.id], executor);
      for (const item of items) {
        if (item.product_id) {
          await q(
            `UPDATE products SET qty = qty + $3, updated_at = now() WHERE id = $1 AND shop_id = $2`,
            [item.product_id, ctx.shopId, item.qty],
            executor
          );
        }
      }
      if (sale.payment_method === "credit" && sale.customer_id) {
        await q(
          `INSERT INTO ledger (shop_id, customer_id, amount, note, kind, sale_id)
           VALUES ($1, $2, $3, $4, 'adjustment', $5)`,
          [ctx.shopId, sale.customer_id, -sale.total, `Void of bill ${sale.id.slice(0, 8)}`, sale.id],
          executor
        );
      }
      await q(
        `UPDATE sales SET status = 'void', note = concat_ws(' | ', note, $3::text) WHERE id = $1 AND shop_id = $2`,
        [sale.id, ctx.shopId, a.reason ? `Void: ${a.reason}` : "Void"],
        executor
      );
      return `Sale ${sale.id.slice(0, 8)} voided. Stock restored for ${items.length} line(s).`;
    },
  },
};
