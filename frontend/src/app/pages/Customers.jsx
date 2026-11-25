import { useMemo, useState } from "react";
import { Plus, Search, Download, IndianRupee, HandCoins, Pencil, Trash2, MessageCircle, Copy, FileText } from "lucide-react";
import { runTool } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, dateTime, ago, titleCase } from "../../lib/format.js";
import {
  PageHeader, Card, Button, Badge, Empty, Spinner, ErrorNote, FormModal, ConfirmModal, Modal, Stat, useToast, resultMessage,
} from "../../components/ui.jsx";

const customerFields = (existing) => [
  { name: existing ? "new_name" : "name", label: "Customer name", required: !existing, placeholder: existing?.name, wide: true },
  { name: "phone", label: "Phone", type: "tel", placeholder: "+91 98xxx xxxxx" },
  { name: "email", label: "Email", type: "email" },
  { name: "credit_limit", label: "Credit limit (₹)", type: "number", min: 0 },
  { name: "address", label: "Address", wide: true },
  { name: "notes", label: "Notes", type: "textarea", wide: true },
];

function Statement({ customer, onClose }) {
  const st = useLoad(() => (customer ? runTool("customer_statement", { customer: customer.name, limit: 100 }) : null), [customer?.id]);
  const reminder = useLoad(() => (customer && customer.balance > 0 ? runTool("draft_reminder_message", { customer: customer.name }) : null), [customer?.id]);
  const toast = useToast();
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast("Copied to clipboard"));

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title={customer?.name || ""} description={customer?.phone || "No phone on file"} width={680}>
      {st.loading && !st.data ? <Spinner /> : st.data && (
        <div className="statement">
          <div className="stats small">
            <Stat label="Balance" value={rupees(st.data.balance)} tone={st.data.balance > (st.data.customer.credit_limit ?? Infinity) ? "bad" : undefined} />
            <Stat label="Credit limit" value={st.data.customer.credit_limit != null ? rupees(st.data.customer.credit_limit) : "None"} />
          </div>
          {reminder.data && typeof reminder.data === "object" && (
            <div className="reminder">
              <div className="reminder-head"><MessageCircle size={15} /> <strong>Reminder draft</strong></div>
              {[reminder.data.message_en, reminder.data.message_hi].map((t) => (
                <div key={t} className="reminder-msg">
                  <p>{t}</p>
                  <button className="icon-btn" onClick={() => copy(t)} aria-label="Copy message"><Copy size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="table-wrap compact">
            <table className="table">
              <thead><tr><th>Date</th><th>Entry</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {st.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{dateTime(e.created_at)}</td>
                    <td>{e.note || titleCase(e.kind)}</td>
                    <td className={`num ${e.amount < 0 ? "pos" : ""}`}>{e.amount < 0 ? "−" : "+"}{rupees(Math.abs(e.amount))}</td>
                    <td className="num">{rupees(e.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Customers() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [modal, setModal] = useState(null);
  const [statement, setStatement] = useState(null);

  const list = useLoad(() => runTool("list_customers", { limit: 500 }), []);
  const aging = useLoad(() => runTool("dues_aging"), []);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (list.data?.customers || []).filter(
      (c) => (!s || c.name.toLowerCase().includes(s) || (c.phone || "").includes(s)) && (!onlyDue || c.balance > 0)
    );
  }, [list.data, search, onlyDue]);

  const run = (tool, args) =>
    runTool(tool, args).then((r) => {
      toast(resultMessage(r));
      list.reload();
      aging.reload();
    });

  const c = modal?.customer;

  return (
    <>
      <PageHeader title="Customers" subtitle="Credit (udhaar), payments, statements and reminders.">
        <a className="btn btn-ghost btn-sm" href="/api/export/ledger"><Download size={15} /> Ledger CSV</a>
        <Button size="sm" icon={Plus} onClick={() => setModal({ kind: "create" })}>Add customer</Button>
      </PageHeader>

      {aging.data && (
        <div className="stats">
          <Stat label="Total to collect" value={rupees(aging.data.total_due)} hint={`${aging.data.customers.length} customers`} />
          <Stat label="0-30 days" value={rupees(aging.data.buckets["0-30"])} />
          <Stat label="31-90 days" value={rupees(aging.data.buckets["31-60"] + aging.data.buckets["61-90"])} tone={aging.data.buckets["61-90"] > 0 ? "warn" : undefined} />
          <Stat label="90+ days" value={rupees(aging.data.buckets["90+"])} tone={aging.data.buckets["90+"] > 0 ? "bad" : undefined} />
        </div>
      )}

      <Card pad={false}>
        <div className="toolbar">
          <label className="search">
            <Search size={15} />
            <input placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Only with dues
          </label>
        </div>
        <ErrorNote>{list.error}</ErrorNote>
        {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
          <Empty title="No customers found">Add a customer or record a credit sale.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Customer</th><th>Phone</th><th className="num">Balance</th><th className="num">Limit</th><th>Last activity</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="link-btn strong" onClick={() => setStatement(row)}>{row.name}</button>
                      {row.notes && <small className="muted block">{row.notes}</small>}
                    </td>
                    <td className="muted">{row.phone || "—"}</td>
                    <td className="num">
                      {row.balance > 0 ? (
                        <Badge tone={row.credit_limit != null && row.balance > row.credit_limit ? "danger" : "warn"}>{rupees(row.balance)}</Badge>
                      ) : <span className="muted">{rupees(row.balance)}</span>}
                    </td>
                    <td className="num muted">{row.credit_limit != null ? rupees(row.credit_limit) : "—"}</td>
                    <td className="muted">{ago(row.last_activity_at)}</td>
                    <td className="row-actions">
                      <div className="btn-row">
                        <button className="icon-btn" title="Statement" aria-label="Statement" onClick={() => setStatement(row)}><FileText size={15} /></button>
                        <button className="icon-btn" title="Add credit" aria-label="Add credit" onClick={() => setModal({ kind: "credit", customer: row })}><IndianRupee size={15} /></button>
                        <button className="icon-btn" title="Record payment" aria-label="Record payment" disabled={row.balance <= 0} onClick={() => setModal({ kind: "payment", customer: row })}><HandCoins size={15} /></button>
                        <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setModal({ kind: "edit", customer: row })}><Pencil size={15} /></button>
                        <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => setModal({ kind: "delete", customer: row })}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Statement customer={statement} onClose={() => setStatement(null)} />

      <FormModal open={modal?.kind === "create"} onClose={() => setModal(null)} title="Add customer" fields={customerFields(null)} submitLabel="Add customer" onSubmit={(v) => run("create_customer", v)} />
      <FormModal
        open={modal?.kind === "edit"}
        onClose={() => setModal(null)}
        title={`Edit ${c?.name || ""}`}
        fields={customerFields(c)}
        initial={c ? { phone: c.phone ?? "", email: c.email ?? "", credit_limit: c.credit_limit ?? "", notes: c.notes ?? "" } : {}}
        onSubmit={(v) => run("update_customer", { customer: c.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "credit"}
        onClose={() => setModal(null)}
        title={`Add credit · ${c?.name || ""}`}
        description="Goods given on credit without an itemised bill. For itemised bills, use Sales → New sale → Credit."
        fields={[
          { name: "amount", label: "Amount (₹)", type: "number", min: 1, step: "0.01", required: true },
          { name: "note", label: "Note", placeholder: "20 bags cement" },
        ]}
        submitLabel="Add credit"
        onSubmit={(v) => run("record_credit_sale", { customer: c.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "payment"}
        onClose={() => setModal(null)}
        title={`Record payment · ${c?.name || ""}`}
        description={c ? `Outstanding: ${rupees(c.balance)}` : ""}
        fields={[
          { name: "amount", label: "Amount received (₹)", type: "number", min: 1, step: "0.01", required: true },
          { name: "method", label: "Method", type: "select", options: ["cash", "upi", "card", "bank"] },
        ]}
        initial={{ amount: c?.balance }}
        submitLabel="Record payment"
        onSubmit={(v) => run("record_payment", { customer: c.name, ...v })}
      />
      <ConfirmModal open={modal?.kind === "delete"} onClose={() => setModal(null)} title={`Delete ${c?.name || ""}?`} confirmLabel="Delete customer" onConfirm={() => run("delete_customer", { customer: c.name })}>
        Removes the customer and their ledger history. Only allowed when their balance is zero.
      </ConfirmModal>
    </>
  );
}
