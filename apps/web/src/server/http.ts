/**
 * Tiny helpers for the hand-rolled Vercel Node functions in /api. They use the same
 * minimal (req, res) shape as the existing api/*.ts handlers rather than the @vercel/node
 * types, so these helpers stay dependency-free.
 */

export interface NodeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  on?(event: string, listener: (chunk: unknown) => void): void;
  body?: unknown;
}

export interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/** Read and JSON-parse the request body, tolerating pre-parsed `req.body`. */
export async function readJsonBody<T = Record<string, unknown>>(
  req: NodeRequest,
): Promise<T> {
  if (req.body && typeof req.body === "object") return req.body as T;
  if (typeof req.body === "string" && req.body.length > 0) {
    return JSON.parse(req.body) as T;
  }
  if (typeof req.on !== "function") return {} as T;

  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    req.on!("data", (chunk) => {
      data += String(chunk);
    });
    req.on!("end", () => resolve(data));
    req.on!("error", (err) => reject(err));
  });
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

/** Read the raw request body as text, tolerating pre-parsed `req.body`. */
export async function readTextBody(req: NodeRequest): Promise<string> {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") {
    // Vercel may pre-parse form bodies into an object.
    return new URLSearchParams(req.body as Record<string, string>).toString();
  }
  if (typeof req.on !== "function") return "";

  return await new Promise<string>((resolve, reject) => {
    let data = "";
    req.on!("data", (chunk) => {
      data += String(chunk);
    });
    req.on!("end", () => resolve(data));
    req.on!("error", (err) => reject(err));
  });
}

export function sendJson(res: NodeResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** Extract a Bearer token from the Authorization header. */
export function bearerToken(req: NodeRequest): string | null {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : null;
}

export function firstQueryParam(req: NodeRequest, key: string): string | null {
  if (!req.url) return null;
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}
