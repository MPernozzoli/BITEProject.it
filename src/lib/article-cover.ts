import type { CSSProperties } from "react";

/** Valori salvati su logbook_articles per il ritaglio copertina */
export type CoverFocal = {
  focalX: number;
  focalY: number;
  zoom: number;
};

export const DEFAULT_COVER_FOCAL: CoverFocal = { focalX: 50, focalY: 50, zoom: 1 };

export function clampCoverFocal(x: number, y: number, z: number): CoverFocal {
  return {
    focalX: Math.min(100, Math.max(0, x)),
    focalY: Math.min(100, Math.max(0, y)),
    zoom: Math.min(2.5, Math.max(1, z)),
  };
}

export function coverImageStyle(url: string | null | undefined, focal: CoverFocal): NonNullable<CSSProperties> | undefined {
  if (!url) return undefined;
  const { focalX, focalY, zoom } = clampCoverFocal(focal.focalX, focal.focalY, focal.zoom);
  return {
    objectFit: "cover",
    objectPosition: `${focalX}% ${focalY}%`,
    transform: zoom > 1 ? `scale(${zoom})` : undefined,
    transformOrigin: `${focalX}% ${focalY}%`,
    width: "100%",
    height: "100%",
  };
}
