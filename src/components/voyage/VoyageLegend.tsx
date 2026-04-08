import { useMemo } from "react";
import { X, Ship, Mountain } from "lucide-react";
import {
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
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

const STEM_HEIGHT = 10;

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
  const isWater = voyage.type === "water";

  if (visibleWaypoints.length < 2) return null;

  const dotColor = isWater ? "bg-sky-500" : "bg-orange-500";
  const dotHover = isWater ? "group-hover:bg-sky-700" : "group-hover:bg-orange-700";
  const dotRing = isWater ? "ring-sky-200/60" : "ring-orange-200/60";
  const stemColor = isWater ? "bg-sky-300/50" : "bg-orange-300/50";
  const lineColor = isWater ? "bg-sky-300/70" : "bg-orange-300/70";

  return (
    <div
      className={`
        pointer-events-auto
        rounded-xl border bg-background/90 backdrop-blur-md shadow-xl
        px-5 pt-4 pb-3 min-w-[280px] w-full
        ${isWater ? "border-sky-200/60" : "border-orange-200/60"}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
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
        <p className="text-[11px] font-sans text-muted-foreground mb-3 -mt-0.5">
          {startLabel}
          {startLabel && endLabel ? " — " : ""}
          {endLabel}
        </p>
      )}

      {/* Route: dots + proportional segments on a horizontal line, labels alternate above/below */}
      <div className="flex items-center w-full py-7">
        {visibleWaypoints.map((wp, i) => {
          const wpName = getLocalizedWaypointName(wp, lang, i);
          const isFirst = i === 0;
          const isLast = i === visibleWaypoints.length - 1;
          const isEndpoint = isFirst || isLast;
          const labelAbove = !isEndpoint && i % 2 === 1;

          const segDist = i < segments.length ? segments[i] : 0;
          const growValue = totalDistance > 0 && segDist > 0 ? segDist / totalDistance : 0;

          return (
            <div
              key={wp.id}
              className="flex items-center"
              style={{
                flex: isLast ? "0 0 auto" : `${growValue} 1 0%`,
                minWidth: 0,
              }}
            >
              {/* Waypoint dot + label */}
              <button
                type="button"
                onClick={() => onWaypointClick?.(wp)}
                className="group relative shrink-0 cursor-pointer"
                title={wpName}
              >
                {/* Dot */}
                <span
                  className={`
                    block rounded-full transition-colors
                    ${isEndpoint ? "w-3 h-3" : "w-2.5 h-2.5"}
                    ${dotColor} ${dotHover} ring-2 ${dotRing}
                  `}
                />

                {/* Label + stem, absolutely positioned */}
                <div
                  className={`
                    absolute left-1/2 -translate-x-1/2 flex flex-col items-center
                    ${labelAbove ? "bottom-full" : "top-full"}
                  `}
                  style={labelAbove ? { marginBottom: 1 } : { marginTop: 1 }}
                >
                  {labelAbove ? (
                    <>
                      <span
                        className="text-[10px] leading-tight font-sans font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap"
                      >
                        {wpName}
                      </span>
                      <div
                        className={`w-px ${stemColor}`}
                        style={{ height: STEM_HEIGHT }}
                      />
                    </>
                  ) : (
                    <>
                      {!isEndpoint && (
                        <div
                          className={`w-px ${stemColor}`}
                          style={{ height: STEM_HEIGHT }}
                        />
                      )}
                      <span
                        className={`
                          text-[10px] leading-tight font-sans transition-colors whitespace-nowrap
                          ${isEndpoint
                            ? "font-semibold text-foreground mt-1.5"
                            : "font-medium text-muted-foreground group-hover:text-foreground"}
                        `}
                      >
                        {wpName}
                      </span>
                    </>
                  )}
                </div>
              </button>

              {/* Segment line */}
              {!isLast && (
                <div
                  className={`h-[2px] rounded-full flex-1 ${lineColor}`}
                  style={{ minWidth: 8 }}
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
