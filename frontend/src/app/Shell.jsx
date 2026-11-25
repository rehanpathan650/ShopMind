import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  LayoutDashboard, MessageSquare, Inbox, Boxes, Users, Receipt, Wallet, Truck,
  ScrollText, Code2, Settings as SettingsIcon, LogOut, Menu, X, Globe,
} from "lucide-react";
import { Logo } from "../components/Logo.jsx";
import { api } from "../lib/api.js";
import { useHashRoute } from "../lib/hooks.js";

import Overview from "./pages/Overview.jsx";
import Assistant from "./pages/Assistant.jsx";
import Approvals from "./pages/Approvals.jsx";
import Inventory from "./pages/Inventory.jsx";
import Customers from "./pages/Customers.jsx";
import Sales from "./pages/Sales.jsx";
import Expenses from "./pages/Expenses.jsx";
import Suppliers from "./pages/Suppliers.jsx";
import Activity from "./pages/Activity.jsx";
import Developers from "./pages/Developers.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  ["Workspace", [
    ["", "Overview", LayoutDashboard, Overview],
    ["assistant", "Assistant", MessageSquare, Assistant],
    ["approvals", "Approvals", Inbox, Approvals],
  ]],
  ["Operations", [
    ["inventory", "Inventory", Boxes, Inventory],
    ["customers", "Customers", Users, Customers],
    ["sales", "Sales", Receipt, Sales],
    ["expenses", "Expenses", Wallet, Expenses],
    ["suppliers", "Suppliers", Truck, Suppliers],
  ]],
  ["Admin", [
    ["activity", "Activity log", ScrollText, Activity],
    ["developers", "API & MCP", Code2, Developers],
    ["settings", "Settings", SettingsIcon, Settings],
  ]],
];

const PAGES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([path, , , C]) => [path, C])));

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export default function Shell({ session, setSession, logout }) {
  const route = useHashRoute();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const sub = route.startsWith("app") ? route.replace(/^app\/?/, "").split(/[/?]/)[0] : "";
  const Page = PAGES[sub] || Overview;

  const refreshPending = useCallback(async () => {
    try {
      const rows = await api("/actions?status=pending");
      setPendingCount(rows.length);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    refreshPending();
    const t = setInterval(refreshPending, 30_000);
    return () => clearInterval(t);
  }, [refreshPending]);

  useEffect(() => setOpen(false), [route]);

  return (
    <AppContext.Provider value={{ session, setSession, logout, pendingCount, refreshPending }}>
      <div className="shell">
        <aside className={`sidebar ${open ? "open" : ""}`}>
          <div className="sidebar-top">
            <a href="#/app"><Logo /></a>
            <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <div className="shop-chip">
            <span className="avatar">{session.shop?.[0]?.toUpperCase() || "S"}</span>
            <div>
              <strong>{session.shop}</strong>
              <small>{session.email}</small>
            </div>
          </div>
          <nav className="side-nav" aria-label="App">
            {NAV.map(([group, items]) => (
              <div key={group} className="side-group">
                <span className="side-label">{group}</span>
                {items.map(([path, label, Icon]) => (
                  <a key={label} href={`#/app${path ? `/${path}` : ""}`} className={sub === path ? "active" : ""} aria-current={sub === path ? "page" : undefined}>
                    <Icon size={16} />
                    <span>{label}</span>
                    {path === "approvals" && pendingCount > 0 && <em className="count">{pendingCount}</em>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a href="#/" onClick={(e) => { e.preventDefault(); window.open(`${location.origin}/#/docs`, "_blank", "noopener"); }}>
              <Globe size={16} /> <span>Docs</span>
            </a>
            <button onClick={logout}><LogOut size={16} /> <span>Log out</span></button>
          </div>
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}

        <div className="main">
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <Logo />
            <span />
          </div>
          <div className={`page ${sub === "assistant" ? "page-full" : ""}`}>
            <Page key={sub} />
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}
