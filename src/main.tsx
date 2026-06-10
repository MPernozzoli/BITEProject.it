import { createRoot } from "react-dom/client";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";

function hideBootSplash() {
  const splash = document.getElementById("bite-boot-splash");
  if (!splash) return;
  splash.classList.add("is-hiding");
  window.setTimeout(() => splash.remove(), 600);
}

async function bootstrap() {
  await registerServiceWorker();

  const { default: App } = await import("./App.tsx");
  createRoot(document.getElementById("root")!).render(<App />);
  // Give the first paint a tick before fading the splash out.
  requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
}

void bootstrap();
