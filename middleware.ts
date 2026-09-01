const PACK_HOSTNAME = "pack.biteproject.it";
const DATA_HOSTNAME = "data.biteproject.it";
const CREW_HOSTNAME = "crew.biteproject.it";
const ADMIN_HOSTNAME = "admin.biteproject.it";
const LOGIN_HOSTNAME = "login.biteproject.it";
const PACK_PREFIX = "/pack";
const DATA_PREFIX = "/Data";
const CREW_PREFIX = "/Crew";
// Only actual static-asset extensions bypass SPA/prerender routing. Article
// slugs are allowed to contain dots (for example "benvenuti-a-bordo.di-spritz").
const PUBLIC_FILE_RE = /\.(?:aac|avif|bmp|css|csv|eot|flac|gif|ico|jpe?g|js|m4a|map|mjs|mov|mp3|mp4|ogg|ogv|pdf|png|svg|txt|wasm|webm|webmanifest|webp|woff2?|xml)$/i;

const next = () =>
  new Response(null, {
    headers: { "x-middleware-next": "1" },
  });

const rewrite = (destination: URL) =>
  new Response(null, {
    headers: { "x-middleware-rewrite": destination.toString() },
  });

/**
 * Crawlers that don't (reliably) execute JavaScript get a prerendered HTML
 * document from /api/prerender with correct per-page meta and content.
 */
const BOT_UA_RE =
  /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|pinterest(?:bot)?|redditbot|applebot|ia_archiver|embedly|quora link preview|outbrain|vkshare|skypeuripreview|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexitybot|ccbot|bytespider|amazonbot/i;

/** Paths that must never be prerendered (private/system areas). */
const PRERENDER_EXCLUDE_RE =
  /^\/(api|admin|login|signup|bookings|unsubscribe|newsletter|mcp|\.well-known)(\/|$)/i;
/**
 * `/profile` (own account, private) stays excluded — but `/profile/:id`
 * (public profile pages) must reach /api/prerender, which decides per-profile
 * whether the page is indexable (admins only, see buildProfilePage).
 */
const OWN_PROFILE_RE = /^\/profile\/?$/i;
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

const isLocalHostname = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";

const isAuthPath = (pathname: string) =>
  pathname === "/login" || pathname === "/signup" || pathname === "/complete-profile";

export default function middleware(request: Request) {
  const hostname = getHostname(request);
  const url = new URL(request.url);

  if (hostname === LOGIN_HOSTNAME) {
    if (url.pathname === "/") {
      url.pathname = "/login";
      return Response.redirect(url, 307);
    }

    if (url.pathname.startsWith("/api/") || PUBLIC_FILE_RE.test(url.pathname) || isAuthPath(url.pathname)) {
      return next();
    }

    const target = new URL(url);
    target.hostname = "biteproject.it";
    target.pathname = url.pathname;
    return Response.redirect(target, 307);
  }

  if (!isLocalHostname(hostname) && isAuthPath(url.pathname)) {
    const target = new URL(url);
    target.hostname = LOGIN_HOSTNAME;
    return Response.redirect(target, 307);
  }

  if (hostname === ADMIN_HOSTNAME && url.pathname === "/") {
    url.pathname = "/admin";
    return Response.redirect(url, 307);
  }

  const prefix =
    hostname === PACK_HOSTNAME
      ? PACK_PREFIX
      : hostname === DATA_HOSTNAME
        ? DATA_PREFIX
        : hostname === CREW_HOSTNAME
          ? CREW_PREFIX
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

    // Dynamic rendering for crawlers: serve prerendered HTML with the
    // correct per-page meta (the SPA shell is identical on every URL).
    const userAgent = request.headers.get("user-agent") || "";
    if (
      request.method === "GET" &&
      BOT_UA_RE.test(userAgent) &&
      !PUBLIC_FILE_RE.test(url.pathname) &&
      !PRERENDER_EXCLUDE_RE.test(url.pathname) &&
      !OWN_PROFILE_RE.test(url.pathname)
    ) {
      const target = new URL(url);
      target.pathname = "/api/prerender";
      target.search = `?path=${encodeURIComponent(url.pathname)}`;
      return rewrite(target);
    }

    return next();
  }

  if (url.pathname.startsWith("/api/")) {
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
