/**
 * Disegno raster minimale sopra un buffer RGBA: quel che serve per stampare
 * una rotta e i suoi marker sulla base cartografica dell'immagine Open Graph.
 *
 * Niente canvas né dipendenze grafiche: cerchi e linee sono antialiasati a
 * mano campionando la copertura del pixel, il testo usa il font bitmap 5x7 di
 * `font.ts` (serve solo per l'attribuzione OSM/CARTO).
 */
import { getGlyph, GLYPH_HEIGHT, GLYPH_WIDTH } from "./font.js";
import type { RgbaImage } from "./png.js";

export type Rgba = [number, number, number, number];

export const createImage = (width: number, height: number, background: Rgba): RgbaImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = background[3];
  }
  return { width, height, data };
};

/** Alpha blending "source over" su un pixel opaco. */
export const blendPixel = (image: RgbaImage, x: number, y: number, color: Rgba, coverage = 1) => {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const alpha = (color[3] / 255) * coverage;
  if (alpha <= 0) return;
  const offset = (y * image.width + x) * 4;
  const data = image.data;
  data[offset] = Math.round(data[offset] * (1 - alpha) + color[0] * alpha);
  data[offset + 1] = Math.round(data[offset + 1] * (1 - alpha) + color[1] * alpha);
  data[offset + 2] = Math.round(data[offset + 2] * (1 - alpha) + color[2] * alpha);
  data[offset + 3] = 255;
};

/** Copia `tile` dentro `image` all'offset indicato, ritagliando i bordi. */
export const blit = (image: RgbaImage, tile: RgbaImage, offsetX: number, offsetY: number) => {
  const startX = Math.max(0, -offsetX);
  const startY = Math.max(0, -offsetY);
  const endX = Math.min(tile.width, image.width - offsetX);
  const endY = Math.min(tile.height, image.height - offsetY);
  for (let y = startY; y < endY; y += 1) {
    const targetRow = (y + offsetY) * image.width;
    const sourceRow = y * tile.width;
    for (let x = startX; x < endX; x += 1) {
      const source = (sourceRow + x) * 4;
      const alpha = tile.data[source + 3];
      if (alpha === 255) {
        const target = (targetRow + x + offsetX) * 4;
        image.data[target] = tile.data[source];
        image.data[target + 1] = tile.data[source + 1];
        image.data[target + 2] = tile.data[source + 2];
        image.data[target + 3] = 255;
      } else if (alpha > 0) {
        blendPixel(image, x + offsetX, y + offsetY, [
          tile.data[source],
          tile.data[source + 1],
          tile.data[source + 2],
          alpha,
        ]);
      }
    }
  }
};

/** Disco pieno con bordo antialiasato (copertura stimata sulla distanza dal centro). */
export const fillCircle = (image: RgbaImage, cx: number, cy: number, radius: number, color: Rgba) => {
  if (radius <= 0) return;
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(image.width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(image.height - 1, Math.ceil(cy + radius + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance));
      if (coverage > 0) blendPixel(image, x, y, color, coverage);
    }
  }
};

/**
 * Polilinea con spessore costante e giunti/estremi tondi: ogni segmento è una
 * capsula (distanza punto-segmento), così le rotte con migliaia di vertici non
 * mostrano scalini nei cambi di direzione.
 */
export const strokePolyline = (
  image: RgbaImage,
  points: Array<[number, number]>,
  width: number,
  color: Rgba,
) => {
  if (points.length === 0) return;
  const radius = width / 2;
  if (points.length === 1) {
    fillCircle(image, points[0][0], points[0][1], radius, color);
    return;
  }

  // Copertura calcolata una volta per pixel: i segmenti si sovrappongono ai
  // giunti e un blending per segmento lascerebbe nodi più scuri.
  const coverage = new Float32Array(image.width * image.height);
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
    const maxX = Math.min(image.width - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
    const maxY = Math.min(image.height - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
    if (minX > maxX || minY > maxY) continue;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        const t = lengthSquared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
        const ox = px - t * dx;
        const oy = py - t * dy;
        const distance = Math.sqrt(ox * ox + oy * oy);
        const value = Math.min(1, Math.max(0, radius + 0.5 - distance));
        const index = y * image.width + x;
        if (value > coverage[index]) coverage[index] = value;
      }
    }
  }

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const value = coverage[y * image.width + x];
      if (value > 0) blendPixel(image, x, y, color, value);
    }
  }
};

/**
 * Riduzione con media d'area (non un semplice campionamento): il basemap arriva
 * da tile a zoom più fitto del necessario e le etichette devono restare
 * leggibili invece che sgranarsi.
 */
export const downsample = (source: RgbaImage, width: number, height: number): RgbaImage => {
  if (source.width === width && source.height === height) return source;

  const out = createImage(width, height, [255, 255, 255, 255]);
  const ratioX = source.width / width;
  const ratioY = source.height / height;

  for (let y = 0; y < height; y += 1) {
    const top = y * ratioY;
    const bottom = top + ratioY;
    const firstRow = Math.floor(top);
    const lastRow = Math.min(source.height, Math.ceil(bottom));

    for (let x = 0; x < width; x += 1) {
      const left = x * ratioX;
      const right = left + ratioX;
      const firstColumn = Math.floor(left);
      const lastColumn = Math.min(source.width, Math.ceil(right));

      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      for (let sourceY = firstRow; sourceY < lastRow; sourceY += 1) {
        const weightY = Math.min(bottom, sourceY + 1) - Math.max(top, sourceY);
        if (weightY <= 0) continue;
        for (let sourceX = firstColumn; sourceX < lastColumn; sourceX += 1) {
          const weight = weightY * (Math.min(right, sourceX + 1) - Math.max(left, sourceX));
          if (weight <= 0) continue;
          const offset = (sourceY * source.width + sourceX) * 4;
          r += source.data[offset] * weight;
          g += source.data[offset + 1] * weight;
          b += source.data[offset + 2] * weight;
          total += weight;
        }
      }

      const offset = (y * width + x) * 4;
      out.data[offset] = total ? Math.round(r / total) : 255;
      out.data[offset + 1] = total ? Math.round(g / total) : 255;
      out.data[offset + 2] = total ? Math.round(b / total) : 255;
      out.data[offset + 3] = 255;
    }
  }

  return out;
};

export const fillRect = (image: RgbaImage, x: number, y: number, width: number, height: number, color: Rgba) => {
  const maxX = Math.min(image.width, x + width);
  const maxY = Math.min(image.height, y + height);
  for (let py = Math.max(0, y); py < maxY; py += 1) {
    for (let px = Math.max(0, x); px < maxX; px += 1) blendPixel(image, px, py, color);
  }
};

export const textWidth = (text: string, scale: number, letterSpacing = 1) =>
  text.length ? text.length * GLYPH_WIDTH * scale + (text.length - 1) * letterSpacing * scale : 0;

export const textHeight = (scale: number) => GLYPH_HEIGHT * scale;

/** Testo bitmap: usato per l'attribuzione, non per contenuti editoriali. */
export const drawText = (
  image: RgbaImage,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgba,
  letterSpacing = 1,
) => {
  let cursor = x;
  for (const char of text) {
    const glyph = getGlyph(char);
    if (glyph) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          if (glyph[row][column] === "#") {
            fillRect(image, cursor + column * scale, y + row * scale, scale, scale, color);
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + letterSpacing) * scale;
  }
};
