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

void bootstrap();
