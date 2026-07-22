import { Component, type ErrorInfo, type ReactNode } from "react";
import { isStaleChunkError, reloadForStaleChunk } from "@/lib/stale-chunk-reload";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AppErrorBoundary]", error, info.componentStack);

    // Belt-and-suspenders alongside the `vite:preloadError` listener in
    // main.tsx: some chunk-load failures reach the boundary directly rather
    // than going through Vite's preload event. Auto-reload once; if that was
    // just tried, fall through to the manual "Ricarica" UI below.
    if (isStaleChunkError(error)) {
      reloadForStaleChunk();
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-sans text-muted-foreground max-w-md">
            Qualcosa è andato storto nel caricamento della pagina. Prova a ricaricare; se il problema resta, svuota la cache del sito o
            l&apos;archivio locale per questo dominio (a volte i dati salvati nel browser sono corrotti).
          </p>
          <button
            type="button"
            className="rounded-full border border-border bg-background px-4 py-2 text-sm font-sans hover:bg-muted/80 transition-colors"
            onClick={() => window.location.reload()}
          >
            Ricarica
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
