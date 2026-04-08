import { useMemo } from "react";
import { X, Ship, Mountain } from "lucide-react";
import {
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  haversineNM,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle, Language } from "@/lib/voyage-utils";

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

  const voyageName = getLocalizedVoyageName(voyage, lang);
  const startLabel = formatDate(voyage.start_date, lang);
  const endLabel = formatDate(voyage.end_date, lang);
  const TypeIcon = voyage.type === "water" ? Ship : Mountain;
  const accentColor = voyage.type === "water" ? "sky" : "orange";

  if (visibleWaypoints.length < 2) return null;

  return (
    <div
      className={`
        pointer-events-auto
        rounded-xl border bg-background/90 backdrop-blur-md shadow-xl
        px-5 py-4 min-w-[280px] max-w-[520px] w-full
        ${voyage.type === "water"
          ? "border-sky-200/60"
          : "border-orange-200/60"}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <TypeIcon
            size={15}
            className={`shrink-0 ${
              accentColor === "sky" ? "text-sky-600" : "text-orange-600"
            }`}
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

      {/* Dates */}
      {(startLabel || endLabel) && (
        <p className="text-[11px] font-sans text-muted-foreground mb-4 -mt-1">
          {startLabel}
          {startLabel && endLabel ? " — " : ""}
          {endLabel}
        </p>
      )}

      {/* Route visualization */}
      <div className="flex items-center w-full" style={{ minHeight: 36 }}>
        {visibleWaypoints.map((wp, i) => {
          const wpName = getLocalizedWaypointName(wp, lang, i);
          const isFirst = i === 0;
          const isLast = i === visibleWaypoints.length - 1;

          const segAfter = i < segments.length ? segments[i] : 0;
          const pct =
            totalDistance > 0 && segAfter > 0
              ? Math.max(4, (segAfter / totalDistance) * 100)
              : 0;

          return (
            <div
              key={wp.id}
              className="flex items-center"
              style={{
                flexShrink: 0,
                ...(isLast ? {} : { flexGrow: 0 }),
              }}
            >
              {/* Waypoint dot + label */}
              <div className="flex flex-col items-center" style={{ width: "max-content" }}>
                <button
                  type="button"
                  onClick={() => onWaypointClick?.(wp)}
                  className={`
                    group flex flex-col items-center cursor-pointer
                    transition-colors
                  `}
                  title={wpName}
                >
                  <span
                    className={`
                      block rounded-full
                      ${isFirst || isLast ? "w-3 h-3" : "w-2.5 h-2.5"}
                      ${accentColor === "sky"
                        ? "bg-sky-500 group-hover:bg-sky-700 ring-2 ring-sky-200/60"
                        : "bg-orange-500 group-hover:bg-orange-700 ring-2 ring-orange-200/60"}
                      transition-colors
                    `}
                  />
                  <span
                    className={`
                      mt-1.5 text-[10px] leading-tight font-sans max-w-[72px] text-center
                      ${isFirst || isLast
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground group-hover:text-foreground"}
                      transition-colors truncate
                    `}
                  >
                    {wpName}
                  </span>
                </button>
              </div>

              {/* Segment line */}
              {!isLast && (
                <div
                  className={`
                    h-[2px] self-start mt-[5px] rounded-full
                    ${accentColor === "sky"
                      ? "bg-sky-300/70"
                      : "bg-orange-300/70"}
                  `}
                  style={{
                    width: `${pct}%`,
                    minWidth: 12,
                    flexGrow: 1,
                    flexShrink: 1,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VoyageLegend;
