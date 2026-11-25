import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { dateTime } from "../../lib/format.js";
import { PageHeader, Card, Badge, Empty, Spinner, ErrorNote, Button } from "../../components/ui.jsx";

const PAGE = 50;

const tone = (event) =>
  event.startsWith("confirm:") || event.startsWith("run:") ? "ok"
  : event.startsWith("staged:") ? "warn"
  : event.startsWith("cancel") || event.includes("failed") || event.includes("revoked") ? "danger"
  : "neutral";

const actorLabel = (actor) =>
  actor === "ai" ? "Assistant" : actor === "system" ? "System" : actor?.startsWith("api_key:") ? `Key · ${actor.slice(8)}` : actor === "anonymous" ? "Anonymous" : "Owner";

export default function Activity() {
  const [filter, setFilter] = useState("");
  const [reads, setReads] = useState(false);
  const [page, setPage] = useState(0);
  const { data, error, loading } = useLoad(
    () => api(`/audit?limit=${PAGE}&offset=${page * PAGE}&q=${encodeURIComponent(filter)}${reads ? "&reads=1" : ""}`),
    [filter, reads, page]
  );

  return (
    <>
      <PageHeader title="Activity log" subtitle="Append-only record of every change, approval, login and export." />
      <Card pad={false}>
        <div className="toolbar">
          <label className="search">
            <Search size={15} />
            <input placeholder="Filter events (e.g. stock, payment, login)" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }} aria-label="Filter events" />
          </label>
          <label className="check"><input type="checkbox" checked={reads} onChange={(e) => { setReads(e.target.checked); setPage(0); }} /> Include reads</label>
        </div>
        <ErrorNote>{error}</ErrorNote>
        {loading && !data ? <Spinner /> : !data?.length ? <Empty title="No activity" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Detail</th></tr></thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id}>
                    <td className="muted nowrap">{dateTime(row.created_at)}</td>
                    <td>{actorLabel(row.actor)}</td>
                    <td><Badge tone={tone(row.event)}>{row.event}</Badge></td>
                    <td className="muted detail">{row.detail?.summary || row.detail?.result || (row.detail && Object.keys(row.detail).length ? JSON.stringify(row.detail).slice(0, 140) : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pager">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <span className="muted small">Page {page + 1}</span>
          <Button variant="ghost" size="sm" disabled={!data || data.length < PAGE} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      </Card>
    </>
  );
}
