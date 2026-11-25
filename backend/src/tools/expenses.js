import { z } from "zod";
import { q, pool } from "../db.js";
import { money, note, period, periodStart, toolError, rupees } from "./shared.js";

export const EXPENSE_CATEGORIES = [
  "rent", "salary", "electricity", "transport", "maintenance",
  "marketing", "supplies", "tax", "other",
];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date the money was spent, YYYY-MM-DD. Defaults to today.");

export const expenseTools = {
  list_expenses: {
    category: "expenses",
    desc: "List business expenses in a period, optionally filtered by category.",
    schema: { period: period.optional(), category: z.enum(EXPENSE_CATEGORIES).optional() },
    run: async (ctx, { period: p = "30d", category }) => {
      const rows = await q(
        `SELECT id, category, amount, note, spent_on, created_at FROM expenses
         WHERE shop_id = $1 AND spent_on >= (${periodStart(p)})::date
           AND ($2::text IS NULL OR category = $2)
         ORDER BY spent_on DESC, created_at DESC LIMIT 500`,
        [ctx.shopId, category ?? null]
      );
      return { total: rows.reduce((s, r) => s + r.amount, 0), count: rows.length, expenses: rows };
    },
  },

  expense_report: {
    category: "expenses",
    desc: "Expense totals for a period grouped by category.",
    schema: { period: period.optional() },
    run: async (ctx, { period: p = "30d" }) => {
      const rows = await q(
        `SELECT category, COUNT(*) AS entries, SUM(amount) AS total FROM expenses
         WHERE shop_id = $1 AND spent_on >= (${periodStart(p)})::date
         GROUP BY category ORDER BY total DESC`,
        [ctx.shopId]
      );
      return { period: p, total: rows.reduce((s, r) => s + r.total, 0), by_category: rows };
    },
  },

  record_expense: {
    category: "expenses",
    write: true,
    desc: "Record a business expense (rent, salary, electricity, transport, etc.).",
    schema: {
      category: z.enum(EXPENSE_CATEGORIES),
      amount: money,
      note: note.optional(),
      spent_on: isoDate.optional(),
    },
    summary: (a) => `Record ${rupees(a.amount)} ${a.category} expense${a.note ? ` (${a.note})` : ""}`,
    run: async (ctx, a, executor = pool) => {
      const [row] = await q(
        `INSERT INTO expenses (shop_id, category, amount, note, spent_on)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
         RETURNING id, category, amount, note, spent_on`,
        [ctx.shopId, a.category, a.amount, a.note ?? null, a.spent_on ?? null],
        executor
      );
      return { message: `Recorded ${rupees(row.amount)} for ${row.category}.`, expense: row };
    },
  },

  delete_expense: {
    category: "expenses",
    write: true,
    destructive: true,
    desc: "Delete a mistaken expense entry by its ID.",
    schema: { expense_id: z.string().uuid() },
    summary: (a) => `Delete expense ${a.expense_id.slice(0, 8)}`,
    run: async (ctx, a, executor = pool) => {
      const [row] = await q(
        `DELETE FROM expenses WHERE id = $1 AND shop_id = $2 RETURNING category, amount`,
        [a.expense_id, ctx.shopId],
        executor
      );
      if (!row) throw toolError(404, "Expense not found.");
      return `Deleted ${rupees(row.amount)} ${row.category} expense.`;
    },
  },
};
