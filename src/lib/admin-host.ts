export const ADMIN_HOSTNAME = "admin.biteproject.it";

export const isAdminHostname = (hostname: string) =>
  hostname === ADMIN_HOSTNAME || hostname.startsWith(`${ADMIN_HOSTNAME}.`);

export const isCurrentAdminHostname = () =>
  typeof window !== "undefined" && isAdminHostname(window.location.hostname);

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
