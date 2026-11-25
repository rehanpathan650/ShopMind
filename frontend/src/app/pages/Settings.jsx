import { useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { PageHeader, Card, Button, ErrorNote, Field, Spinner, ConfirmModal, useToast } from "../../components/ui.jsx";
import { useApp } from "../Shell.jsx";

export default function Settings() {
  const toast = useToast();
  const { setSession, session } = useApp();
  const shop = useLoad(() => api("/settings"), []);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [logoutAll, setLogoutAll] = useState(false);

  useEffect(() => {
    if (shop.data) {
      setForm({
        name: shop.data.name || "",
        phone: shop.data.phone || "",
        address: shop.data.address || "",
        gstin: shop.data.gstin || "",
        low_stock_threshold: String(shop.data.low_stock_threshold ?? 10),
      });
    }
  }, [shop.data]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        gstin: form.gstin.trim(),
        low_stock_threshold: Number.parseInt(form.low_stock_threshold, 10),
      };
      const res = await api("/settings", { method: "PATCH", body });
      setSession({ ...session, shop: res.name });
      toast("Settings saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    setPwError("");
    try {
      await api("/auth/password", { body: pw });
      setPw({ current: "", next: "" });
      toast("Password changed. Other devices were signed out.");
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Shop profile, security and sessions." />
      <div className="grid-2">
        <Card title="Shop profile">
          {!shop.data ? <Spinner /> : (
            <form className="form-grid" onSubmit={save}>
              <Field field={{ name: "name", label: "Shop name", required: true, wide: true, max: 120 }} value={form.name} onChange={set} />
              <Field field={{ name: "phone", label: "Phone", type: "tel", max: 20 }} value={form.phone} onChange={set} />
              <Field field={{ name: "gstin", label: "GSTIN", max: 15, placeholder: "27ABCDE1234F1Z5" }} value={form.gstin} onChange={set} />
              <Field field={{ name: "address", label: "Address", wide: true, max: 300 }} value={form.address} onChange={set} />
              <Field field={{ name: "low_stock_threshold", label: "Default reorder level", type: "number", min: 0, hint: "Used when a product has no reorder level" }} value={form.low_stock_threshold} onChange={set} />
              <ErrorNote>{error}</ErrorNote>
              <div className="form-actions"><Button type="submit" loading={busy}>Save changes</Button></div>
            </form>
          )}
        </Card>

        <div className="stack">
          <Card title="Change password">
            <form className="form-grid" onSubmit={changePassword}>
              <label className="field wide">
                <span>Current password</span>
                <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} required maxLength={128} />
              </label>
              <label className="field wide">
                <span>New password</span>
                <input type="password" autoComplete="new-password" value={pw.next} minLength={10} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} required maxLength={128} />
                <small>At least 10 characters with a letter and a number.</small>
              </label>
              <ErrorNote>{pwError}</ErrorNote>
              <div className="form-actions"><Button type="submit" loading={pwBusy}>Update password</Button></div>
            </form>
          </Card>
          <Card title="Sessions">
            <p className="muted small"><ShieldCheck size={14} /> You're signed in as {session.email}. Sessions use secure httpOnly cookies and expire after 7 days.</p>
            <Button variant="danger" size="sm" icon={LogOut} onClick={() => setLogoutAll(true)}>Sign out of all devices</Button>
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={logoutAll}
        onClose={() => setLogoutAll(false)}
        title="Sign out everywhere?"
        confirmLabel="Sign out all devices"
        onConfirm={async () => {
          await api("/auth/logout-all", { body: {} });
          setSession(null);
        }}
      >
        Every browser session, including this one, will be signed out. API keys keep working.
      </ConfirmModal>
    </>
  );
}
