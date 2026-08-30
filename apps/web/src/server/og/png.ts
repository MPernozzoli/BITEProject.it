/**
 * Decodifica e codifica PNG minimali, senza dipendenze native.
 *
 * Servono per comporre l'immagine Open Graph delle rotte (`/api/og/voyage`):
 * le tile CARTO arrivano come PNG a palette, vanno unite in un unico canvas
 * RGBA e restituite come PNG. `sharp`/`canvas` non sono installabili sul
 * runtime serverless senza binari, mentre `node:zlib` c'è già.
 *
 * Copertura volutamente parziale, quanto basta per le tile raster e per il
 * nostro output: PNG non interlacciati, bit depth 8 (più i bit depth ridotti
 * dei PNG a palette). Un PNG interlacciato o a 16 bit fa lanciare un errore,
 * che il chiamante tratta come "tile mancante".
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 byte per pixel, riga per riga dall'alto. */
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS_PER_COLOR_TYPE: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // rgb
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // rgba
};

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/** Rimuove i filtri per riga previsti dalla spec PNG (filtri 0-4). */
const unfilter = (raw: Uint8Array, width: number, height: number, bytesPerPixel: number, bytesPerRow: number) => {
  const out = new Uint8Array(height * bytesPerRow);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * bytesPerRow;
    const prevStart = rowStart - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x += 1) {
      const value = raw[rawOffset + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`png: filtro di riga non supportato (${filter})`);
      }
      out[rowStart + x] = restored & 0xff;
    }
    rawOffset += bytesPerRow;
  }
  return out;
};

/** Legge il campione `index` di una riga con bit depth < 8. */
const readPackedSample = (row: Uint8Array, index: number, bitDepth: number) => {
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
};

export function decodePng(buffer: Uint8Array): RgbaImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error("png: firma non valida");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(buffer[offset + 4], buffer[offset + 5], buffer[offset + 6], buffer[offset + 7]);
    const dataStart = offset + 8;

    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      const interlace = buffer[dataStart + 12];
      if (interlace !== 0) throw new Error("png: interlacciato non supportato");
      if (bitDepth === 16) throw new Error("png: bit depth 16 non supportato");
      if (!(colorType in CHANNELS_PER_COLOR_TYPE)) throw new Error(`png: color type ${colorType} non supportato`);
    } else if (type === "PLTE") {
      palette = buffer.subarray(dataStart, dataStart + length);
    } else if (type === "tRNS") {
      paletteAlpha = buffer.subarray(dataStart, dataStart + length);
    } else if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // + CRC
  }

  if (!width || !height || !idatChunks.length) throw new Error("png: dati mancanti");

  const compressed = idatChunks.length === 1 ? idatChunks[0] : Buffer.concat(idatChunks.map((c) => Buffer.from(c)));
  const raw = new Uint8Array(inflateSync(Buffer.from(compressed)));

  const channels = CHANNELS_PER_COLOR_TYPE[colorType];
  const bitsPerPixel = channels * bitDepth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const bytesPerRow = Math.ceil((bitsPerPixel * width) / 8);
  const pixels = unfilter(raw, width, height, bytesPerPixel, bytesPerRow);

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * bytesPerRow, (y + 1) * bytesPerRow);
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      if (colorType === 3) {
        const index = bitDepth === 8 ? row[x] : readPackedSample(row, x, bitDepth);
        if (!palette) throw new Error("png: palette mancante");
        data[out] = palette[index * 3];
        data[out + 1] = palette[index * 3 + 1];
        data[out + 2] = palette[index * 3 + 2];
        data[out + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const grayIndex = colorType === 0 ? x : x * 2;
        const gray = bitDepth === 8 ? row[grayIndex] : (readPackedSample(row, x, bitDepth) * 255) / ((1 << bitDepth) - 1);
        data[out] = gray;
        data[out + 1] = gray;
        data[out + 2] = gray;
        data[out + 3] = colorType === 4 ? row[x * 2 + 1] : 255;
      } else {
        const base = x * channels;
        data[out] = row[base];
        data[out + 1] = row[base + 1];
        data[out + 2] = row[base + 2];
        data[out + 3] = colorType === 6 ? row[base + 3] : 255;
      }
    }
  }

  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Codifica RGBA a 8 bit, filtro Paeth su ogni riga (buono sulle tinte piatte delle mappe). */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  const bytesPerRow = width * 4;
  const raw = Buffer.alloc((bytesPerRow + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    const outStart = y * (bytesPerRow + 1);
    raw[outStart] = 4; // Paeth
    for (let x = 0; x < bytesPerRow; x += 1) {
      const value = data[rowStart + x];
      const left = x >= 4 ? data[rowStart + x - 4] : 0;
      const up = y > 0 ? data[rowStart - bytesPerRow + x] : 0;
      const upLeft = y > 0 && x >= 4 ? data[rowStart - bytesPerRow + x - 4] : 0;
      raw[outStart + 1 + x] = (value - paeth(left, up, upLeft)) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Codifica a palette (fino a 256 colori), con median cut se l'immagine ne ha di più.
 *
 * Una mappa è fatta di tinte piatte più le sfumature di antialiasing: in RGBA
 * pesa 300-600 KB, a palette 120-250 KB. Conta perché l'anteprima di WhatsApp
 * salta le immagini troppo grandi — e l'anteprima è tutto il senso di questo
 * PNG. Le tile CARTO originali sono a palette per lo stesso motivo.
 */
export function encodeIndexedPng(image: RgbaImage): Buffer {
  const { width, height, data } = image;

  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Oltre i 16 bit di colori distinti la quantizzazione costa più di quanto rende.
  if (counts.size > 65536) return encodePng(image);

  const unique = Array.from(counts, ([key, count]) => ({
    r: (key >> 16) & 0xff,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
    count,
  }));

  // Median cut: si divide sempre il bucket con l'estensione cromatica maggiore.
  let buckets = [unique];
  while (buckets.length < 256) {
    let target = -1;
    let widest = 0;
    let channel: "r" | "g" | "b" = "r";
    buckets.forEach((bucket, index) => {
      if (bucket.length < 2) return;
      for (const key of ["r", "g", "b"] as const) {
        let min = 255;
        let max = 0;
        for (const color of bucket) {
          if (color[key] < min) min = color[key];
          if (color[key] > max) max = color[key];
        }
        if (max - min > widest) {
          widest = max - min;
          target = index;
          channel = key;
        }
      }
    });
    if (target < 0 || widest === 0) break;

    const bucket = buckets[target].slice().sort((a, b) => a[channel] - b[channel]);
    const total = bucket.reduce((sum, color) => sum + color.count, 0);
    let running = 0;
    let split = 1;
    for (let i = 0; i < bucket.length - 1; i += 1) {
      running += bucket[i].count;
      if (running >= total / 2) {
        split = i + 1;
        break;
      }
    }
    buckets = [...buckets.slice(0, target), bucket.slice(0, split), bucket.slice(split), ...buckets.slice(target + 1)];
  }

  const palette = buckets.map((bucket) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (const color of bucket) {
      r += color.r * color.count;
      g += color.g * color.count;
      b += color.b * color.count;
      total += color.count;
    }
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
  });

  const indexByColor = new Map<number, number>();
  buckets.forEach((bucket, index) => {
    for (const color of bucket) indexByColor.set((color.r << 16) | (color.g << 8) | color.b, index);
  });

  const bytesPerRow = width;
  const raw = Buffer.alloc((bytesPerRow + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const outStart = y * (bytesPerRow + 1); // filtro 0: sugli indici i filtri peggiorano la compressione
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const key = (data[source] << 16) | (data[source + 1] << 8) | data[source + 2];
      raw[outStart + 1 + x] = indexByColor.get(key) ?? 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // palette

  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((color, index) => {
    plte[index * 3] = color[0];
    plte[index * 3 + 1] = color[1];
    plte[index * 3 + 2] = color[2];
  });

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
