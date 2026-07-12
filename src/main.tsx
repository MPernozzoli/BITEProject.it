import { createRoot } from "react-dom/client";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";
import { HERO_READY_EVENT } from "./lib/hero-ready-event";

function hideBootSplash() {
  const splash = document.getElementById("bite-boot-splash");
  if (!splash) return;
  if (splash.classList.contains("is-hiding")) return;
  splash.classList.add("is-hiding");
  window.setTimeout(() => splash.remove(), 600);
}

// The Vercel SPA rewrite serves this same document for every route, so on a
// hard load of a non-home page there is no hero video to wait for at all —
// only the home route ("/", "/it", "/en") renders the hero background.
function isHomeRoute(pathname: string): boolean {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  return segments.length === 0 || (segments.length === 1 && (segments[0] === "it" || segments[0] === "en"));
}

async function bootstrap() {
  // Progressive enhancement: upgrade the static boot splash to a 3D scene once the
  // three.js chunk arrives. Fire-and-forget so it never delays the app import below.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    void import("./lib/boot-splash-3d")
      .then((mod) => mod.mountBootSplash3D())
      .catch(() => {});
  }

  const onHomeRoute = isHomeRoute(window.location.pathname);
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    window.clearTimeout(safetyTimer);
    window.removeEventListener(HERO_READY_EVENT, dismiss);
    hideBootSplash();
  };

  if (onHomeRoute) {
    // Wait for the home page to report its hero video/image actually painted.
    window.addEventListener(HERO_READY_EVENT, dismiss, { once: true });
  } else {
    // Non-home routes have no hero to wait for — dismiss as soon as the app has painted.
    window.addEventListener("load", () => window.setTimeout(dismiss, 200), { once: true });
  }

  // Safety net: never let the splash stay forever, even on errors, slow chunks, or a hero fetch that never resolves.
  const safetyTimer = window.setTimeout(dismiss, onHomeRoute ? 6000 : 2500);

  try {
    const { default: App } = await import("./App.tsx");
    createRoot(document.getElementById("root")!).render(<App />);
  } finally {
    if (!onHomeRoute) {
      requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(dismiss, 200)));
    }
    // Service worker is non-critical for first paint — register after mount.
    void registerServiceWorker();
  }
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
    import("./lib/spritz-sail-game")
      .then((mod) => mod.mountSpritzSailGame(() => (launching = false)))
      .catch(() => (launching = false));
  });
}

void bootstrap();
initSpritzEasterEgg();
