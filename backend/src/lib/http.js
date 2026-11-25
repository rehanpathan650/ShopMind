// ==================================================
// HTTP HELPERS
// ==================================================

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const httpError = (status, message, details) =>
  new HttpError(status, message, details);

/**
 * Wrap an async route handler so rejected promises reach the error handler.
 */
export const wrap = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

export const requireUuid = (value, label = "ID") => {
  if (!isUuid(value)) throw httpError(400, `Invalid ${label}`);
  return value;
};

export const isEmail = (email) =>
  typeof email === "string" &&
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const normalizeEmail = (email) => email.trim().toLowerCase();

/**
 * Parse ?limit=&offset= safely.
 */
export const paging = (query, { defaultLimit = 50, maxLimit = 200 } = {}) => {
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1),
    maxLimit
  );
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
};

/**
 * Render an array of flat objects as CSV. Guards against
 * spreadsheet formula injection (cells starting with = + - @).
 */
export const toCsv = (rows) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const cell = (value) => {
    if (value === null || value === undefined) return "";
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(",")),
  ].join("\n");
};
