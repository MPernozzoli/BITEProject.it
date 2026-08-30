import maplibregl from "maplibre-gl";

// Base raster CARTO (URL delle tile + API key) condivisa con `apps/data`.
import {
  CARTO_SOURCE_ID,
  cartoRasterTileUrls,
  createCartoRasterStyle,
  type CartoBasemapVariant,
} from "@shared/maps/carto";

export { CARTO_ATTRIBUTION, createCartoRasterStyle } from "@shared/maps/carto";

/** Il tema risolto, letto dal DOM: qui non c'è React, e la classe è già lì. */
const currentBasemapVariant = (): CartoBasemapVariant =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";

/** Stile CARTO nella variante del tema corrente. Da usare alla creazione della mappa. */
export const createThemedCartoStyle = () => createCartoRasterStyle(currentBasemapVariant());

/**
 * Tiene la basemap allineata al tema mentre la mappa è viva.
 *
 * Scambia le tile della sorgente raster invece di rifare lo stile: `setStyle`
 * ricostruirebbe la mappa da zero e porterebbe via rotte, tappe e layer che
 * ogni componente aggiunge dopo la creazione. Così cambia solo il fondale.
 *
 * Si stacca da sé quando la mappa viene distrutta (MapLibre emette `remove`),
 * così i chiamanti non devono ricordarsene nella pulizia dell'effetto.
 */
export const bindMapToTheme = (map: maplibregl.Map) => {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  let applied = currentBasemapVariant();

  const observer = new MutationObserver(() => {
    const next = currentBasemapVariant();
    if (next === applied) return;
    applied = next;
    try {
      const source = map.getSource(CARTO_SOURCE_ID);
      // Sorgente assente: lo stile è ancora in caricamento, o la mappa è già andata.
      if (source && "setTiles" in source) {
        (source as maplibregl.RasterTileSource).setTiles(cartoRasterTileUrls(next));
      }
    } catch {
      // Mappa distrutta tra un tick e l'altro: non c'è più niente da aggiornare.
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  map.once("remove", () => observer.disconnect());

  return () => observer.disconnect();
};

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
