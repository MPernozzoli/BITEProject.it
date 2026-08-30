import { createRoot } from "react-dom/client";
import "./index.css";
import { captureAttribution } from "./lib/attribution";
import { registerServiceWorker } from "./lib/pwa";
import { reloadForStaleChunk } from "./lib/stale-chunk-reload";

// I tracker di sorgente (utm_*, fbclid, referrer) vivono nell'URL solo fino al
// primo click interno: si leggono qui, prima che React monti e che il router
// riscriva l'indirizzo, e restano disponibili per tutta la sessione.
captureAttribution();

// A tab left open across a deploy will eventually try to fetch a lazy-loaded
// chunk whose content hash no longer exists on the CDN. Vite dispatches this
// event for that case — reload to pick up the current deploy instead of
// letting the import rejection surface as a render error.
window.addEventListener("vite:preloadError", () => {
  reloadForStaleChunk();
});

async function bootstrap() {
  const { default: App } = await import("./App.tsx");
  createRoot(document.getElementById("root")!).render(<App />);

  // Service worker is non-critical for first paint — register after mount.
  void registerServiceWorker();
}

// Easter egg: typing "spritz" anywhere on the site (outside form fields) sets
// sail on S/Y Spritz — the boot-splash boat, playable. Lazy-loaded on trigger.
function initSpritzEasterEgg() {
  let buffer = "";
  let launching = false;
  window.addEventListener("keydown", (event) => {
    if (launching || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key.length !== 1) return;
    buffer = (buffer + event.key.toLowerCase()).slice(-6);
    if (buffer !== "spritz") return;
    buffer = "";
    launching = true;
    void import("./lib/spritz-discovery").then((mod) => mod.recordSpritzDiscovery());
    import("./lib/spritz-sail-game")
      .then((mod) => mod.mountSpritzSailGame(() => (launching = false)))
      .catch(() => (launching = false));
  });
}

void bootstrap();
initSpritzEasterEgg();
