import { useMemo, useState } from "react";
import { Plus, Search, Download, MoreHorizontal, PackagePlus, PackageMinus, Pencil, Trash2, ClipboardCheck } from "lucide-react";
import { runTool } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { rupees, count } from "../../lib/format.js";
import {
  PageHeader, Card, Button, Badge, Empty, Spinner, ErrorNote, FormModal, ConfirmModal, Stat, useToast, resultMessage,
} from "../../components/ui.jsx";

const productFields = (existing) => [
  { name: existing ? "new_name" : "name", label: "Product name", required: !existing, placeholder: existing?.name, wide: true },
  { name: "category", label: "Category", placeholder: "Cement" },
  { name: "unit", label: "Unit", placeholder: "bag" },
  { name: "price", label: "Selling price (₹)", type: "number", step: "0.01", min: 0 },
  { name: "cost", label: "Cost price (₹)", type: "number", step: "0.01", min: 0 },
  ...(existing ? [] : [{ name: "qty", label: "Opening stock", type: "number", min: 0 }]),
  { name: "reorder_level", label: "Reorder at", type: "number", min: 0, hint: "Blank = shop default" },
  { name: "sku", label: "SKU", placeholder: "Optional" },
];

export default function Inventory() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null); // { kind, product }
  const [menu, setMenu] = useState(null);

  const list = useLoad(() => runTool("list_products", { limit: 500 }), []);
  const valuation = useLoad(() => runTool("inventory_valuation"), []);

  const products = useMemo(() => {
    const rows = list.data?.products || [];
    const s = search.toLowerCase();
    return rows.filter(
      (p) =>
        (!s || p.name.toLowerCase().includes(s) || (p.sku || "").toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s)) &&
        (filter === "all" || (filter === "low" && p.low_stock) || (filter === "out" && p.qty === 0))
    );
  }, [list.data, search, filter]);

  const done = (result) => {
    toast(resultMessage(result));
    list.reload();
    valuation.reload();
  };

  const run = (tool, args) => runTool(tool, args).then(done);

  const p = modal?.product;

  return (
    <>
      <PageHeader title="Inventory" subtitle="Products, stock levels, pricing and margins.">
        <a className="btn btn-ghost btn-sm" href="/api/export/products"><Download size={15} /> Export CSV</a>
        <Button size="sm" icon={Plus} onClick={() => setModal({ kind: "create" })}>Add product</Button>
      </PageHeader>

      {valuation.data && (
        <div className="stats">
          <Stat label="Products" value={count(list.data?.count ?? 0)} hint={`${(list.data?.products || []).filter((x) => x.low_stock).length} low on stock`} />
          <Stat label="Stock value (cost)" value={rupees(valuation.data.value_at_cost)} />
          <Stat label="Stock value (retail)" value={rupees(valuation.data.value_at_price)} />
          <Stat label="Potential gross profit" value={rupees(valuation.data.potential_gross_profit)} />
        </div>
      )}

      <Card pad={false}>
        <div className="toolbar">
          <label className="search">
            <Search size={15} />
            <input placeholder="Search name, SKU or category" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          </label>
          <div className="seg">
            {[["all", "All"], ["low", "Low stock"], ["out", "Out of stock"]].map(([k, l]) => (
              <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <ErrorNote>{list.error}</ErrorNote>
        {list.loading && !list.data ? <Spinner /> : products.length === 0 ? (
          <Empty title="No products found">Add your first product or change the filter.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th><th>Category</th><th className="num">Stock</th>
                  <th className="num">Price</th><th className="num">Cost</th><th className="num">Margin</th><th />
                </tr>
              </thead>
              <tbody>
                {products.map((row) => {
                  const margin = row.price > 0 ? ((row.price - row.cost) / row.price) * 100 : null;
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        {row.sku && <small className="muted block">{row.sku}</small>}
                      </td>
                      <td>{row.category || <span className="muted">—</span>}</td>
                      <td className="num">
                        <Badge tone={row.qty === 0 ? "danger" : row.low_stock ? "warn" : "ok"}>{count(row.qty)} {row.unit}</Badge>
                      </td>
                      <td className="num">{rupees(row.price)}</td>
                      <td className="num muted">{rupees(row.cost)}</td>
                      <td className="num">{margin === null ? "—" : `${margin.toFixed(1)}%`}</td>
                      <td className="row-actions">
                        <div className="menu-wrap">
                          <button className="icon-btn" aria-label={`Actions for ${row.name}`} onClick={() => setMenu(menu === row.id ? null : row.id)}>
                            <MoreHorizontal size={16} />
                          </button>
                          {menu === row.id && (
                            <div className="menu" onMouseLeave={() => setMenu(null)}>
                              {[
                                ["add", PackagePlus, "Add stock"],
                                ["remove", PackageMinus, "Remove stock"],
                                ["adjust", ClipboardCheck, "Stock count"],
                                ["edit", Pencil, "Edit details"],
                                ["delete", Trash2, "Delete"],
                              ].map(([kind, Icon, label]) => (
                                <button key={kind} className={kind === "delete" ? "danger" : ""} onClick={() => { setMenu(null); setModal({ kind, product: row }); }}>
                                  <Icon size={14} /> {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FormModal
        open={modal?.kind === "create"}
        onClose={() => setModal(null)}
        title="Add product"
        fields={productFields(null)}
        submitLabel="Add product"
        onSubmit={(v) => run("create_product", v)}
      />
      <FormModal
        open={modal?.kind === "edit"}
        onClose={() => setModal(null)}
        title={`Edit ${p?.name || ""}`}
        fields={productFields(p)}
        initial={p ? { category: p.category ?? "", unit: p.unit, price: p.price, cost: p.cost, reorder_level: p.reorder_level ?? "", sku: p.sku ?? "" } : {}}
        onSubmit={(v) => run("update_product", { product: p.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "add"}
        onClose={() => setModal(null)}
        title={`Add stock · ${p?.name || ""}`}
        description={`Currently ${p?.qty} ${p?.unit}. To record goods from a supplier with cost, use Suppliers → Receive goods.`}
        fields={[{ name: "quantity", label: "Quantity to add", type: "number", min: 1, required: true }]}
        submitLabel="Add stock"
        onSubmit={(v) => run("add_stock", { product: p.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "remove"}
        onClose={() => setModal(null)}
        title={`Remove stock · ${p?.name || ""}`}
        description="For damage, loss or own use. Sales deduct stock automatically."
        fields={[
          { name: "quantity", label: "Quantity to remove", type: "number", min: 1, required: true },
          { name: "reason", label: "Reason", placeholder: "Damaged in transit" },
        ]}
        submitLabel="Remove"
        onSubmit={(v) => run("remove_stock", { product: p.name, ...v })}
      />
      <FormModal
        open={modal?.kind === "adjust"}
        onClose={() => setModal(null)}
        title={`Stock count · ${p?.name || ""}`}
        description={`System shows ${p?.qty} ${p?.unit}. Enter what you physically counted.`}
        fields={[{ name: "quantity", label: "Counted quantity", type: "number", min: 0, required: true }]}
        submitLabel="Save count"
        onSubmit={(v) => run("adjust_stock", { product: p.name, ...v })}
      />
      <ConfirmModal
        open={modal?.kind === "delete"}
        onClose={() => setModal(null)}
        title={`Delete ${p?.name || ""}?`}
        confirmLabel="Delete product"
        onConfirm={() => run("delete_product", { product: p.name })}
      >
        This permanently removes the product. Past bills keep its name for history.
      </ConfirmModal>
    </>
  );
}
