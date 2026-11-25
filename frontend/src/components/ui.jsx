import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, CheckCircle2, AlertTriangle, Inbox } from "lucide-react";

// ---------------------------------------------------------------- Button
export function Button({ variant = "primary", size, icon: Icon, loading, children, className = "", ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 size={15} className="spin" /> : Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Layout bits
export const Card = ({ title, action, children, className = "", pad = true }) => (
  <section className={`card ${className}`}>
    {(title || action) && (
      <header className="card-head">
        {title && <h3>{title}</h3>}
        {action}
      </header>
    )}
    <div className={pad ? "card-body" : ""}>{children}</div>
  </section>
);

export const Badge = ({ tone = "neutral", children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export const Empty = ({ icon: Icon = Inbox, title, children }) => (
  <div className="empty">
    <Icon size={22} />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);

export const Spinner = ({ label = "Loading" }) => (
  <div className="loading" role="status">
    <Loader2 size={18} className="spin" /> {label}…
  </div>
);

export const ErrorNote = ({ children }) =>
  children ? (
    <div className="error-note" role="alert">
      <AlertTriangle size={15} /> {children}
    </div>
  ) : null;

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat-tile ${tone ? `tone-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, description, children, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="modal"
            style={{ maxWidth: width }}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- Form fields
export function Field({ field, value, onChange, disabled }) {
  const common = {
    id: `f-${field.name}`,
    name: field.name,
    value: value ?? "",
    onChange: (e) => onChange(field.name, e.target.value),
    required: field.required,
    disabled,
    placeholder: field.placeholder,
  };
  return (
    <label className={`field ${field.wide ? "wide" : ""}`} htmlFor={common.id}>
      <span>
        {field.label}
        {field.required && <em aria-hidden> *</em>}
      </span>
      {field.type === "select" ? (
        <select {...common}>
          {!field.required && <option value="">—</option>}
          {field.options.map((o) => {
            const [v, l] = Array.isArray(o) ? o : [o, o];
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
      ) : field.type === "textarea" ? (
        <textarea rows={3} maxLength={field.max || 500} {...common} />
      ) : (
        <input
          type={field.type || "text"}
          step={field.step}
          min={field.min}
          maxLength={field.max || 200}
          list={field.list}
          {...common}
        />
      )}
      {field.hint && <small>{field.hint}</small>}
    </label>
  );
}

/**
 * A modal form driven by a field list. Empty inputs are omitted;
 * number fields are converted. onSubmit receives the cleaned values.
 */
export function FormModal({ open, onClose, title, description, fields, initial = {}, submitLabel = "Save", onSubmit, danger }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    const clean = {};
    for (const f of fields) {
      const raw = values[f.name];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      clean[f.name] = f.type === "number" ? Number(raw) : typeof raw === "string" ? raw.trim() : raw;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(clean);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} className="form-grid">
        {fields.map((f) => (
          <Field
            key={f.name}
            field={f}
            value={values[f.name]}
            disabled={busy}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
          />
        ))}
        <ErrorNote>{error}</ErrorNote>
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmModal({ open, onClose, title, children, confirmLabel = "Confirm", onConfirm, danger = true }) {
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={title}
      description={children}
      fields={[]}
      submitLabel={confirmLabel}
      danger={danger}
      onSubmit={onConfirm}
    />
  );
}

// ---------------------------------------------------------------- Toasts
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast toast-${t.tone}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              {t.tone === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** Pull a human message from a tool result (string or { message }). */
export const resultMessage = (result, fallback = "Done.") =>
  typeof result === "string" ? result : result?.message || fallback;
