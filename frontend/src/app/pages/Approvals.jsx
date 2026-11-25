import { useState } from "react";
import { Check, X, Bot, KeyRound, Plug } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { ago, dateTime, titleCase } from "../../lib/format.js";
import { PageHeader, Card, Button, Badge, Empty, Spinner, ErrorNote, useToast, resultMessage } from "../../components/ui.jsx";
import { useApp } from "../Shell.jsx";

const SOURCE = {
  chat: [Bot, "Assistant"],
  mcp: [Plug, "MCP client"],
  api: [KeyRound, "API key"],
};

const TABS = [["pending", "Pending"], ["done", "Approved"], ["cancelled", "Cancelled"], ["expired", "Expired"]];

export default function Approvals() {
  const toast = useToast();
  const { refreshPending } = useApp();
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState({});
  const { data, error, loading, reload } = useLoad(() => api(`/actions?status=${status}`), [status]);

  const act = async (id, verb) => {
    setBusy((b) => ({ ...b, [id]: verb }));
    try {
      const res = await api(`/actions/${id}/${verb}`, { body: {} });
      toast(verb === "confirm" ? resultMessage(res.result) : "Cancelled.");
      reload();
      refreshPending();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy((b) => ({ ...b, [id]: undefined }));
    }
  };

  return (
    <>
      <PageHeader title="Approvals" subtitle="Changes proposed by the assistant, MCP clients and API keys. Nothing runs until you approve it." />
      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {loading && !data && <Spinner />}
      {data && !data.length && (
        <Card><Empty title={status === "pending" ? "You're all caught up" : `No ${status} actions`}>Staged changes will appear here.</Empty></Card>
      )}
      <div className="approval-list">
        {data?.map((a) => {
          const [Icon, label] = SOURCE[a.source] || [Bot, a.source];
          return (
            <div key={a.id} className={`approval-row ${a.destructive ? "destructive" : ""}`}>
              <div className="approval-main">
                <div className="approval-meta">
                  <Badge tone="neutral"><Icon size={12} /> {label}</Badge>
                  <code>{a.tool}</code>
                  {a.destructive && <Badge tone="danger">destructive</Badge>}
                  <span className="muted small">{ago(a.created_at)}</span>
                </div>
                <strong>{a.summary}</strong>
                <details className="args">
                  <summary>Arguments</summary>
                  <dl>
                    {Object.entries(a.args || {}).map(([k, v]) => (
                      <div key={k}><dt>{titleCase(k)}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>
                    ))}
                  </dl>
                </details>
                {a.result && <p className="muted small">Result: {a.result}</p>}
                {a.status === "pending" && <p className="muted small">Expires {dateTime(a.expires_at)}</p>}
              </div>
              {a.status === "pending" && (
                <div className="approval-btns">
                  <Button variant="ghost" size="sm" icon={X} loading={busy[a.id] === "cancel"} disabled={!!busy[a.id]} onClick={() => act(a.id, "cancel")}>Reject</Button>
                  <Button variant={a.destructive ? "danger" : "primary"} size="sm" icon={Check} loading={busy[a.id] === "confirm"} disabled={!!busy[a.id]} onClick={() => act(a.id, "confirm")}>Approve</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
