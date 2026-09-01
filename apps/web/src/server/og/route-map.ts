/**
 * Compone l'immagine di anteprima di una rotta: base raster CARTO + la
 * polilinea del viaggio + i marker di partenza e arrivo.
 *
 * È la versione server della mappa che il sito disegna con MapLibre
 * (`components/voyage/VoyageMap.tsx`): stessi colori per tipo/stato del
 * viaggio, stessa base `light_all`. Qui però non c'è WebGL, quindi le tile
 * vengono scaricate e incollate a mano in un buffer RGBA.
 */
import {
  blit,
  createImage,
  downsample,
  drawText,
  fillCircle,
  fillRect,
  strokePolyline,
  textWidth,
  type Rgba,
} from "./raster.js";
import { decodePng, type RgbaImage } from "./png.js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const TILE_SIZE = 256;
const TILE_SUBDOMAINS = ["a", "b", "c", "d"];
const TILE_TIMEOUT_MS = 4000;
const TILE_CONCURRENCY = 8;
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;
/** Margine interno: tiene la rotta lontana dai bordi e dall'attribuzione. */
const PADDING_X = 70;
const PADDING_Y = 58;

/** Acqua della base CARTO light: riempie i buchi se una tile non arriva. */
const BACKGROUND: Rgba = [229, 237, 243, 255];
const ATTRIBUTION_TEXT = "© OPENSTREETMAP · CARTO";

export type VoyageType = "water" | "land";
export type VoyageStatus = "planned" | "active" | "completed" | string;

/** [lng, lat] come in `cached_geometry.coordinates` e nel resto del codebase. */
export type Coordinate = [number, number];

const hsl = (h: number, s: number, l: number, alpha = 255): Rgba => {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), alpha];
};

/** Stessi colori di `getVoyageStrokeColor` in VoyageMap.tsx. */
export const routeColor = (type: VoyageType, status: VoyageStatus): Rgba => {
  if (type === "water") {
    if (status === "completed") return hsl(208, 48, 34);
    if (status === "planned") return hsl(205, 60, 68);
    return hsl(206, 72, 47);
  }
  if (status === "completed") return hsl(28, 54, 36);
  if (status === "planned") return hsl(31, 72, 70);
  return hsl(30, 78, 50);
};

// --- Proiezione Web Mercator (unità: pixel a zoom 0, tile da 256) ----------

const lngToWorldX = (lng: number) => ((lng + 180) / 360) * TILE_SIZE;

const latToWorldY = (lat: number) => {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE;
};

export const isValidCoordinate = (value: unknown): value is Coordinate =>
  Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(value[0])
  && Number.isFinite(value[1])
  && Math.abs(Number(value[1])) <= 90
  && Math.abs(Number(value[0])) <= 180;

/**
 * Inquadratura che fa entrare la rotta nell'area utile.
 *
 * `scale` è la scala **esatta** che riempie il riquadro, non la potenza di due
 * più vicina: arrotondando allo zoom intero la rotta finiva persa in mezzo alla
 * mappa, con fino al doppio di aria attorno. Le tile però esistono solo a zoom
 * interi, quindi si scarica il primo zoom più fitto del necessario (`tileZoom`)
 * e lo si riduce di `supersample` in fase di composizione — che come effetto
 * collaterale rende più nitide anche le etichette del basemap.
 */
export const fitView = (coordinates: Coordinate[], width: number, height: number) => {
  // Niente Math.min(...array): una geometria stradale può avere decine di
  // migliaia di vertici e lo spread esploderebbe lo stack.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lng, lat] of coordinates) {
    const x = lngToWorldX(lng);
    const y = latToWorldY(lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const innerWidth = Math.max(1, width - PADDING_X * 2);
  const innerHeight = Math.max(1, height - PADDING_Y * 2);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const fitScale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const tileZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.ceil(Math.log2(fitScale))));
  const tileScale = 2 ** tileZoom;
  // Fuori da [0.5, 1] il canvas intermedio esploderebbe (o andrebbe ingrandito,
  // sfocando): capita solo oltre i limiti di zoom delle tile.
  const supersample = Math.min(1, Math.max(0.5, fitScale / tileScale));
  const scale = tileScale * supersample;

  return {
    tileZoom,
    supersample,
    scale,
    // Origine dell'immagine in pixel del mondo alla scala finale.
    originX: ((minX + maxX) / 2) * scale - width / 2,
    originY: ((minY + maxY) / 2) * scale - height / 2,
  };
};

const cartoTileUrl = (z: number, x: number, y: number, index: number, retina: boolean) => {
  const key = (process.env.CARTO_API_KEY || process.env.VITE_CARTO_API_KEY || "").trim();
  const subdomain = TILE_SUBDOMAINS[index % TILE_SUBDOMAINS.length];
  const base = `https://${subdomain}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}${retina ? "@2x" : ""}.png`;
  return key ? `${base}?key=${encodeURIComponent(key)}` : base;
};

const fetchTile = async (url: string): Promise<RgbaImage | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "BITE-Logbook/1.0 (+https://biteproject.it)" },
    });
    if (!response.ok) return null;
    return decodePng(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // Tile mancante o PNG non gestito: resta lo sfondo, la rotta si vede lo stesso.
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

/** Scarica le tile a piccoli gruppi: niente burst da 30 richieste sul CDN. */
const mapWithConcurrency = async <T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Riempie `image` di tile.
 *
 * `retina` non serve a "più dettaglio": chiede lo zoom precedente in versione
 * @2x, che copre lo stesso terreno con 512 px e le etichette disegnate al
 * doppio. Serve quando l'immagine verrà rimpicciolita, altrimenti i nomi dei
 * luoghi si riducono fino a sparire — ed è metà del senso di una mappa
 * condivisa.
 */
const drawBasemap = async (image: RgbaImage, zoom: number, originX: number, originY: number, retina: boolean) => {
  const tileZoom = retina ? zoom - 1 : zoom;
  const tileSize = retina ? TILE_SIZE * 2 : TILE_SIZE;
  const tilesPerAxis = 2 ** tileZoom;
  const firstX = Math.floor(originX / tileSize);
  const lastX = Math.floor((originX + image.width) / tileSize);
  const firstY = Math.floor(originY / tileSize);
  const lastY = Math.floor((originY + image.height) / tileSize);

  const requests: Array<{ tileX: number; tileY: number; drawX: number; drawY: number }> = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= tilesPerAxis) continue; // fuori dai poli
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      requests.push({
        // Il mondo si ripete in longitudine: l'antimeridiano non lascia buchi.
        tileX: ((tileX % tilesPerAxis) + tilesPerAxis) % tilesPerAxis,
        tileY,
        drawX: Math.round(tileX * tileSize - originX),
        drawY: Math.round(tileY * tileSize - originY),
      });
    }
  }

  const tiles = await mapWithConcurrency(requests, TILE_CONCURRENCY, (request) =>
    fetchTile(cartoTileUrl(tileZoom, request.tileX, request.tileY, request.tileX + request.tileY, retina)),
  );

  tiles.forEach((tile, index) => {
    if (tile) blit(image, tile, requests[index].drawX, requests[index].drawY);
  });
};

const drawAttribution = (image: RgbaImage) => {
  const scale = 2;
  const width = textWidth(ATTRIBUTION_TEXT, scale);
  const paddingX = 8;
  const paddingY = 6;
  const boxWidth = width + paddingX * 2;
  const boxHeight = 7 * scale + paddingY * 2;
  const boxX = image.width - boxWidth;
  const boxY = image.height - boxHeight;
  fillRect(image, boxX, boxY, boxWidth, boxHeight, [255, 255, 255, 200]);
  drawText(image, ATTRIBUTION_TEXT, boxX + paddingX, boxY + paddingY, scale, [90, 100, 110, 255]);
};

/** Toglie i vertici che cadrebbero sullo stesso pixel: la polilinea resta identica ma molto più corta. */
const simplify = (points: Array<[number, number]>, minDistance = 0.75) => {
  const result: Array<[number, number]> = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || Math.abs(point[0] - previous[0]) + Math.abs(point[1] - previous[1]) >= minDistance) {
      result.push(point);
    }
  }
  if (result.length < 2 && points.length >= 2) return [points[0], points[points.length - 1]];
  if (points.length >= 2) {
    const last = points[points.length - 1];
    const tail = result[result.length - 1];
    if (tail[0] !== last[0] || tail[1] !== last[1]) result.push(last);
  }
  return result;
};

export interface RouteMapOptions {
  /** Geometria della rotta ([lng, lat]); se ce n'è una sola si disegna solo il marker. */
  coordinates: Coordinate[];
  /** Tappe da marcare sopra la linea (di norma i waypoint pubblici). */
  stops?: Coordinate[];
  type: VoyageType;
  status: VoyageStatus;
  width?: number;
  height?: number;
}

/** Ritorna l'immagine RGBA pronta da codificare in PNG. */
export const renderRouteMap = async (options: RouteMapOptions): Promise<RgbaImage> => {
  const width = options.width ?? OG_WIDTH;
  const height = options.height ?? OG_HEIGHT;
  const coordinates = options.coordinates.filter(isValidCoordinate);
  const image = createImage(width, height, BACKGROUND);
  if (!coordinates.length) return image;

  const { tileZoom, supersample, scale, originX, originY } = fitView(coordinates, width, height);

  if (supersample < 1) {
    // Basemap composto alla risoluzione nativa delle tile e poi ridotto: stessa
    // inquadratura, ma senza tile stirate.
    const oversized = createImage(
      Math.ceil(width / supersample),
      Math.ceil(height / supersample),
      BACKGROUND,
    );
    await drawBasemap(
      oversized,
      tileZoom,
      originX / supersample,
      originY / supersample,
      tileZoom - 1 >= MIN_ZOOM,
    );
    blit(image, downsample(oversized, width, height), 0, 0);
  } else {
    await drawBasemap(image, tileZoom, originX, originY, false);
  }

  const project = ([lng, lat]: Coordinate): [number, number] => [
    lngToWorldX(lng) * scale - originX,
    latToWorldY(lat) * scale - originY,
  ];

  const points = simplify(coordinates.map(project));
  const color = routeColor(options.type, options.status);
  const casing: Rgba = [255, 255, 255, 235];

  if (points.length >= 2) {
    strokePolyline(image, points, 11, casing);
    strokePolyline(image, points, 6, color);
  }

  const stops = (options.stops ?? []).filter(isValidCoordinate).map(project);
  for (const [x, y] of stops) {
    fillCircle(image, x, y, 6, [255, 255, 255, 255]);
    fillCircle(image, x, y, 3.6, color);
  }

  const endpoints = points.length >= 2 ? [points[0], points[points.length - 1]] : [project(coordinates[0])];
  endpoints.forEach(([x, y], index) => {
    fillCircle(image, x, y, 13, [255, 255, 255, 255]);
    fillCircle(image, x, y, 10, color);
    // L'arrivo è un anello, la partenza un disco pieno: il verso della rotta si
    // legge anche senza etichette.
    if (index === 1) fillCircle(image, x, y, 4.5, [255, 255, 255, 255]);
  });

  drawAttribution(image);
  return image;
};
