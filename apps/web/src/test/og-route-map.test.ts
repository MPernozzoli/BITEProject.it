import { describe, expect, it, vi, afterEach } from "vitest";
import { deflateSync } from "node:zlib";

import { decodePng, encodeIndexedPng, encodePng } from "@/server/og/png";
import { fitView, isValidCoordinate, renderRouteMap, routeColor, type Coordinate } from "@/server/og/route-map";

/** PNG 2x2 a palette, come le tile CARTO light_all. */
const palettePng = () => {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    // CRC non verificato dal decoder: lasciarlo a zero tiene il fixture leggibile.
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // palette
  const plte = Buffer.from([255, 0, 0, 0, 0, 255]);
  const raw = Buffer.from([0, 0, 1, 0, 1, 0]); // filtro 0 + indici per riga
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("png", () => {
  it("fa round-trip su RGBA", () => {
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = i % 255;
      data[i + 1] = 10;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    const decoded = decodePng(encodePng({ width: 4, height: 4, data }));
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });

  it("espande i PNG a palette in RGBA", () => {
    const decoded = decodePng(palettePng());
    expect(decoded.width).toBe(2);
    expect(Array.from(decoded.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(decoded.data.slice(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it("quantizza a palette restando fedele ai colori", () => {
    // Sfumatura continua: più di 256 colori distinti, come l'antialiasing di una rotta.
    const width = 64;
    const height = 64;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = x * 4;
        data[offset + 1] = y * 4;
        data[offset + 2] = 120;
        data[offset + 3] = 255;
      }
    }
    const indexed = encodeIndexedPng({ width, height, data });
    expect(indexed[8 + 8 + 9]).toBe(3); // color type dell'IHDR: palette

    const decoded = decodePng(indexed);
    expect(decoded.width).toBe(width);

    const distinct = new Set<number>();
    for (let i = 0; i < decoded.data.length; i += 4) {
      distinct.add((decoded.data[i] << 16) | (decoded.data[i + 1] << 8) | decoded.data[i + 2]);
    }
    expect(distinct.size).toBeLessThanOrEqual(256);
    let worst = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        worst = Math.max(worst, Math.abs(decoded.data[i + channel] - data[i + channel]));
      }
    }
    expect(worst).toBeLessThan(24);
  });

  it("rifiuta i PNG interlacciati invece di produrre pixel a caso", () => {
    const png = palettePng();
    png[8 + 8 + 12] = 1; // campo interlace dell'IHDR
    expect(() => decodePng(png)).toThrow(/interlacciato/);
  });
});

describe("fitView", () => {
  const route: Coordinate[] = [
    [9.18, 45.46],
    [12.33, 45.43],
  ];

  it("sceglie uno zoom che tiene la rotta dentro l'area utile", () => {
    const { zoom, scale, originX, originY } = fitView(route, 1200, 630);
    const project = ([lng, lat]: Coordinate): [number, number] => {
      const x = ((lng + 180) / 360) * 256 * scale - originX;
      const sin = Math.sin((lat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256 * scale - originY;
      return [x, y];
    };

    expect(zoom).toBeGreaterThanOrEqual(2);
    for (const point of route.map(project)) {
      expect(point[0]).toBeGreaterThan(0);
      expect(point[0]).toBeLessThan(1200);
      expect(point[1]).toBeGreaterThan(0);
      expect(point[1]).toBeLessThan(630);
    }
  });

  it("centra la rotta nell'immagine", () => {
    const { scale, originX } = fitView(route, 1200, 630);
    const centerX = ((route[0][0] + route[1][0]) / 2 + 180) / 360 * 256 * scale - originX;
    expect(centerX).toBeCloseTo(600, 5);
  });
});

describe("renderRouteMap", () => {
  it("disegna la rotta anche se le tile non arrivano", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const image = await renderRouteMap({
      coordinates: [
        [9.18, 45.46],
        [12.33, 45.43],
      ],
      type: "water",
      status: "completed",
      width: 600,
      height: 316,
    });

    expect(image.width).toBe(600);
    expect(image.height).toBe(316);

    const color = routeColor("water", "completed");
    let matches = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (
        Math.abs(image.data[i] - color[0]) < 6
        && Math.abs(image.data[i + 1] - color[1]) < 6
        && Math.abs(image.data[i + 2] - color[2]) < 6
      ) {
        matches += 1;
      }
    }
    expect(matches).toBeGreaterThan(500);
  });

  it("scarta le coordinate non valide invece di deformare la vista", () => {
    expect(isValidCoordinate([9.18, 45.46])).toBe(true);
    expect(isValidCoordinate([9.18, 145.46])).toBe(false);
    expect(isValidCoordinate([null, 45.46])).toBe(false);
    expect(isValidCoordinate([9.18])).toBe(false);
  });
});
