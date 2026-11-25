// ==================================================
// API CLIENT
// Auth lives in an httpOnly cookie (never readable by JS). Every request
// carries X-Requested-With so the server's CSRF guard accepts it.
// ==================================================

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export async function api(path, { method, body, timeout = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const verb = method || (body !== undefined ? "POST" : "GET");

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: verb,
      headers: {
        Accept: "application/json",
        "X-Requested-With": "ShopMind",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });

    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
      throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
    }
    return data ?? {};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === "AbortError") throw new ApiError("Request timed out. Please try again.");
    throw new ApiError("Can't reach ShopMind. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

/** Run a ShopMind tool by name (same tools the AI uses). */
export const runTool = (name, args = {}) =>
  api(`/tools/${encodeURIComponent(name)}`, { body: { args } }).then((r) => r.result);
