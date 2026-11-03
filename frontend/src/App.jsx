
import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";

import { motion, AnimatePresence } from "framer-motion";
import Site from "./Site.jsx";

// ==================================================
// CONFIGURATION
// ==================================================

const API_BASE = "/api";
const REQUEST_TIMEOUT = 30_000;
const CHAT_TIMEOUT = 90_000;
const MAX_CHAT_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4_000;

// ==================================================
// API CLIENT
// ==================================================

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const api = async (path, token, body, options = {}) => {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    options.timeout ?? REQUEST_TIMEOUT
  );

  try {
    const headers = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: body !== undefined ? "POST" : "GET",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "";

    let data = null;

    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => "");
      data = text ? { error: text } : null;
    }

    if (!response.ok) {
      throw new ApiError(
        data?.error || `Request failed (${response.status})`,
        response.status
      );
    }

    return data ?? {};
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error.name === "AbortError") {
      throw new ApiError(
        "Request timed out. Please try again."
      );
    }

    if (error instanceof TypeError) {
      throw new ApiError(
        "Unable to connect to ShopMind. Check your internet connection."
      );
    }

    throw new ApiError(
      error.message || "Something went wrong."
    );
  } finally {
    clearTimeout(timeout);
  }
};

// ==================================================
// SESSION MANAGEMENT
// ==================================================

const SESSION_KEY = "shopmind";

const readSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return null;

    const session = JSON.parse(raw);

    if (
      !session ||
      typeof session.token !== "string" ||
      !session.token.trim() ||
      typeof session.shop !== "string" ||
      !session.shop.trim()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Storage may be unavailable.
    }

    return null;
  }
};

const saveSession = (session) => {
  if (
    !session ||
    typeof session.token !== "string" ||
    !session.token.trim() ||
    typeof session.shop !== "string" ||
    !session.shop.trim()
  ) {
    throw new Error("Invalid authentication response.");
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    throw new Error(
      "Unable to save your session. Check your browser storage settings."
    );
  }
};

const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};

// ==================================================
// MESSAGE HELPER
// ==================================================

const createMessage = (role, content, extra = {}) => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  content,
  ...extra,
});

// ==================================================
// AUTHENTICATION
// ==================================================

function Auth({ mode, setMode, close, onAuth }) {
  const [form, setForm] = useState({
    shop: "",
    email: "",
    password: "",
    demo: true,
  });

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const updateField = (key) => (event) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;

    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));

    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();

    if (busy) return;

    setError("");

    if (mode === "register" && !form.shop.trim()) {
      setError("Please enter your shop name.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      const session = await api(
        `/auth/${mode}`,
        null,
        {
          shop: form.shop.trim(),
          email: form.email.trim(),
          password: form.password,
          demo: form.demo,
        }
      );

      onAuth(session);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    if (busy) return;

    setError("");
    setMode(mode === "register" ? "login" : "register");
  };

  return (
    <motion.div
      className="modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={close}
    >
      <motion.form
        className="form"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        initial={{ y: 30, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <h2 className="serif" style={{ fontSize: 28 }}>
          {mode === "register"
            ? "Open your shop"
            : "Welcome back"}
        </h2>

        {mode === "register" && (
          <input
            type="text"
            placeholder="Shop name"
            aria-label="Shop name"
            autoComplete="organization"
            value={form.shop}
            onChange={updateField("shop")}
            maxLength={120}
            required
            disabled={busy}
          />
        )}

        <input
          type="email"
          placeholder="Email"
          aria-label="Email address"
          autoComplete="email"
          value={form.email}
          onChange={updateField("email")}
          maxLength={254}
          required
          disabled={busy}
        />

        <input
          type="password"
          placeholder="Password (8+ characters)"
          aria-label="Password"
          autoComplete={
            mode === "register"
              ? "new-password"
              : "current-password"
          }
          value={form.password}
          onChange={updateField("password")}
          minLength={8}
          maxLength={128}
          required
          disabled={busy}
        />

        {mode === "register" && (
          <label className="mute">
            <input
              type="checkbox"
              checked={form.demo}
              onChange={updateField("demo")}
              disabled={busy}
            />
            {" "}
            Load sample customers and stock
          </label>
        )}

        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}

        <button
          className="btn"
          type="submit"
          disabled={busy}
        >
          {busy
            ? "Please wait…"
            : mode === "register"
              ? "Create shop"
              : "Log in"}
        </button>

        <button
          type="button"
          className="mute"
          style={{
            cursor: busy ? "not-allowed" : "pointer",
            background: "none",
            border: "none",
            padding: 0,
          }}
          onClick={switchMode}
          disabled={busy}
        >
          {mode === "register"
            ? "Already have a shop? Log in"
            : "New here? Create a shop"}
        </button>
      </motion.form>
    </motion.div>
  );
}

// ==================================================
// DASHBOARD
// ==================================================

function Dashboard({ session, logout }) {
  const token = session.token;

  const [messages, setMessages] = useState([
    createMessage(
      "assistant",
      `Namaste! I'm ShopMind for ${session.shop}. Ask me about dues, stock, or payments.`
    ),
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("shop");

  const [overview, setOverview] = useState({
    dues: [],
    stock: [],
  });

  const [auditLog, setAuditLog] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const [actionBusy, setActionBusy] = useState({});

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // ------------------------------------------------
  // DASHBOARD DATA
  // ------------------------------------------------

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setDashboardError("");

    try {
      const results = await Promise.allSettled([
        api("/overview", token),
        api("/audit", token),
      ]);

      const unauthorized = results.some(
        (result) =>
          result.status === "rejected" &&
          result.reason?.status === 401
      );

      if (unauthorized) {
        logout();
        return;
      }

      let hasError = false;

      if (results[0].status === "fulfilled") {
        setOverview({
          dues: Array.isArray(results[0].value.dues)
            ? results[0].value.dues
            : [],
          stock: Array.isArray(results[0].value.stock)
            ? results[0].value.stock
            : [],
        });
      } else {
        hasError = true;
      }

      if (results[1].status === "fulfilled") {
        setAuditLog(
          Array.isArray(results[1].value)
            ? results[1].value
            : []
        );
      } else {
        hasError = true;
      }

      if (hasError) {
        setDashboardError(
          "Some dashboard information could not be refreshed."
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [token, logout]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ------------------------------------------------
  // CHAT SCROLL
  // ------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, busy]);

  // ------------------------------------------------
  // SEND CHAT MESSAGE
  // ------------------------------------------------

  const send = async (event) => {
    event.preventDefault();

    const content = input.trim();

    if (!content || busy) return;

    if (content.length > MAX_MESSAGE_LENGTH) {
      setMessages((previous) => [
        ...previous,
        createMessage(
          "assistant",
          `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`
        ),
      ]);
      return;
    }

    const userMessage = createMessage("user", content);

    const nextMessages = [
      ...messages,
      userMessage,
    ];

    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    try {
      // Exclude the initial welcome message.
      // Send only the most recent conversation messages.
      const history = nextMessages
        .slice(1)
        .slice(-MAX_CHAT_MESSAGES)
        .map(({ role, content }) => ({
          role,
          content,
        }));

      const response = await api(
        "/chat",
        token,
        {
          messages: history,
        },
        {
          timeout: CHAT_TIMEOUT,
        }
      );

      setMessages((previous) => [
        ...previous,
        createMessage(
          "assistant",
          response.reply || "I couldn't generate a response.",
          {
            pending: Array.isArray(response.pending)
              ? response.pending
              : [],
          }
        ),
      ]);

      await refresh();
    } catch (error) {
      if (error.status === 401) {
        logout();
        return;
      }

      setMessages((previous) => [
        ...previous,
        createMessage(
          "assistant",
          `⚠️ ${error.message}`
        ),
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  // ------------------------------------------------
  // CONFIRM / CANCEL ACTION
  // ------------------------------------------------

  const handleAction = async (id, verb) => {
    if (actionBusy[id]) return;

    setActionBusy((previous) => ({
      ...previous,
      [id]: true,
    }));

    try {
      const response = await api(
        `/actions/${encodeURIComponent(id)}/${verb}`,
        token,
        {}
      );

      // Remove the pending action only after success.
      setMessages((previous) =>
        previous.map((message) => ({
          ...message,
          pending: message.pending?.filter(
            (action) => action.id !== id
          ),
        }))
      );

      setMessages((previous) => [
        ...previous,
        createMessage(
          "assistant",
          `${verb === "confirm" ? "✓ " : ""}${
            response.result || "Action processed."
          }`
        ),
      ]);

      await refresh();
    } catch (error) {
      if (error.status === 401) {
        logout();
        return;
      }

      // Keep the pending action visible so the owner
      // can retry after resolving the problem.
      setMessages((previous) => [
        ...previous,
        createMessage(
          "assistant",
          `⚠️ ${error.message}`
        ),
      ]);
    } finally {
      setActionBusy((previous) => {
        const updated = { ...previous };
        delete updated[id];
        return updated;
      });
    }
  };

  // ------------------------------------------------
  // RENDER
  // ------------------------------------------------

  return (
    <div className="app">

      {/* CHAT PANEL */}

      <div className="chat">

        <div className="top">
          <span className="logo">
            Shop<i>Mind</i>
            {" "}
            <span className="mute">
              · {session.shop}
            </span>
          </span>

          <button
            className="btn ghost"
            onClick={logout}
          >
            Log out
          </button>
        </div>

        <div
          className="msgs"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.map((message) => (
            <motion.div
              key={message.id}
              style={{ display: "contents" }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className={`b ${
                  message.role === "user" ? "u" : "a"
                }`}
              >
                {message.content}
              </div>

              {message.pending?.map((action) => (
                <div className="act" key={action.id}>
                  <div>
                    ⚡ {action.summary}
                  </div>

                  <div>
                    <button
                      className="btn"
                      onClick={() =>
                        handleAction(action.id, "confirm")
                      }
                      disabled={!!actionBusy[action.id]}
                    >
                      {actionBusy[action.id]
                        ? "Processing…"
                        : "Confirm"}
                    </button>

                    <button
                      className="btn ghost"
                      onClick={() =>
                        handleAction(action.id, "cancel")
                      }
                      disabled={!!actionBusy[action.id]}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </motion.div>
          ))}

          {busy && (
            <div className="b a mute">
              Thinking…
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form className="inp" onSubmit={send}>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) =>
              setInput(event.target.value)
            }
            placeholder='Ask anything: "Who owes me more than ₹10,000?"'
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={busy}
            aria-label="Message ShopMind"
          />

          <button
            className="btn"
            type="submit"
            disabled={busy || !input.trim()}
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>

      {/* SHOP SIDEBAR */}

      <aside className="side">

        <div className="tabs">
          {["shop", "audit"].map((item) => (
            <button
              key={item}
              className={tab === item ? "on" : ""}
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
            >
              {item === "shop"
                ? "Your shop"
                : "Audit log"}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {tab === "shop" ? (
            <h4>Shop overview</h4>
          ) : (
            <h4>Recent activity</h4>
          )}

          <button
            type="button"
            className="btn ghost"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh dashboard"
          >
            {refreshing ? "…" : "↻"}
          </button>
        </div>

        {dashboardError && (
          <p className="err" role="alert">
            {dashboardError}
          </p>
        )}

        {tab === "shop" ? (
          <>
            <h4>Dues</h4>

            {overview.dues.length ? (
              overview.dues.map((customer) => (
                <div
                  className="row"
                  key={customer.id || customer.name}
                >
                  <span>{customer.name}</span>

                  <b>
                    ₹{Number(customer.due || 0).toLocaleString(
                      "en-IN",
                      { maximumFractionDigits: 2 }
                    )}
                  </b>
                </div>
              ))
            ) : (
              <p className="mute">
                Nothing owed.
              </p>
            )}

            <h4 style={{ marginTop: 22 }}>
              Stock
            </h4>

            {overview.stock.length ? (
              overview.stock.map((product) => (
                <div
                  className="row"
                  key={product.id || product.name}
                >
                  <span>{product.name}</span>
                  <b>{product.qty}</b>
                </div>
              ))
            ) : (
              <p className="mute">
                No products yet.
              </p>
            )}
          </>
        ) : (
          <>
            {auditLog.length ? (
              auditLog.map((entry) => (
                <div
                  className="row"
                  key={entry.id}
                >
                  <span>{entry.event}</span>

                  <span className="mute">
                    {entry.created_at
                      ? new Date(
                          entry.created_at
                        ).toLocaleString()
                      : ""}
                  </span>
                </div>
              ))
            ) : (
              <p className="mute">
                No activity recorded yet.
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// ==================================================
// MAIN APPLICATION
// ==================================================

export default function App() {
  const [session, setSession] = useState(readSession);
  const [mode, setMode] = useState(null);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const onAuth = (newSession) => {
    try {
      saveSession(newSession);
      setSession(newSession);
      setMode(null);
    } catch (error) {
      window.alert(error.message);
    }
  };

  if (session) {
    return (
      <Dashboard
        session={session}
        logout={logout}
      />
    );
  }

  return (
    <>
      <Site open={setMode} />

      <AnimatePresence>
        {mode && (
          <Auth
            mode={mode}
            setMode={setMode}
            close={() => setMode(null)}
            onAuth={onAuth}
          />
        )}
      </AnimatePresence>
    </>
  );
}
