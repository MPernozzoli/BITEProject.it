const PACK_HOSTNAME = "pack.biteproject.it";
const DATA_HOSTNAME = "data.biteproject.it";
const ADMIN_HOSTNAME = "admin.biteproject.it";
const PACK_PREFIX = "/pack";
const DATA_PREFIX = "/Data";
const PUBLIC_FILE_RE = /\.[a-z0-9]+$/i;

const next = () =>
  new Response(null, {
    headers: { "x-middleware-next": "1" },
  });

const rewrite = (destination: URL) =>
  new Response(null, {
    headers: { "x-middleware-rewrite": destination.toString() },
  });

/**
 * Public content routes are server-rendered for EVERY visitor (no User-Agent
 * sniffing): the request is rewritten to /api/render, which returns a complete
 * HTML document (title, body, meta, JSON-LD) that also boots the React SPA.
 * This matches the localized public routes declared in the app router.
 */
const SSR_PATH_RE =
  /^\/(it|en)(\/(crew|manifesto|links|collaborations|contact|logbook|voyages)(\/[^/]+)?(\/[^/]+)?)?$/i;

/** Paths that are never server-rendered (private/system areas, assets, APIs). */
const SSR_EXCLUDE_RE =
  /^\/(api|admin|login|signup|bookings|profile|unsubscribe|newsletter)(\/|$)/i;
const LANG_PREFIX_RE = /^\/(it|en)(\/|$)/i;
const LEGACY_PUBLIC_PATH_RE =
  /^\/(crew|manifesto|logbook|voyages|links|linktree|route|collaborations|contact)(\/|$)/i;

const getHostname = (request: Request) => {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0]?.toLowerCase() || "";
};

const getPreferredLang = (request: Request): "it" | "en" => {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)bite-lang=(it|en)(?:;|$)/i);
  if (match) return match[1].toLowerCase() as "it" | "en";
  const acceptLanguage = (request.headers.get("accept-language") || "").toLowerCase();
  for (const part of acceptLanguage.split(",")) {
    const code = part.trim().split("-")[0].split(";")[0];
    if (code === "it") return "it";
    if (code === "en") return "en";
  }
  return "it";
};

export default function middleware(request: Request) {
  const hostname = getHostname(request);
  const url = new URL(request.url);

  if (hostname === ADMIN_HOSTNAME && url.pathname === "/") {
    url.pathname = "/admin";
    return Response.redirect(url, 307);
  }

  const prefix =
    hostname === PACK_HOSTNAME
      ? PACK_PREFIX
      : hostname === DATA_HOSTNAME
        ? DATA_PREFIX
        : null;

  if (!prefix) {
    // Main site.

    // Root → /it or /en at the HTTP level (302: language-dependent), so
    // crawlers get a real redirect instead of the client-side <Navigate>.
    if (url.pathname === "/") {
      const target = new URL(url);
      target.pathname = `/${getPreferredLang(request)}`;
      return Response.redirect(target, 302);
    }

    // Legacy unprefixed public URLs are redirects, not alternate crawlable
    // documents. This avoids duplicate URL sets such as /manifesto and
    // /en/manifesto while preserving old inbound links.
    if (!LANG_PREFIX_RE.test(url.pathname) && LEGACY_PUBLIC_PATH_RE.test(url.pathname)) {
      const target = new URL(url);
      target.pathname = `/${getPreferredLang(request)}${url.pathname}`;
      return Response.redirect(target, 302);
    }

    // Universal server-side rendering: every visitor (browser, crawler, AI
    // agent) gets the same full HTML document with the article content already
    // in the markup. No User-Agent detection, no bot-only variant.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !PUBLIC_FILE_RE.test(url.pathname) &&
      !SSR_EXCLUDE_RE.test(url.pathname) &&
      SSR_PATH_RE.test(url.pathname)
    ) {
      const target = new URL(url);
      target.pathname = "/api/render";
      target.search = `?path=${encodeURIComponent(url.pathname)}`;
      return rewrite(target);
    }

    return next();
  }

  if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
    return next();
  }

  const target = new URL(request.url);
  target.pathname = PUBLIC_FILE_RE.test(url.pathname)
    ? `${prefix}${url.pathname}`
    : `${prefix}/index.html`;

  return rewrite(target);
}
