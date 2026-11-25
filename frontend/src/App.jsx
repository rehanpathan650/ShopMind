import { useCallback, useEffect, useState } from "react";
import Site from "./site/Site.jsx";
import { AuthModal } from "./site/AuthModal.jsx";
import Shell from "./app/Shell.jsx";
import { api, setUnauthorizedHandler } from "./lib/api.js";
import { ToastProvider, Spinner } from "./components/ui.jsx";
import { navigate } from "./lib/hooks.js";

export default function App() {
  // undefined = checking, null = logged out, object = logged in
  const [session, setSession] = useState(undefined);
  const [authMode, setAuthMode] = useState(null);

  useEffect(() => {
    api("/auth/me")
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { body: {} });
    } catch {
      // ignore: cookie may already be gone
    }
    setSession(null);
    navigate("");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
  }, []);

  const onAuth = (s) => {
    setSession(s);
    setAuthMode(null);
    navigate("app");
  };

  if (session === undefined) {
    return (
      <div className="boot">
        <Spinner label="Opening ShopMind" />
      </div>
    );
  }

  return (
    <ToastProvider>
      {session ? (
        <Shell session={session} setSession={setSession} logout={logout} />
      ) : (
        <>
          <Site open={setAuthMode} />
          <AuthModal mode={authMode} setMode={setAuthMode} onAuth={onAuth} />
        </>
      )}
    </ToastProvider>
  );
}
