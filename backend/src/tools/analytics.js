import { z } from "zod";
import { q } from "../db.js";
import { LIMITS, period, periodStart } from "./shared.js";

export const businessSummary = async (shopId) => {
  const [today] = await q(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS bills
     FROM sales WHERE shop_id = $1 AND status = 'completed'
       AND created_at >= date_trunc('day', now())`,
    [shopId]
  );
  const [month] = await q(
    `SELECT COALESCE(SUM(s.total), 0) AS revenue, COUNT(*) AS bills
     FROM sales s WHERE s.shop_id = $1 AND s.status = 'completed'
       AND s.created_at >= date_trunc('month', now())`,
    [shopId]
  );
  const [monthProfit] = await q(
    `SELECT COALESCE(SUM(si.qty * (si.unit_price - si.unit_cost)), 0) AS gross_profit
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.shop_id = $1 AND s.status = 'completed' AND s.created_at >= date_trunc('month', now())`,
    [shopId]
  );
  const [monthExpenses] = await q(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE shop_id = $1 AND spent_on >= date_trunc('month', now())::date`,
    [shopId]
  );
  const [receivables] = await q(
    `SELECT COALESCE(SUM(due), 0) AS total, COUNT(*) AS customers FROM (
       SELECT SUM(amount) AS due FROM ledger WHERE shop_id = $1
       GROUP BY customer_id HAVING SUM(amount) > 0) d`,
    [shopId]
  );
  const [stock] = await q(
    `SELECT COUNT(*) AS products,
            COALESCE(SUM(p.qty * p.cost), 0) AS value_at_cost,
            COUNT(*) FILTER (WHERE p.qty <= COALESCE(p.reorder_level, s.low_stock_threshold)) AS low_stock,
            COUNT(*) FILTER (WHERE p.qty = 0) AS out_of_stock
     FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.shop_id = $1`,
    [shopId]
  );
  const [pending] = await q(
    `SELECT COUNT(*) AS count FROM pending_actions
     WHERE shop_id = $1 AND status = 'pending' AND expires_at > now()`,
    [shopId]
  );
  return {
    today: { revenue: today.revenue, bills: today.bills },
    this_month: {
      revenue: month.revenue,
      bills: month.bills,
      gross_profit: monthProfit.gross_profit,
      expenses: monthExpenses.total,
      net_profit: monthProfit.gross_profit - monthExpenses.total,
    },
    receivables: { total: receivables.total, customers: receivables.customers },
    inventory: stock,
    pending_approvals: pending.count,
  };
};

export const analyticsTools = {
  business_summary: {
    category: "analytics",
    desc: "One-shot snapshot of the business: today's sales, this month's revenue / gross profit / expenses / net profit, total receivables, inventory value, low-stock count, and pending approvals. Great first call for 'how is my shop doing?'.",
    schema: {},
    run: (ctx) => businessSummary(ctx.shopId),
  },

  profit_and_loss: {
    category: "analytics",
    desc: "Profit & loss statement for a period: revenue, cost of goods sold, gross profit and margin, expenses by category, and net profit.",
    schema: { period: period.optional() },
    run: async (ctx, { period: p = "month" }) => {
      const start = periodStart(p);
      const [sales] = await q(
        `SELECT COALESCE(SUM(si.qty * si.unit_price), 0) AS gross_sales,
                COALESCE(SUM(si.qty * si.unit_cost), 0) AS cogs
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.shop_id = $1 AND s.status = 'completed' AND s.created_at >= ${start}`,
        [ctx.shopId]
      );
      const [disc] = await q(
        `SELECT COALESCE(SUM(discount), 0) AS discounts FROM sales
         WHERE shop_id = $1 AND status = 'completed' AND created_at >= ${start}`,
        [ctx.shopId]
      );
      const expenses = await q(
        `SELECT category, SUM(amount) AS total FROM expenses
         WHERE shop_id = $1 AND spent_on >= (${start})::date GROUP BY category ORDER BY total DESC`,
        [ctx.shopId]
      );
      const revenue = sales.gross_sales - disc.discounts;
      const grossProfit = revenue - sales.cogs;
      const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);
      return {
        period: p,
        revenue,
        discounts: disc.discounts,
        cost_of_goods_sold: sales.cogs,
        gross_profit: grossProfit,
        gross_margin_pct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
        expenses: { total: totalExpenses, by_category: expenses },
        net_profit: grossProfit - totalExpenses,
      };
    },
  },

  customer_insights: {
    category: "analytics",
    desc: "Customer analytics: top customers by spend in a period, customers over their credit limit, and debtors who haven't paid in 30+ days.",
    schema: { period: period.optional() },
    run: async (ctx, { period: p = "90d" }) => {
      const top = await q(
        `SELECT c.name, COUNT(s.id) AS bills, SUM(s.total) AS spend
         FROM sales s JOIN customers c ON c.id = s.customer_id
         WHERE s.shop_id = $1 AND s.status = 'completed' AND s.created_at >= ${periodStart(p)}
         GROUP BY c.name ORDER BY spend DESC LIMIT 10`,
        [ctx.shopId]
      );
      const overLimit = await q(
        `SELECT c.name, c.credit_limit, SUM(l.amount) AS due
         FROM customers c JOIN ledger l ON l.customer_id = c.id
         WHERE c.shop_id = $1 AND c.credit_limit IS NOT NULL
         GROUP BY c.id HAVING SUM(l.amount) > c.credit_limit ORDER BY due DESC`,
        [ctx.shopId]
      );
      const stale = await q(
        `SELECT c.name, SUM(l.amount) AS due,
                MAX(l.created_at) FILTER (WHERE l.amount < 0) AS last_payment_at
         FROM customers c JOIN ledger l ON l.customer_id = c.id
         WHERE c.shop_id = $1
         GROUP BY c.id
         HAVING SUM(l.amount) > 0 AND COALESCE(
           MAX(l.created_at) FILTER (WHERE l.amount < 0), MIN(l.created_at)
         ) < now() - interval '30 days'
         ORDER BY due DESC`,
        [ctx.shopId]
      );
      return { top_customers: top, over_credit_limit: overLimit, slow_payers: stale };
    },
  },

  search_everything: {
    category: "analytics",
    desc: "Search across products, customers and suppliers by name in one call. Use when unsure which entity the owner means.",
    schema: { query: z.string().trim().min(1).max(LIMITS.name) },
    run: async (ctx, { query }) => {
      const like = `%${query}%`;
      const [products, customers, suppliers] = await Promise.all([
        q(`SELECT name, qty, price FROM products WHERE shop_id = $1 AND (name ILIKE $2 OR sku ILIKE $2) ORDER BY name LIMIT 10`, [ctx.shopId, like]),
        q(`SELECT name, phone FROM customers WHERE shop_id = $1 AND (name ILIKE $2 OR phone ILIKE $2) ORDER BY name LIMIT 10`, [ctx.shopId, like]),
        q(`SELECT name, phone FROM suppliers WHERE shop_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 10`, [ctx.shopId, like]),
      ]);
      return { products, customers, suppliers };
    },
  },

  recent_activity: {
    category: "analytics",
    desc: "The shop's most recent audit-log events (who did what, when).",
    schema: { limit: z.number().int().min(1).max(50).optional() },
    run: async (ctx, { limit = 15 }) =>
      q(
        `SELECT actor, event, detail, created_at FROM audit_log
         WHERE shop_id = $1 ORDER BY id DESC LIMIT $2`,
        [ctx.shopId, limit]
      ),
  },
};
