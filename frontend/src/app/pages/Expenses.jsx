import { useState } from "react";
import { Plus, Download, Trash2 } from "lucide-react";
import { runTool } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, date, titleCase } from "../../lib/format.js";
import {
  PageHeader, Card, Button, Empty, Spinner, ErrorNote, FormModal, ConfirmModal, Stat, useToast, resultMessage,
} from "../../components/ui.jsx";

const CATEGORIES = ["rent", "salary", "electricity", "transport", "maintenance", "marketing", "supplies", "tax", "other"];
const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["month", "This month"], ["90d", "90 days"], ["year", "This year"]];

export default function Expenses() {
  const toast = useToast();
  const [period, setPeriod] = useState("month");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const list = useLoad(() => runTool("list_expenses", { period }), [period]);
  const pnl = useLoad(() => runTool("profit_and_loss", { period }), [period]);

  const refresh = (r) => {
    toast(resultMessage(r));
    list.reload();
    pnl.reload();
  };

  return (
    <>
      <PageHeader title="Expenses & P&L" subtitle="Track costs and see what the shop actually earns.">
        <a className="btn btn-ghost btn-sm" href="/api/export/expenses"><Download size={15} /> Export CSV</a>
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add expense</Button>
      </PageHeader>

      <div className="seg period">
        {PERIODS.map(([k, l]) => <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>

      {pnl.data && (
        <div className="stats">
          <Stat label="Revenue" value={rupees(pnl.data.revenue)} />
          <Stat label="Gross profit" value={rupees(pnl.data.gross_profit)} hint={pnl.data.gross_margin_pct != null ? `${pnl.data.gross_margin_pct}% margin` : ""} />
          <Stat label="Expenses" value={rupees(pnl.data.expenses.total)} />
          <Stat label="Net profit" value={rupees(pnl.data.net_profit)} tone={pnl.data.net_profit < 0 ? "bad" : "good"} />
        </div>
      )}

      <div className="grid-2-1">
        <Card title="Expenses" pad={false}>
          <ErrorNote>{list.error}</ErrorNote>
          {list.loading && !list.data ? <Spinner /> : !list.data?.expenses.length ? (
            <Empty title="No expenses in this period" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Category</th><th>Note</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {list.data.expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{date(e.spent_on)}</td>
                      <td>{titleCase(e.category)}</td>
                      <td className="muted">{e.note || "—"}</td>
                      <td className="num">{rupees(e.amount)}</td>
                      <td className="row-actions">
                        <button className="icon-btn danger" aria-label="Delete expense" onClick={() => setDeleting(e)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="P&L statement">
          {pnl.data && (
            <dl className="pnl">
              <div><dt>Gross sales</dt><dd>{rupees(pnl.data.revenue + pnl.data.discounts)}</dd></div>
              {pnl.data.discounts > 0 && <div><dt>Discounts</dt><dd>−{rupees(pnl.data.discounts)}</dd></div>}
              <div><dt>Cost of goods sold</dt><dd>−{rupees(pnl.data.cost_of_goods_sold)}</dd></div>
              <div className="sum"><dt>Gross profit</dt><dd>{rupees(pnl.data.gross_profit)}</dd></div>
              {pnl.data.expenses.by_category.map((c) => (
                <div key={c.category}><dt>{titleCase(c.category)}</dt><dd>−{rupees(c.total)}</dd></div>
              ))}
              <div className="sum total"><dt>Net profit</dt><dd>{rupees(pnl.data.net_profit)}</dd></div>
            </dl>
          )}
        </Card>
      </div>

      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add expense"
        fields={[
          { name: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => [c, titleCase(c)]), required: true },
          { name: "amount", label: "Amount (₹)", type: "number", min: 1, step: "0.01", required: true },
          { name: "spent_on", label: "Date", type: "date" },
          { name: "note", label: "Note", wide: true },
        ]}
        initial={{ category: "other", spent_on: new Date().toISOString().slice(0, 10) }}
        submitLabel="Add expense"
        onSubmit={(v) => runTool("record_expense", v).then(refresh)}
      />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this expense?"
        confirmLabel="Delete"
        onConfirm={() => runTool("delete_expense", { expense_id: deleting.id }).then(refresh)}
      >
        {deleting ? `${titleCase(deleting.category)} · ${rupees(deleting.amount)} on ${date(deleting.spent_on)}` : ""}
      </ConfirmModal>
    </>
  );
}
