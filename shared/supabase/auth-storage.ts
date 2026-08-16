/**
 * Storage di sessione Supabase condiviso sul dominio `.biteproject.it`.
 *
 * Unica copia per tutte e quattro le app (`web`, `pack`, `data`, `crew`): prima era
 * duplicata byte per byte in `apps/<app>/src/lib/supabase-auth-storage.ts`, con il
 * rischio che una modifica al formato dei cookie ne aggiornasse solo alcune e
 * spezzasse il single sign-on fra i sottodomini.
 *
 * Importare con `@shared/supabase/auth-storage` (alias definito nel `vite.config.ts`
 * e nel `tsconfig.app.json` di ogni app).
 */

const SHARED_AUTH_COOKIE_DOMAIN = ".biteproject.it";
const SHARED_AUTH_HOST_RE = /(^|\.)biteproject\.it$/i;
const COOKIE_CHUNK_SIZE = 3000;
const MAX_COOKIE_CHUNKS = 20;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type SupabaseStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const canUseDomStorage = () => typeof window !== "undefined" && typeof document !== "undefined";

const getCookieDomain = () => {
  if (!canUseDomStorage()) return "";
  return SHARED_AUTH_HOST_RE.test(window.location.hostname) ? SHARED_AUTH_COOKIE_DOMAIN : "";
};

const getCookieOptions = (maxAgeSeconds: number) => {
  const domain = getCookieDomain();
  const parts = [
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (domain) parts.push(`Domain=${domain}`);
  if (window.location.protocol === "https:") parts.push("Secure");

  return parts.join("; ");
};

const readCookie = (name: string) => {
  if (!canUseDomStorage()) return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith(encodedName));

  if (!cookie) return null;

  return decodeURIComponent(cookie.slice(encodedName.length));
};

const writeCookie = (name: string, value: string, maxAgeSeconds = ONE_YEAR_SECONDS) => {
  if (!canUseDomStorage()) return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${getCookieOptions(maxAgeSeconds)}`;
};

const deleteCookie = (name: string) => {
  if (!canUseDomStorage()) return;
  document.cookie = `${encodeURIComponent(name)}=; ${getCookieOptions(0)}`;
};

export const removeSharedSupabaseAuthItem = (key: string) => {
  deleteCookie(key);
  for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
    deleteCookie(`${key}.${index}`);
  }
  if (!canUseDomStorage()) return;
  window.localStorage.removeItem(key);
};

export const createSharedSupabaseAuthStorage = (): SupabaseStorage => ({
  getItem: (key) => {
    if (!canUseDomStorage()) return null;
    const marker = readCookie(key);

    if (marker?.startsWith("chunked:")) {
      const count = Number.parseInt(marker.slice("chunked:".length), 10);
      if (Number.isFinite(count) && count > 0 && count <= MAX_COOKIE_CHUNKS) {
        const chunks = Array.from({ length: count }, (_, index) => readCookie(`${key}.${index}`));
        if (chunks.every((chunk): chunk is string => typeof chunk === "string")) {
          return chunks.join("");
        }
      }
      return window.localStorage.getItem(key);
    }

    if (marker !== null) return marker;

    const storedValue = window.localStorage.getItem(key);
    if (storedValue !== null) {
      if (storedValue.length <= COOKIE_CHUNK_SIZE) {
        writeCookie(key, storedValue);
      } else {
        const chunks = storedValue.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) || [];
        writeCookie(key, `chunked:${chunks.length}`);
        chunks.slice(0, MAX_COOKIE_CHUNKS).forEach((chunk, index) => {
          writeCookie(`${key}.${index}`, chunk);
        });
      }
    }
    return storedValue;
  },
  setItem: (key, value) => {
    if (!canUseDomStorage()) return;
    removeSharedSupabaseAuthItem(key);

    if (value.length <= COOKIE_CHUNK_SIZE) {
      writeCookie(key, value);
    } else {
      const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) || [];
      writeCookie(key, `chunked:${chunks.length}`);
      chunks.slice(0, MAX_COOKIE_CHUNKS).forEach((chunk, index) => {
        writeCookie(`${key}.${index}`, chunk);
      });
    }

    window.localStorage.setItem(key, value);
  },
  removeItem: removeSharedSupabaseAuthItem,
});
