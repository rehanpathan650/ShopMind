import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Site from "./Site.jsx";

const api = async (p, tok, body) => {
  const r = await fetch("/api" + p, { method: body !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(tok && { Authorization: "Bearer " + tok }) },
    body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
};
function Auth({ mode, setMode, close, onAuth }) {
  const [f, setF] = useState({ shop: "", email: "", password: "", demo: true });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { onAuth(await api("/auth/" + mode, null, f)); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
      <motion.form className="form" onSubmit={submit} onClick={(e) => e.stopPropagation()} initial={{ y: 30, scale: 0.96 }} animate={{ y: 0, scale: 1 }}>
        <h2 className="serif" style={{ fontSize: 28 }}>{mode === "register" ? "Open your shop" : "Welcome back"}</h2>
        {mode === "register" && <input type="text" placeholder="Shop name" value={f.shop} onChange={set("shop")} />}
        <input type="email" placeholder="Email" value={f.email} onChange={set("email")} />
        <input type="password" placeholder="Password (6+ characters)" value={f.password} onChange={set("password")} />
        {mode === "register" && <label className="mute"><input type="checkbox" checked={f.demo} onChange={set("demo")} /> Load sample customers and stock</label>}
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy}>{busy ? "…" : mode === "register" ? "Create shop" : "Log in"}</button>
        <span className="mute" style={{ cursor: "pointer" }} onClick={() => setMode(mode === "register" ? "login" : "register")}>
          {mode === "register" ? "Already have a shop? Log in" : "New here? Create a shop"}</span>
      </motion.form>
    </motion.div>
  );
}

function Dashboard({ session, logout }) {
  const tok = session.token;
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `Namaste! I'm ShopMind for ${session.shop}. Ask me about dues, stock, or payments.` }]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [tab, setTab] = useState("shop");
  const [ov, setOv] = useState({ dues: [], stock: [] }), [log, setLog] = useState([]);
  const end = useRef();
  const refresh = () => { api("/overview", tok).then(setOv).catch(() => {}); api("/audit", tok).then(setLog).catch(() => {}); };
  useEffect(refresh, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);
  const add = (m) => setMsgs((x) => [...x, m]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user", content: text }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await api("/chat", tok, { messages: next.filter((m) => m.content).map(({ role, content }) => ({ role, content })).slice(1) });
      add({ role: "assistant", content: r.reply, pending: r.pending });
    } catch (x) { add({ role: "assistant", content: "⚠️ " + x.message }); }
    setBusy(false); refresh();
  };
  const act = async (id, verb) => {
    setMsgs((x) => x.map((m) => ({ ...m, pending: m.pending?.filter((p) => p.id !== id) })));
    try { add({ role: "assistant", content: (verb === "confirm" ? "✓ " : "") + (await api(`/actions/${id}/${verb}`, tok, {})).result }); }
    catch (x) { add({ role: "assistant", content: "⚠️ " + x.message }); }
    refresh();
  };

  return (
    <div className="app">
      <div className="chat">
        <div className="top"><span className="logo">Shop<i>Mind</i> <span className="mute">· {session.shop}</span></span><button className="btn ghost" onClick={logout}>Log out</button></div>
        <div className="msgs">
          {msgs.map((m, i) => (
            <motion.div key={i} style={{ display: "contents" }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className={`b ${m.role === "user" ? "u" : "a"}`}>{m.content}</div>
              {m.pending?.map((p) => (
                <div className="act" key={p.id}>⚡ {p.summary}
                  <div><button className="btn" onClick={() => act(p.id, "confirm")}>Confirm</button>
                    <button className="btn ghost" onClick={() => act(p.id, "cancel")}>Cancel</button></div></div>
              ))}
            </motion.div>
          ))}
          {busy && <div className="b a mute">Thinking…</div>}
          <div ref={end} />
        </div>
        <form className="inp" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything: “Who owes me more than ₹10,000?”" />
          <button className="btn" disabled={busy}>Send</button>
        </form>
      </div>
      <aside className="side">
        <div className="tabs">{["shop", "audit"].map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "shop" ? "Your shop" : "Audit log"}</button>)}</div>
        {tab === "shop" ? (<>
          <h4>Dues</h4>{ov.dues.length ? ov.dues.map((d) => <div className="row" key={d.name}><span>{d.name}</span><b>₹{d.due.toLocaleString("en-IN")}</b></div>) : <p className="mute">Nothing owed.</p>}
          <h4 style={{ marginTop: 22 }}>Stock</h4>{ov.stock.length ? ov.stock.map((s) => <div className="row" key={s.name}><span>{s.name}</span><b>{s.qty}</b></div>) : <p className="mute">No products yet.</p>}
        </>) : log.map((l, i) => <div className="row" key={i}><span>{l.event}</span><span className="mute">{new Date(l.created_at).toLocaleTimeString()}</span></div>)}
      </aside>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("shopmind") || "null"));
  const [mode, setMode] = useState(null);
  const onAuth = (s) => { localStorage.setItem("shopmind", JSON.stringify(s)); setSession(s); setMode(null); };
  if (session) return <Dashboard session={session} logout={() => { localStorage.removeItem("shopmind"); setSession(null); }} />;
  return (<><Site open={setMode} /><AnimatePresence>{mode && <Auth mode={mode} setMode={setMode} close={() => setMode(null)} onAuth={onAuth} />}</AnimatePresence></>);
}
