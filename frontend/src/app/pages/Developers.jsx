import { useState } from "react";
import { Plus, Copy, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { ago, date, titleCase } from "../../lib/format.js";
import { PageHeader, Card, Button, Badge, Empty, Spinner, ErrorNote, Modal, ConfirmModal, Field, useToast } from "../../components/ui.jsx";

const MCP_URL = `${window.location.origin}/mcp`;

export default function Developers() {
  const toast = useToast();
  const keys = useLoad(() => api("/keys"), []);
  const catalog = useLoad(() => api("/tools").then((r) => r.tools), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", access: "read", expires: "90" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard"));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api("/keys", {
        body: {
          name: form.name.trim(),
          scopes: form.access === "write" ? ["read", "write"] : ["read"],
          ...(form.expires !== "never" ? { expires_in_days: Number(form.expires) } : {}),
        },
      });
      setCreating(false);
      setNewKey(res.key);
      setForm({ name: "", access: "read", expires: "90" });
      keys.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const grouped = (catalog.data || []).reduce((acc, t) => ((acc[t.category] ||= []).push(t), acc), {});

  return (
    <>
      <PageHeader title="API & MCP" subtitle="Connect Claude Desktop, Claude Code, scripts or any MCP client to this shop.">
        <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New API key</Button>
      </PageHeader>

      <div className="grid-2">
        <Card title="MCP endpoint">
          <div className="copy-field">
            <code>{MCP_URL}</code>
            <button className="icon-btn" onClick={() => copy(MCP_URL)} aria-label="Copy MCP URL"><Copy size={14} /></button>
          </div>
          <p className="muted small">Streamable HTTP · Authorization: Bearer &lt;key&gt;. Read keys see {catalog.data?.filter((t) => !t.write).length ?? "…"} read tools; write keys can also stage changes for your approval.</p>
          <pre className="code small">{`claude mcp add --transport http shopmind ${MCP_URL} \\
  --header "Authorization: Bearer sm_live_..."`}</pre>
        </Card>
        <Card title="REST">
          <pre className="code small">{`curl -X POST ${window.location.origin}/api/tools/business_summary \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" -d '{"args":{}}'`}</pre>
          <p className="muted small">Write tools called with an API key return <code>202 pending_approval</code> and appear in Approvals.</p>
        </Card>
      </div>

      <Card title="API keys" pad={false}>
        <ErrorNote>{keys.error}</ErrorNote>
        {keys.loading && !keys.data ? <Spinner /> : !keys.data?.length ? (
          <Empty icon={KeyRound} title="No API keys yet">Create one to connect an MCP client.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Last used</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {keys.data.map((k) => (
                  <tr key={k.id} className={k.revoked_at ? "void" : ""}>
                    <td><strong>{k.name}</strong></td>
                    <td><code>{k.prefix}…</code></td>
                    <td>{k.scopes.includes("write") ? <Badge tone="warn">read + write</Badge> : <Badge tone="ok">read</Badge>}</td>
                    <td className="muted">{ago(k.last_used_at)}</td>
                    <td className="muted">{k.revoked_at ? "Revoked" : k.expires_at ? date(k.expires_at) : "Never"}</td>
                    <td className="row-actions">
                      {!k.revoked_at && (
                        <button className="icon-btn danger" aria-label={`Revoke ${k.name}`} onClick={() => setRevoking(k)}><Trash2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Tool catalog${catalog.data ? ` · ${catalog.data.length}` : ""}`}>
        <div className="catalog compact">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="catalog-group">
              <h3>{titleCase(cat)}</h3>
              {list.map((t) => (
                <div key={t.name} className="catalog-row">
                  <code>{t.name}</code>
                  <Badge tone={t.write ? (t.destructive ? "danger" : "warn") : "ok"}>{t.write ? (t.destructive ? "destructive" : "write") : "read"}</Badge>
                  <p>{t.description}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="New API key" description="Keys act on this shop only. Use read-only unless the client needs to propose changes.">
        <form className="form-grid" onSubmit={create}>
          <Field field={{ name: "name", label: "Name", required: true, placeholder: "Claude Desktop", wide: true, max: 60 }} value={form.name} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <Field field={{ name: "access", label: "Access", type: "select", required: true, options: [["read", "Read only"], ["write", "Read + propose changes"]] }} value={form.access} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <Field field={{ name: "expires", label: "Expires", type: "select", required: true, options: [["30", "30 days"], ["90", "90 days"], ["365", "1 year"], ["never", "Never"]] }} value={form.expires} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <ErrorNote>{error}</ErrorNote>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create key</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(newKey)} onClose={() => setNewKey(null)} title="Copy your API key" description="This is the only time the full key is shown. Store it in a password manager or secret store.">
        <div className="copy-field big">
          <code>{newKey}</code>
          <button className="icon-btn" onClick={() => copy(newKey)} aria-label="Copy key"><Copy size={15} /></button>
        </div>
        <p className="warn-note"><ShieldAlert size={15} /> Never paste keys into chats, tickets or public repos. Revoke it here if it leaks.</p>
        <div className="form-actions"><Button onClick={() => setNewKey(null)}>Done</Button></div>
      </Modal>

      <ConfirmModal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title={`Revoke "${revoking?.name}"?`}
        confirmLabel="Revoke key"
        onConfirm={async () => {
          await api(`/keys/${revoking.id}`, { method: "DELETE" });
          toast("Key revoked");
          keys.reload();
        }}
      >
        Any client using this key loses access immediately. This can't be undone.
      </ConfirmModal>
    </>
  );
}
