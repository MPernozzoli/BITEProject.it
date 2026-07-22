import { createRoot } from "react-dom/client";
import "@livekit/components-styles";
import App from "./App.tsx";
import "./index.css";
import { reloadForStaleChunk } from "./lib/stale-chunk-reload";

// A tab left open across a deploy will eventually try to fetch a lazy-loaded
// chunk whose content hash no longer exists on the CDN. Vite dispatches this
// event for that case — reload to pick up the current deploy instead of
// letting the import rejection surface as a render error.
window.addEventListener("vite:preloadError", () => {
  reloadForStaleChunk();
});

createRoot(document.getElementById("root")!).render(<App />);
