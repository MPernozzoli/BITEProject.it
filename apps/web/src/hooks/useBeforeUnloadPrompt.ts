import { useEffect } from "react";
import { isLikelyMobileDevice, isRunningAsInstalledApp } from "@/lib/pwa";

/**
 * Adds a native close/reload prompt only where it does not interfere with
 * mobile/PWA page restoration after the app has been backgrounded.
 */
export function useBeforeUnloadPrompt(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (isLikelyMobileDevice() || isRunningAsInstalledApp()) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);
}
