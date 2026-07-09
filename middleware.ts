import { next, rewrite } from "@vercel/functions";

const PACK_HOSTNAME = "pack.biteproject.it";
const DATA_HOSTNAME = "data.biteproject.it";
const ADMIN_HOSTNAME = "admin.biteproject.it";
const PACK_PREFIX = "/_pack";
const DATA_PREFIX = "/_data";
const PUBLIC_FILE_RE = /\.[a-z0-9]+$/i;

const getHostname = (request: Request) => {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0]?.toLowerCase() || "";
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
