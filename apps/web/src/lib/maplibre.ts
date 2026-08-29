import maplibregl from "maplibre-gl";

// Base raster CARTO (URL delle tile + API key) condivisa con `apps/data`.
export { CARTO_ATTRIBUTION, createCartoRasterStyle } from "@shared/maps/carto";

const RESIZE_RETRY_DELAYS_MS = [0, 120, 480];

export const isMapLibreSupported = () =>
{
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    if ((maplibregl as any).supported({
      failIfMajorPerformanceCaveat: false,
    })) {
      return true;
    }
  } catch {
    // Fall through to a less strict WebGL capability check.
  }

  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false })
      || canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false })
      || canvas.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false });

    return Boolean(context);
  } catch {
    return false;
  }
};

export const requestMapResize = (map: maplibregl.Map) => {
  if (typeof window === "undefined") return () => undefined;

  const timeouts = RESIZE_RETRY_DELAYS_MS.map((delay) =>
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        try {
          map.resize();
        } catch {
          // Map may already be destroyed.
        }
      });
    }, delay)
  );

  return () => {
    timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
  };
};

export const bindMapToContainerResize = (map: maplibregl.Map, container: HTMLElement) => {
  const cleanupResize = requestMapResize(map);
  const cleanupCallbacks: Array<() => void> = [cleanupResize];

  if (typeof window !== "undefined") {
    const handleWindowResize = () => {
      requestMapResize(map);
    };

    ["resize", "orientationchange", "pageshow", "load"].forEach((eventName) => {
      window.addEventListener(eventName, handleWindowResize);
    });

    cleanupCallbacks.push(() => {
      ["resize", "orientationchange", "pageshow", "load"].forEach((eventName) => {
        window.removeEventListener(eventName, handleWindowResize);
      });
    });
  }

  if (typeof document !== "undefined") {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestMapResize(map);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    cleanupCallbacks.push(() => document.removeEventListener("visibilitychange", handleVisibilityChange));
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        requestMapResize(map);
      }
    });

    observer.observe(container);
    cleanupCallbacks.push(() => observer.disconnect());
  }

  return () => {
    cleanupCallbacks.forEach((callback) => callback());
  };
};
