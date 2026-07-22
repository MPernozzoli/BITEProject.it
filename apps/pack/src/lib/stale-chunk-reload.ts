const RELOAD_GUARD_KEY = "bite-stale-chunk-reload-at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

const CHUNK_LOAD_ERROR_PATTERN =
  /dynamically imported module|importing a module script failed|unable to preload css/i;

/**
 * Vite content-hashes chunk filenames, so a tab left open across a deploy will
 * request a chunk that no longer exists on the CDN. Matches the error messages
 * browsers throw for that (message wording differs per browser/engine).
 */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CHUNK_LOAD_ERROR_PATTERN.test(message);
}

/**
 * Reloads to pick up the current deploy's chunk hashes. Guarded against
 * reload loops: no-ops (returns false) if we already reloaded for this
 * reason within the last few seconds, so a genuinely broken deploy still
 * surfaces the error UI instead of refreshing forever.
 */
export function reloadForStaleChunk(): boolean {
  if (typeof window === "undefined") return false;

  const lastReload = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
  if (Date.now() - lastReload < RELOAD_GUARD_WINDOW_MS) return false;

  window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}
