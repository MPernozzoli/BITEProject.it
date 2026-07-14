/**
 * Loads the built SPA shell (`index.html`) so the server-rendered article
 * document still boots the React app for interactive visitors.
 *
 * The shell carries the content-hashed `<script type="module">` / CSS `<link>`
 * tags emitted by the Vite build. We must NOT hard-code them (they change every
 * deploy), so we read the shell at runtime and cache it for the lifetime of the
 * warm serverless instance (it is identical for every URL of a deployment).
 *
 * Resolution order:
 *   1. Filesystem — the static build output co-located with the deployment.
 *   2. HTTP self-fetch of `/index.html` (never rewritten to this function).
 * If both fail we return null and the caller serves a standalone document
 * (crawlers still get full content; the page degrades to non-interactive).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

let cachedShell: string | null = null;
let cachedShellResolved = false;

const FS_CANDIDATES = [
  "index.html",
  "dist/index.html",
  "public/index.html",
  "apps/web/dist/index.html",
  "../index.html",
];

const looksLikeShell = (html: string): boolean =>
  html.includes('id="root"') && html.includes("<script");

const readFromFs = async (): Promise<string | null> => {
  for (const candidate of FS_CANDIDATES) {
    try {
      const full = path.isAbsolute(candidate)
        ? candidate
        : path.join(process.cwd(), candidate);
      const html = await readFile(full, "utf8");
      if (looksLikeShell(html)) return html;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

const originFromRequest = (req: { headers?: Record<string, unknown> }): string | null => {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const headers = req.headers || {};
  const host =
    (headers["x-forwarded-host"] as string) || (headers["host"] as string) || "";
  if (!host) return null;
  const proto = (headers["x-forwarded-proto"] as string) || "https";
  return `${proto}://${String(host).split(",")[0].trim()}`;
};

const readFromHttp = async (req: {
  headers?: Record<string, unknown>;
}): Promise<string | null> => {
  const origin = originFromRequest(req);
  if (!origin) return null;
  try {
    const response = await fetch(`${origin}/index.html`, {
      headers: { "user-agent": "bite-ssr-shell" },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return looksLikeShell(html) ? html : null;
  } catch {
    return null;
  }
};

export const getAppShell = async (req: {
  headers?: Record<string, unknown>;
}): Promise<string | null> => {
  if (cachedShellResolved) return cachedShell;

  cachedShell = (await readFromFs()) || (await readFromHttp(req));
  // Only treat a successful load as cacheable; retry on the next request if it
  // failed (e.g. cold-start before the static output was reachable).
  if (cachedShell) cachedShellResolved = true;
  return cachedShell;
};
