import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data with loading/error state and a reload() function.
 */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await loader();
      if (alive.current) setState({ data, error: "", loading: false });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error: error.message, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { ...state, reload };
}

/** Current hash route, e.g. "#/app/inventory" -> "app/inventory". */
export function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "") || "";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const navigate = (path) => {
  window.location.hash = `#/${path}`;
};
