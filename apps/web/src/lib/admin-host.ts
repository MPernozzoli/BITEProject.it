export const ADMIN_HOSTNAME = "admin.biteproject.it";
export const LOGIN_HOSTNAME = "login.biteproject.it";
export const MAIN_HOSTNAME = "biteproject.it";

export const isAdminHostname = (hostname: string) =>
  hostname === ADMIN_HOSTNAME || hostname.startsWith(`${ADMIN_HOSTNAME}.`);

export const isLoginHostname = (hostname: string) =>
  hostname === LOGIN_HOSTNAME || hostname.startsWith(`${LOGIN_HOSTNAME}.`);

export const isCurrentAdminHostname = () =>
  typeof window !== "undefined" && isAdminHostname(window.location.hostname);

export const isCurrentLoginHostname = () =>
  typeof window !== "undefined" && isLoginHostname(window.location.hostname);

export const shouldRedirectToAdminHostname = (hostname: string) =>
  hostname === "biteproject.it" || hostname === "www.biteproject.it";

export const getAdminUrl = (path = "/admin") => {
  if (typeof window === "undefined") return path;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const { protocol, hostname, port } = window.location;

  if (isAdminHostname(hostname) || hostname === "localhost" || hostname === "127.0.0.1") {
    return normalizedPath;
  }

  return `${protocol}//${ADMIN_HOSTNAME}${port ? `:${port}` : ""}${normalizedPath}`;
};

/** Points marketing/public-site links (e.g. header nav) at the main site while on the admin subdomain. */
export const getMainSiteUrl = (path = "/") => {
  if (typeof window === "undefined") return path;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const { protocol, hostname, port } = window.location;

  if (!isAdminHostname(hostname)) {
    return normalizedPath;
  }

  return `${protocol}//${MAIN_HOSTNAME}${port ? `:${port}` : ""}${normalizedPath}`;
};

export const getLoginUrl = (path = "/login") => {
  if (typeof window === "undefined") return path;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const { protocol, hostname, port } = window.location;

  if (isLoginHostname(hostname) || hostname === "localhost" || hostname === "127.0.0.1") {
    return normalizedPath;
  }

  return `${protocol}//${LOGIN_HOSTNAME}${port ? `:${port}` : ""}${normalizedPath}`;
};
