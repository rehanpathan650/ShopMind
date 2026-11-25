import { useState } from "react";
import { Plus, Trash2, Download, Ban } from "lucide-react";
import { runTool } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, dateTime, count, titleCase } from "../../lib/format.js";
import {
  PageHeader, Card, Button, Badge, Empty, Spinner, ErrorNote, Modal, ConfirmModal, Stat, useToast, resultMessage,
} from "../../components/ui.jsx";

const PERIODS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"], ["90d", "90 days"]];

function NewSale({ open, onClose, onDone }) {
  const products = useLoad(() => (open ? runTool("list_products", { limit: 500 }) : null), [open]);
  const customers = useLoad(() => (open ? runTool("list_customers", { limit: 500 }) : null), [open]);
  const [lines, setLines] = useState([{ product: "", qty: 1, unit_price: "" }]);
  const [method, setMethod] = useState("cash");
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const catalog = products.data?.products || [];
  const find = (name) => catalog.find((p) => p.name === name);
  const subtotal = lines.reduce((s, l) => {
    const p = find(l.product);
    const price = l.unit_price !== "" ? Number(l.unit_price) : p?.price || 0;
    return s + price * (Number(l.qty) || 0);
  }, 0);
  const total = Math.max(subtotal - (Number(discount) || 0), 0);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const reset = () => {
    setLines([{ product: "", qty: 1, unit_price: "" }]);
    setMethod("cash");
    setCustomer("");
    setDiscount("");
    setError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const items = lines
      .filter((l) => l.product)
      .map((l) => ({ product: l.product, qty: Number(l.qty), ...(l.unit_price !== "" ? { unit_price: Number(l.unit_price) } : {}) }));
    if (!items.length) return setError("Add at least one product.");
    if (method === "credit" && !customer.trim()) return setError("Choose a customer for a credit sale.");
    setBusy(true);
    try {
      const res = await runTool("record_sale", {
        items,
        payment_method: method,
        ...(customer.trim() ? { customer: customer.trim() } : {}),
        ...(Number(discount) > 0 ? { discount: Number(discount) } : {}),
      });
      onDone(res);
      reset();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New sale" description="Stock is deducted automatically. Credit sales add to the customer's dues." width={680}>
      {products.loading && !products.data ? <Spinner /> : (
        <form onSubmit={submit} className="sale-form">
          <div className="lines">
            <div className="line head"><span>Product</span><span>Qty</span><span>Price</span><span /></div>
            {lines.map((l, i) => {
              const p = find(l.product);
              return (
                <div key={i} className="line">
                  <select value={l.product} onChange={(e) => setLine(i, { product: e.target.value, unit_price: "" })} aria-label="Product" required={i === 0}>
                    <option value="">Choose product…</option>
                    {catalog.map((x) => (
                      <option key={x.id} value={x.name} disabled={x.qty === 0}>{x.name} ({x.qty} {x.unit})</option>
                    ))}
                  </select>
                  <input type="number" min={1} max={p?.qty} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Quantity" />
                  <input type="number" min={0} step="0.01" placeholder={p ? String(p.price) : "₹"} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} aria-label="Unit price" />
                  <button type="button" className="icon-btn" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
            <button type="button" className="link-btn" onClick={() => setLines((ls) => [...ls, { product: "", qty: 1, unit_price: "" }])}>
              <Plus size={14} /> Add line
            </button>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Payment</span>
              <div className="seg">
                {["cash", "upi", "card", "credit"].map((m) => (
                  <button type="button" key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{m.toUpperCase()}</button>
                ))}
              </div>
            </label>
            <label className="field">
              <span>Customer{method === "credit" && <em> *</em>}</span>
              <input list="customer-list" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={method === "credit" ? "Required for credit" : "Optional"} maxLength={120} />
              <datalist id="customer-list">
                {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </label>
            <label className="field">
              <span>Discount (₹)</span>
              <input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
            <div className="sale-total">
              <span>Total</span>
              <strong>{rupees(total)}</strong>
            </div>
          </div>

          <ErrorNote>{error}</ErrorNote>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Record sale</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SaleDetail({ id, onClose, onVoid }) {
  const sale = useLoad(() => (id ? runTool("sale_details", { sale_id: id }) : null), [id]);
  const [confirm, setConfirm] = useState(false);
  const s = sale.data;
  return (
    <>
      <Modal open={Boolean(id)} onClose={onClose} title={`Bill ${id?.slice(0, 8) || ""}`} description={s ? `${dateTime(s.created_at)} · ${s.payment_method.toUpperCase()}${s.customer ? ` · ${s.customer}` : ""}` : ""}>
        {!s ? <Spinner /> : (
          <div className="bill">
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {s.items.map((it, i) => (
                  <tr key={i}><td>{it.product_name}</td><td className="num">{it.qty}</td><td className="num">{rupees(it.unit_price)}</td><td className="num">{rupees(it.line_total)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                {s.discount > 0 && <tr><td colSpan={3}>Discount</td><td className="num">−{rupees(s.discount)}</td></tr>}
                <tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{rupees(s.total)}</b></td></tr>
              </tfoot>
            </table>
            {s.note && <p className="muted small">{s.note}</p>}
            <div className="form-actions">
              {s.status === "void" ? <Badge tone="danger">Void</Badge> : (
                <Button variant="danger" size="sm" icon={Ban} onClick={() => setConfirm(true)}>Void sale</Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Void this sale?"
        confirmLabel="Void sale"
        onConfirm={async () => {
          await onVoid(id);
          sale.reload();
        }}
      >
        Stock is restored and any credit added to the customer is reversed.
      </ConfirmModal>
    </>
  );
}

export default function Sales() {
  const toast = useToast();
  const [period, setPeriod] = useState("30d");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const report = useLoad(() => runTool("sales_report", { period }), [period]);
  const list = useLoad(() => runTool("list_sales", { period, limit: 200 }), [period]);
  const top = useLoad(() => runTool("top_products", { period, limit: 5 }), [period]);

  const refresh = () => {
    report.reload();
    list.reload();
    top.reload();
  };

  return (
    <>
      <PageHeader title="Sales" subtitle="Bills, revenue and best sellers.">
        <a className="btn btn-ghost btn-sm" href="/api/export/sales"><Download size={15} /> Export CSV</a>
        <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>New sale</Button>
      </PageHeader>

      <div className="seg period">
        {PERIODS.map(([k, l]) => <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>

      {report.data && (
        <div className="stats">
          <Stat label="Revenue" value={rupees(report.data.revenue)} hint={`${count(report.data.bills)} bills`} />
          <Stat label="Gross profit" value={rupees(report.data.gross_profit)} hint={report.data.revenue ? `${((report.data.gross_profit / report.data.revenue) * 100).toFixed(1)}% margin` : ""} />
          <Stat label="Average bill" value={rupees(report.data.avg_bill)} />
          <Stat
            label="On credit"
            value={rupees(report.data.by_payment_method.find((m) => m.payment_method === "credit")?.revenue || 0)}
            hint="added to customer dues"
          />
        </div>
      )}

      <div className="grid-2-1">
        <Card title="Bills" pad={false}>
          <ErrorNote>{list.error}</ErrorNote>
          {list.loading && !list.data ? <Spinner /> : !list.data?.sales.length ? (
            <Empty title="No sales in this period">Record a sale to see it here.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table hover">
                <thead><tr><th>When</th><th>Customer</th><th>Method</th><th className="num">Items</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {list.data.sales.map((s) => (
                    <tr key={s.id} onClick={() => setDetail(s.id)} className={s.status === "void" ? "void" : ""} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setDetail(s.id)}>
                      <td className="muted">{dateTime(s.created_at)}</td>
                      <td>{s.customer || <span className="muted">Walk-in</span>}</td>
                      <td><Badge tone={s.payment_method === "credit" ? "warn" : "neutral"}>{s.payment_method}</Badge></td>
                      <td className="num">{s.items}</td>
                      <td className="num">{s.status === "void" ? <s>{rupees(s.total)}</s> : rupees(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Top products">
            {top.data?.length ? (
              <ol className="rank">
                {top.data.map((t) => (
                  <li key={t.product}>
                    <span>{t.product}</span>
                    <b>{rupees(t.revenue)}</b>
                  </li>
                ))}
              </ol>
            ) : <p className="muted">No data.</p>}
          </Card>
          <Card title="By payment method">
            {report.data?.by_payment_method.length ? (
              <div className="split-bars">
                {report.data.by_payment_method.map((m) => (
                  <div key={m.payment_method} className="split-row">
                    <div className="split-label"><span>{titleCase(m.payment_method)}</span><b>{rupees(m.revenue)}</b></div>
                    <div className="split-track"><div style={{ width: `${(m.revenue / report.data.revenue) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : <p className="muted">No data.</p>}
          </Card>
        </div>
      </div>

      <NewSale open={open} onClose={() => setOpen(false)} onDone={(r) => { toast(resultMessage(r)); refresh(); }} />
      <SaleDetail
        id={detail}
        onClose={() => setDetail(null)}
        onVoid={async (id) => {
          const r = await runTool("void_sale", { sale_id: id });
          toast(resultMessage(r));
          refresh();
        }}
      />
    </>
  );
}
