import { useState } from "react";
import { Plus, PackageCheck, Pencil, Trash2 } from "lucide-react";
import { runTool } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, dateTime, ago } from "../../lib/format.js";
import {
  PageHeader, Card, Button, Empty, Spinner, ErrorNote, FormModal, ConfirmModal, useToast, resultMessage,
} from "../../components/ui.jsx";

export default function Suppliers() {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const suppliers = useLoad(() => runTool("list_suppliers"), []);
  const purchases = useLoad(() => runTool("list_purchases", { period: "90d" }), []);
  const products = useLoad(() => runTool("get_stock"), []);

  const run = (tool, args) =>
    runTool(tool, args).then((r) => {
      toast(resultMessage(r));
      suppliers.reload();
      purchases.reload();
    });

  const s = modal?.supplier;

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Distributors, goods received and purchase spend.">
        <Button variant="ghost" size="sm" icon={PackageCheck} onClick={() => setModal({ kind: "receive" })}>Receive goods</Button>
        <Button size="sm" icon={Plus} onClick={() => setModal({ kind: "create" })}>Add supplier</Button>
      </PageHeader>

      <div className="grid-2">
        <Card title="Suppliers" pad={false}>
          <ErrorNote>{suppliers.error}</ErrorNote>
          {suppliers.loading && !suppliers.data ? <Spinner /> : !suppliers.data?.length ? (
            <Empty title="No suppliers yet" />
          ) : (
            <table className="table">
              <thead><tr><th>Supplier</th><th className="num">Purchased</th><th>Last order</th><th /></tr></thead>
              <tbody>
                {suppliers.data.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><small className="muted block">{row.phone || "No phone"}</small></td>
                    <td className="num">{rupees(row.total_purchased)}</td>
                    <td className="muted">{ago(row.last_purchase_at)}</td>
                    <td className="row-actions">
                      <div className="btn-row">
                        <button className="icon-btn" aria-label="Edit supplier" onClick={() => setModal({ kind: "edit", supplier: row })}><Pencil size={15} /></button>
                        <button className="icon-btn danger" aria-label="Delete supplier" onClick={() => setModal({ kind: "delete", supplier: row })}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Goods received · 90 days" action={purchases.data && <span className="muted small">{rupees(purchases.data.total)}</span>} pad={false}>
          {purchases.loading && !purchases.data ? <Spinner /> : !purchases.data?.purchases.length ? (
            <Empty title="No purchases recorded" />
          ) : (
            <div className="table-wrap compact">
              <table className="table">
                <thead><tr><th>When</th><th>Product</th><th className="num">Qty</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {purchases.data.purchases.map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{dateTime(p.created_at)}</td>
                      <td>{p.product_name}<small className="muted block">{p.supplier || "—"}</small></td>
                      <td className="num">{p.qty}</td>
                      <td className="num">{rupees(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <FormModal
        open={modal?.kind === "create"}
        onClose={() => setModal(null)}
        title="Add supplier"
        fields={[
          { name: "name", label: "Supplier name", required: true, wide: true },
          { name: "phone", label: "Phone", type: "tel" },
          { name: "notes", label: "Notes", type: "textarea", wide: true },
        ]}
        submitLabel="Add supplier"
        onSubmit={(v) => run("create_supplier", v)}
      />
      <FormModal
        open={modal?.kind === "edit"}
        onClose={() => setModal(null)}
        title={`Edit ${s?.name || ""}`}
        fields={[
          { name: "new_name", label: "Name", placeholder: s?.name, wide: true },
          { name: "phone", label: "Phone", type: "tel" },
          { name: "notes", label: "Notes", type: "textarea", wide: true },
        ]}
        initial={s ? { phone: s.phone ?? "", notes: s.notes ?? "" } : {}}
        onSubmit={(v) => run("update_supplier", { supplier: s.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "receive"}
        onClose={() => setModal(null)}
        title="Receive goods"
        description="Adds stock and updates the product's cost price to this unit cost. New product names are created automatically."
        fields={[
          { name: "product", label: "Product", required: true, list: "product-list", wide: true },
          { name: "qty", label: "Quantity", type: "number", min: 1, required: true },
          { name: "unit_cost", label: "Unit cost (₹)", type: "number", min: 0, step: "0.01", required: true },
          { name: "supplier", label: "Supplier", type: "select", options: (suppliers.data || []).map((x) => x.name), wide: true },
        ]}
        submitLabel="Receive"
        onSubmit={(v) => run("record_purchase", v).then(() => products.reload())}
      />
      <datalist id="product-list">
        {(Array.isArray(products.data) ? products.data : []).map((p) => <option key={p.name} value={p.name} />)}
      </datalist>
      <ConfirmModal open={modal?.kind === "delete"} onClose={() => setModal(null)} title={`Delete ${s?.name || ""}?`} confirmLabel="Delete supplier" onConfirm={() => run("delete_supplier", { supplier: s.name })}>
        Past purchases are kept but no longer linked to this supplier.
      </ConfirmModal>
    </>
  );
}
