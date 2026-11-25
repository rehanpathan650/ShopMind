import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, X, Wrench, RotateCcw, Sparkles, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button, useToast, resultMessage } from "../../components/ui.jsx";
import { Markdown } from "../Markdown.jsx";
import { useApp } from "../Shell.jsx";

const STORE = "shopmind.chat";
const MAX_HISTORY = 30;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

const PROMPTS = [
  ["Business health", "How is my business doing this month? Give me 3 things to act on."],
  ["Collections", "Who owes me money? Prioritise by amount and how old the dues are."],
  ["Restock", "What's running low and how much should I reorder?"],
  ["Record a sale", "Sell 10 cement bags to Patil Constructions on credit"],
  ["Profit", "Show profit and loss for this month"],
  ["Draft reminder", "Draft a polite payment reminder for Sharma Traders in Hindi"],
];

const load = () => {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export default function Assistant() {
  const { session, refreshPending } = useApp();
  const toast = useToast();
  const [messages, setMessages] = useState(load);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState({});
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-60)));
    } catch {
      // storage unavailable: chat still works, it just won't survive reloads
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // Prefill from ?q= (links from the overview page).
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "").get("q");
    if (q) {
      history.replaceState(null, "", "#/app/assistant");
      send(q);
    } else {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { id: uid(), role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const history = next
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-MAX_HISTORY)
        .map(({ role, content }) => ({ role, content }));
      const res = await api("/chat", { body: { messages: history }, timeout: 180_000 });
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", content: res.reply || "…", pending: res.pending || [], tools: res.tools || [] },
      ]);
      if (res.pending?.length) refreshPending();
    } catch (error) {
      setMessages((m) => [...m, { id: uid(), role: "error", content: error.message }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function act(action, verb) {
    setActing((s) => ({ ...s, [action.id]: verb }));
    try {
      const res = await api(`/actions/${action.id}/${verb}`, { body: {} });
      setMessages((m) =>
        m.map((msg) => ({
          ...msg,
          pending: msg.pending?.map((p) => (p.id === action.id ? { ...p, state: verb === "confirm" ? "done" : "cancelled", result: resultMessage(res.result) } : p)),
        }))
      );
      toast(verb === "confirm" ? resultMessage(res.result) : "Action cancelled.");
      refreshPending();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setActing((s) => {
        const c = { ...s };
        delete c[action.id];
        return c;
      });
    }
  }

  const reset = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  return (
    <div className="assistant">
      <div className="assistant-head">
        <div>
          <h1>Assistant</h1>
          <p>Claude with 44 tools for {session.shop}. Changes wait for your approval.</p>
        </div>
        {messages.length > 0 && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>New chat</Button>}
      </div>

      <div className="thread" aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-empty">
            <span className="spark"><Sparkles size={20} /></span>
            <h2>What should we work on?</h2>
            <p>Ask about stock, dues, sales or profit, or tell it what happened today.</p>
            <div className="prompt-grid">
              {PROMPTS.map(([title, prompt]) => (
                <button key={title} className="prompt-card" onClick={() => send(prompt)}>
                  <strong>{title}</strong>
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`turn ${m.role}`}>
            {m.role === "user" && <div className="bubble user">{m.content}</div>}
            {m.role === "error" && <div className="bubble error"><ShieldAlert size={15} /> {m.content}</div>}
            {m.role === "assistant" && (
              <div className="bubble bot">
                {m.tools?.length > 0 && (
                  <div className="tool-trace">
                    <Wrench size={12} />
                    {m.tools.map((t, i) => <code key={i} className={t.ok ? "" : "fail"}>{t.tool}</code>)}
                  </div>
                )}
                <Markdown text={m.content} />
                {m.pending?.map((p) => (
                  <div key={p.id} className={`approval ${p.state || ""} ${p.destructive ? "destructive" : ""}`}>
                    <div>
                      <span className="eyebrow">
                        {p.state === "done" ? "Approved" : p.state === "cancelled" ? "Cancelled" : p.destructive ? "Destructive · needs approval" : "Needs your approval"}
                      </span>
                      <strong>{p.summary}</strong>
                      {p.result && <small>{p.result}</small>}
                    </div>
                    {!p.state && (
                      <div className="approval-btns">
                        <Button variant="ghost" size="sm" icon={X} loading={acting[p.id] === "cancel"} disabled={!!acting[p.id]} onClick={() => act(p, "cancel")}>Cancel</Button>
                        <Button variant={p.destructive ? "danger" : "primary"} size="sm" icon={Check} loading={acting[p.id] === "confirm"} disabled={!!acting[p.id]} onClick={() => act(p, "confirm")}>Confirm</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="turn assistant">
            <div className="bubble bot thinking"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          maxLength={6000}
          placeholder='Ask anything, e.g. "Who owes me more than ₹10,000?"'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
          aria-label="Message ShopMind"
        />
        <button type="submit" className="send" disabled={busy || !input.trim()} aria-label="Send">
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  );
}
