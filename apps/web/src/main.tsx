import { createRoot } from "react-dom/client";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";

async function bootstrap() {
  await registerServiceWorker();

  const { default: App } = await import("./App.tsx");
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
