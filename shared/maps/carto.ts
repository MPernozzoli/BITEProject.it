/**
 * Basemap raster CARTO, condivisa da `apps/web` e `apps/data`.
 *
 * Da agosto 2026 CARTO richiede una API key sulle tile raster: senza il parametro
 * `key` il CDN continua a servire le tile, ma con il watermark "API key required"
 * stampato sopra. La chiave è pubblica per natura — viaggia in ogni richiesta tile
 * fatta dal browser — ma resta fuori dai sorgenti (repo pubblico) e sta in `.env` /
 * env Vercel come `VITE_CARTO_API_KEY`, così si ruota senza toccare il codice.
 */

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

const CARTO_TILE_SUBDOMAINS = ["a", "b", "c", "d"];

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const readCartoApiKey = () => {
  const raw = import.meta.env?.VITE_CARTO_API_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";

  if (!key && import.meta.env?.DEV) {
    console.warn(
      "[carto] VITE_CARTO_API_KEY assente: le tile vengono servite con il watermark \"API key required\"."
    );
  }

  return key;
};

/** Vuota se la variabile non è configurata: le mappe restano navigabili, con watermark. */
export const CARTO_API_KEY = readCartoApiKey();

const isSlowConnection = () => {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as NavigatorWithConnection).connection;
  return Boolean(connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g");
};

const shouldUseRetinaTiles = () => {
  if (typeof window === "undefined") return false;
  return window.devicePixelRatio > 1.25 && !isSlowConnection();
};

export const cartoRasterTileUrl = (subdomain: string, retina: boolean) => {
  const url = `https://${subdomain}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}${retina ? "@2x" : ""}.png`;
  return CARTO_API_KEY ? `${url}?key=${encodeURIComponent(CARTO_API_KEY)}` : url;
};

/**
 * Stile MapLibre minimo con la sola base raster CARTO light.
 * Unico punto in cui viene composta la URL delle tile: la key non va duplicata altrove.
 */
export const createCartoRasterStyle = () => {
  const retina = shouldUseRetinaTiles();

  return {
    version: 8 as const,
    sources: {
      carto: {
        type: "raster" as const,
        tiles: CARTO_TILE_SUBDOMAINS.map((subdomain) => cartoRasterTileUrl(subdomain, retina)),
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [{ id: "carto", type: "raster" as const, source: "carto", minzoom: 0, maxzoom: 20 }],
  };
};
