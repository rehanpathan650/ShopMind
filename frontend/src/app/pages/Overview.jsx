import { ArrowRight, AlertTriangle, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, count } from "../../lib/format.js";
import { Card, PageHeader, Stat, Spinner, ErrorNote, Empty, Badge, Button } from "../../components/ui.jsx";
import { RevenueChart } from "../RevenueChart.jsx";
import { useApp } from "../Shell.jsx";

const SUGGESTIONS = [
  "How is my business doing this month?",
  "Who should I chase for payment first?",
  "What do I need to reorder this week?",
  "Show my profit and loss for this month",
];

export default function Overview() {
  const { session } = useApp();
  const { data, error, loading, reload } = useLoad(() => api("/overview"), []);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <>
      <PageHeader title={`${greeting}${session.name ? `, ${session.name.split(" ")[0]}` : ""}`} subtitle={`Here's how ${session.shop} is doing.`}>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={reload} loading={loading && !!data}>Refresh</Button>
        <a className="btn btn-primary btn-sm" href="#/app/sales"><Plus size={15} /> New sale</a>
      </PageHeader>

      <ErrorNote>{error}</ErrorNote>
      {!data && loading && <Spinner />}

      {data && (
        <>
          {data.summary.pending_approvals > 0 && (
            <a href="#/app/approvals" className="banner">
              <AlertTriangle size={16} />
              <span><b>{data.summary.pending_approvals}</b> change{data.summary.pending_approvals > 1 ? "s" : ""} waiting for your approval</span>
              <ArrowRight size={15} />
            </a>
          )}

          <div className="stats">
            <Stat label="Today's sales" value={rupees(data.summary.today.revenue)} hint={`${count(data.summary.today.bills)} bills`} />
            <Stat label="Revenue this month" value={rupees(data.summary.this_month.revenue)} hint={`Gross profit ${rupees(data.summary.this_month.gross_profit)}`} />
            <Stat
              label="Net profit this month"
              value={rupees(data.summary.this_month.net_profit)}
              hint={`After ${rupees(data.summary.this_month.expenses)} expenses`}
              tone={data.summary.this_month.net_profit < 0 ? "bad" : undefined}
            />
            <Stat label="To collect (udhaar)" value={rupees(data.summary.receivables.total)} hint={`${data.summary.receivables.customers} customers`} />
          </div>

          <div className="grid-2-1">
            <Card title="Revenue · last 30 days" action={<span className="muted small">{rupees(data.sales.revenue)} total</span>}>
              <RevenueChart data={data.sales.daily} />
            </Card>
            <Card title="Ask ShopMind" action={<MessageSquare size={16} className="muted" />}>
              <div className="suggest-list">
                {SUGGESTIONS.map((s) => (
                  <a key={s} href={`#/app/assistant?q=${encodeURIComponent(s)}`} className="suggest">
                    {s} <ArrowRight size={14} />
                  </a>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid-2">
            <Card title="Top dues" action={<a className="link" href="#/app/customers">All customers</a>} pad={false}>
              {data.dues.length ? (
                <table className="table">
                  <tbody>
                    {data.dues.slice(0, 6).map((d) => (
                      <tr key={d.id}>
                        <td>
                          {d.name}
                          {d.credit_limit != null && d.due > d.credit_limit && <> <Badge tone="danger">over limit</Badge></>}
                        </td>
                        <td className="num"><b>{rupees(d.due)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="Nobody owes you money">Nice.</Empty>
              )}
            </Card>

            <Card title="Low stock" action={<a className="link" href="#/app/inventory">Inventory</a>} pad={false}>
              {data.low_stock.length ? (
                <table className="table">
                  <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Reorder</th></tr></thead>
                  <tbody>
                    {data.low_stock.slice(0, 6).map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num"><Badge tone={p.qty === 0 ? "danger" : "warn"}>{p.qty} {p.unit}</Badge></td>
                        <td className="num">+{p.suggested_reorder_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="Stock is healthy">Nothing is below its reorder level.</Empty>
              )}
            </Card>
          </div>

          <div className="stats small">
            <Stat label="Products" value={count(data.summary.inventory.products)} hint={`${data.summary.inventory.out_of_stock} out of stock`} />
            <Stat label="Inventory value (cost)" value={rupees(data.summary.inventory.value_at_cost)} />
            <Stat label="Avg bill (30d)" value={rupees(data.sales.avg_bill)} hint={`${count(data.sales.bills)} bills`} />
            <Stat label="Gross profit (30d)" value={rupees(data.sales.gross_profit)} />
          </div>
        </>
      )}
    </>
  );
}
