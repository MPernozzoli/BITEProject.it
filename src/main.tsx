import { createRoot } from "react-dom/client";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";

function hideBootSplash() {
  const splash = document.getElementById("bite-boot-splash");
  if (!splash) return;
  if (splash.classList.contains("is-hiding")) return;
  splash.classList.add("is-hiding");
  window.setTimeout(() => splash.remove(), 600);
}

async function bootstrap() {
  // Safety nets: never let the splash stay forever, even on errors or slow chunks.
  const safetyTimer = window.setTimeout(hideBootSplash, 6000);
  window.addEventListener("load", () => window.setTimeout(hideBootSplash, 400), { once: true });

  try {
    const { default: App } = await import("./App.tsx");
    createRoot(document.getElementById("root")!).render(<App />);
  } finally {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.clearTimeout(safetyTimer);
      hideBootSplash();
    }));
    // Service worker is non-critical for first paint — register after mount.
    void registerServiceWorker();
  }
}

void bootstrap();
