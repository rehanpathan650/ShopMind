import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Modal, Button, ErrorNote } from "../components/ui.jsx";

export function AuthModal({ mode, setMode, onAuth }) {
  const [form, setForm] = useState({ shop: "", name: "", email: "", password: "", demo: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const register = mode === "register";

  useEffect(() => setError(""), [mode]);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = register
        ? { shop: form.shop.trim(), name: form.name.trim() || undefined, email: form.email.trim(), password: form.password, demo: form.demo }
        : { email: form.email.trim(), password: form.password };
      const session = await api(`/auth/${mode}`, { body });
      onAuth(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(mode)}
      onClose={() => setMode(null)}
      title={register ? "Create your shop" : "Welcome back"}
      description={register ? "Free while in pilot. No card required." : "Log in to your ShopMind workspace."}
      width={440}
    >
      <form className="form-stack" onSubmit={submit}>
        {register && (
          <>
            <label className="field">
              <span>Shop name</span>
              <input value={form.shop} onChange={set("shop")} maxLength={120} required autoComplete="organization" placeholder="Shree Ganesh Hardware" />
            </label>
            <label className="field">
              <span>Your name</span>
              <input value={form.name} onChange={set("name")} maxLength={80} autoComplete="name" placeholder="Optional" />
            </label>
          </>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set("email")} maxLength={254} required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            minLength={register ? 10 : 1}
            maxLength={128}
            required
            autoComplete={register ? "new-password" : "current-password"}
          />
          {register && <small>At least 10 characters, with a letter and a number.</small>}
        </label>
        {register && (
          <label className="check">
            <input type="checkbox" checked={form.demo} onChange={set("demo")} />
            Load a demo shop (products, customers, 2 weeks of sales)
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" loading={busy} className="btn-block">
          {register ? "Create shop" : "Log in"}
        </Button>
        <button type="button" className="link-btn" onClick={() => setMode(register ? "login" : "register")}>
          {register ? "Already have a shop? Log in" : "New to ShopMind? Create a shop"}
        </button>
      </form>
    </Modal>
  );
}
