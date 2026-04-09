import { Fragment, useMemo } from "react";
import { X, Ship, Mountain } from "lucide-react";
import {
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  getWaypointSequenceHeading,
  haversineNM,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";
import type { Language } from "@/lib/i18n";

interface VoyageLegendProps {
  voyage: Voyage;
  waypoints: VoyageWaypoint[];
  articles: Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[];
  lang: Language;
  onClose: () => void;
  onWaypointClick?: (waypoint: VoyageWaypoint) => void;
}

const formatDate = (dateStr: string | null, lang: Language): string | null => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
};

const formatDistance = (nm: number, isWater: boolean): string => {
  if (isWater) {
    if (nm < 0.5) return `${Math.round(nm * 1852)} m`;
    return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} NM`;
  }
  const km = nm * 1.852;
  if (km < 0.5) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
};

const STEM_H = 14;

const VoyageLegend = ({
  voyage,
  waypoints,
  articles,
  lang,
  onClose,
  onWaypointClick,
}: VoyageLegendProps) => {
  const visibleWaypoints = useMemo(
    () => getPublicVoyageWaypoints(waypoints, articles, voyage.id),
    [waypoints, articles, voyage.id]
  );

  const segments = useMemo(() => {
    if (visibleWaypoints.length < 2) return [];
    const segs: number[] = [];
    for (let i = 1; i < visibleWaypoints.length; i++) {
      const prev = visibleWaypoints[i - 1];
      const curr = visibleWaypoints[i];
      segs.push(haversineNM(prev.lat, prev.lng, curr.lat, curr.lng));
    }
    return segs;
  }, [visibleWaypoints]);

  const totalDistance = useMemo(
    () => segments.reduce((sum, d) => sum + d, 0),
    [segments]
  );

  const useUniform = useMemo(() => {
    if (segments.length === 0 || totalDistance === 0) return true;
    const minRatio = Math.min(...segments.map((s) => s / totalDistance));
    return minRatio < 0.05 || visibleWaypoints.length > 10;
  }, [segments, totalDistance, visibleWaypoints.length]);

  /** Minimum scrollable track width so proportional flex segments get real space (flex + w-max alone under-measures). */
  const diagramContentMinPx = useMemo(() => {
    const n = visibleWaypoints.length;
    const segCount = Math.max(0, n - 1);
    const perDot = 28;
    const perSegMin = 80;
    const base = n * perDot + segCount * perSegMin;
    const scaled = 260 + segCount * 96;
    return Math.max(base, scaled);
  }, [visibleWaypoints.length]);

  const voyageName = getLocalizedVoyageName(voyage, lang);
  const startLabel = formatDate(voyage.start_date, lang);
  const endLabel = formatDate(voyage.end_date, lang);
  const TypeIcon = voyage.type === "water" ? Ship : Mountain;
  const isWater = voyage.type === "water";

  if (visibleWaypoints.length < 2) return null;

  const dotBase = isWater ? "bg-sky-500" : "bg-orange-500";
  const dotHover = isWater ? "group-hover:bg-sky-700" : "group-hover:bg-orange-700";
  const ringColor = isWater ? "ring-sky-200/50" : "ring-orange-200/50";
  const stemBg = isWater ? "bg-sky-300/40" : "bg-orange-300/40";
  const lineBg = isWater ? "bg-sky-300/60" : "bg-orange-300/60";
  const distColor = isWater ? "text-sky-500/70" : "text-orange-500/70";

  const routeRegionLabel = lang === "it" ? "Schema percorso" : "Route diagram";
  const scrollHint =
    lang === "it"
      ? "Scorri in orizzontale per vedere tutto il percorso"
      : "Scroll horizontally to see the full route";

  return (
    <div className="pointer-events-auto w-full min-w-0 rounded-[24px] border border-white/55 bg-background/72 backdrop-blur-2xl shadow-[0_30px_90px_rgba(15,23,42,0.18)] px-6 pt-4 pb-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <TypeIcon
            size={15}
            className={`shrink-0 ${isWater ? "text-sky-600" : "text-orange-600"}`}
          />
          <span className="text-sm font-semibold font-sans text-foreground truncate">
            {voyageName}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label={lang === "it" ? "Chiudi" : "Close"}
        >
          <X size={14} />
        </button>
      </div>

      {(startLabel || endLabel) && (
        <p className="text-[11px] font-sans text-muted-foreground mb-4">
          {startLabel}
          {startLabel && endLabel ? " — " : ""}
          {endLabel}
        </p>
      )}

      {/* Route diagram: larghezza = finestra (container); scroll orizzontale con padding per WPT e scrollbar */}
      <div
        className="max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] rounded-lg pb-3 pt-0.5"
        role="region"
        aria-label={routeRegionLabel}
        title={visibleWaypoints.length > 5 ? scrollHint : undefined}
      >
        <div
          className="flex min-w-full items-center pl-5 pr-3"
          style={{
            paddingTop: 44,
            paddingBottom: 40,
            width: "max-content",
            minWidth: `max(100%, ${diagramContentMinPx}px)`,
          }}
        >
        {visibleWaypoints.map((wp, i) => {
          const routeIndex = waypoints.findIndex((w) => w.id === wp.id);
          const seqHeading =
            routeIndex >= 0 ? getWaypointSequenceHeading(routeIndex, waypoints.length, lang) : "";
          const wpName = getLocalizedWaypointName(wp, lang, routeIndex >= 0 ? routeIndex : i);
          const isFirst = i === 0;
          const isLast = i === visibleWaypoints.length - 1;
          const isEndpoint = isFirst || isLast;
          const labelAbove = i % 2 === 1;

          const segDist = i < segments.length ? segments[i] : 0;
          const growValue =
            useUniform || totalDistance === 0
              ? 1
              : segDist / totalDistance;

          return (
            <Fragment key={wp.id}>
              {/* Waypoint dot + label */}
              <button
                type="button"
                onClick={() => onWaypointClick?.(wp)}
                className="group relative shrink-0 cursor-pointer z-10"
                title={seqHeading ? `${seqHeading} — ${wpName}` : wpName}
              >
                <span
                  className={`
                    block rounded-full transition-colors
                    ${isEndpoint ? "w-3.5 h-3.5" : "w-2.5 h-2.5"}
                    ${dotBase} ${dotHover} ring-2 ${ringColor}
                  `}
                />

                {/* Label positioned above or below */}
                <div
                  className={`
                    absolute left-1/2 -translate-x-1/2 flex flex-col items-center
                    ${labelAbove ? "bottom-full" : "top-full"}
                  `}
                  style={labelAbove ? { marginBottom: 2 } : { marginTop: 2 }}
                >
                  {labelAbove ? (
                    <>
                      <span className="flex flex-col items-center gap-0.5">
                        {seqHeading ? (
                          <span className="text-[8px] leading-tight font-sans uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap">
                            {seqHeading}
                          </span>
                        ) : null}
                        <span className="text-[10px] leading-tight font-sans font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
                          {wpName}
                        </span>
                      </span>
                      <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                    </>
                  ) : (
                    <>
                      {!isEndpoint && (
                        <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                      )}
                      <span
                        className={`
                          flex flex-col items-center gap-0.5 text-[10px] leading-tight font-sans transition-colors whitespace-nowrap
                          ${isEndpoint
                            ? "font-semibold text-foreground mt-1"
                            : "font-medium text-muted-foreground group-hover:text-foreground"}
                        `}
                      >
                        {seqHeading ? (
                          <span className="text-[8px] font-normal uppercase tracking-wider text-muted-foreground/80">
                            {seqHeading}
                          </span>
                        ) : null}
                        <span>{wpName}</span>
                      </span>
                    </>
                  )}
                </div>
              </button>

              {/* Segment line + distance label */}
              {!isLast && (
                <div
                  className="relative flex shrink-0 items-center"
                  style={{
                    flex: `${growValue} 0 auto`,
                    minWidth: 72,
                  }}
                >
                  {/* Distance label centered above the line */}
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 text-[9px] font-sans font-medium whitespace-nowrap ${distColor}`}
                  >
                    {formatDistance(segDist, isWater)}
                  </span>

                  {/* Line */}
                  <div className={`h-[2px] w-full rounded-full ${lineBg}`} />
                </div>
              )}
            </Fragment>
          );
        })}
        </div>
      </div>
    </div>
  );
};

export default VoyageLegend;
