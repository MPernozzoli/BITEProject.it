const LOGIN_HOSTNAME = "login.biteproject.it";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const getLoginOrigin = () => {
  const configured = import.meta.env.VITE_LOGIN_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (LOCAL_HOSTNAMES.has(window.location.hostname)) return "http://127.0.0.1:5173";
  return `${window.location.protocol}//${LOGIN_HOSTNAME}`;
};

export const getLoginUrl = (redirectTo = window.location.href, mode: "login" | "signup" = "login") => {
  const path = mode === "signup" ? "/signup" : "/login";
  const encodedRedirect = encodeURIComponent(redirectTo);
  return `${getLoginOrigin()}${path}?redirect=${encodedRedirect}`;
};

export const redirectToLogin = (redirectTo = window.location.href) => {
  window.location.href = getLoginUrl(redirectTo, "login");
};
