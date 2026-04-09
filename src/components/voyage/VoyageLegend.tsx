import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Mountain, Ship, X } from "lucide-react";
import {
  buildVoyageLegendArticlePlan,
  getLocalizedArticleTitle,
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  getVisibleStopsLegendHeading,
  haversineNM,
} from "@/lib/voyage-utils";
import type { GeoArticle, Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import type { Language } from "@/lib/i18n";

export interface VoyageLegendStoryTitles {
  title_it: string | null;
  title_en: string | null;
}

interface VoyageLegendProps {
  voyage: Voyage;
  waypoints: VoyageWaypoint[];
  articles: GeoArticle[];
  lang: Language;
  onClose: () => void;
  onWaypointClick?: (waypoint: VoyageWaypoint) => void;
  onArticleClick?: (article: GeoArticle) => void;
  /** Titoli storia da `stories` (opzionale; caricati dal parent). */
  storyTitlesById?: Record<string, VoyageLegendStoryTitles>;
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

function LegendArticleChip({
  articles,
  lang,
  onOpen,
  className = "",
}: {
  articles: GeoArticle[];
  lang: Language;
  onOpen: (article: GeoArticle) => void;
  className?: string;
}) {
  const label = articles.map((a) => getLocalizedArticleTitle(a, lang)).join(" · ");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(articles[0]!);
      }}
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-accent/45 bg-background/92 text-accent shadow-sm transition hover:border-accent hover:bg-accent/10 pointer-events-auto ${className}`}
    >
      <BookOpen className="h-[9px] w-[9px]" strokeWidth={2.2} />
    </button>
  );
}

const VoyageLegend = ({
  voyage,
  waypoints,
  articles,
  lang,
  onClose,
  onWaypointClick,
  onArticleClick,
  storyTitlesById,
}: VoyageLegendProps) => {
  const visibleWaypoints = useMemo(
    () => getPublicVoyageWaypoints(waypoints, articles, voyage.id),
    [waypoints, articles, voyage.id]
  );

  const articlePlan = useMemo(() => {
    if (visibleWaypoints.length < 2) {
      return { wholeVoyageArticles: [] as GeoArticle[], routeBindings: [], storyIds: [] as string[] };
    }
    return buildVoyageLegendArticlePlan(voyage.id, waypoints, visibleWaypoints, articles);
  }, [voyage.id, waypoints, visibleWaypoints, articles]);

  const pointArticlesByVis = useMemo(() => {
    const m = new Map<number, GeoArticle[]>();
    for (const b of articlePlan.routeBindings) {
      if (b.kind === "point") m.set(b.visibleIndex, b.articles);
    }
    return m;
  }, [articlePlan.routeBindings]);

  const edgeArticlesByEdge = useMemo(() => {
    const m = new Map<number, GeoArticle[]>();
    for (const b of articlePlan.routeBindings) {
      if (b.kind === "edge") m.set(b.edgeIndex, b.articles);
    }
    return m;
  }, [articlePlan.routeBindings]);

  const spanBindings = useMemo(
    () => articlePlan.routeBindings.filter((b) => b.kind === "span"),
    [articlePlan.routeBindings]
  );

  const storyDisplayNames = useMemo(() => {
    return articlePlan.storyIds
      .map((id) => {
        const s = storyTitlesById?.[id];
        if (!s) return null;
        const name =
          lang === "it" ? s.title_it?.trim() || s.title_en?.trim() || "" : s.title_en?.trim() || s.title_it?.trim() || "";
        return name || null;
      })
      .filter(Boolean) as string[];
  }, [articlePlan.storyIds, storyTitlesById, lang]);

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

  const totalDistance = useMemo(() => segments.reduce((sum, d) => sum + d, 0), [segments]);

  const useUniform = useMemo(() => {
    if (segments.length === 0 || totalDistance === 0) return true;
    const minRatio = Math.min(...segments.map((s) => s / totalDistance));
    return minRatio < 0.05 || visibleWaypoints.length > 10;
  }, [segments, totalDistance, visibleWaypoints.length]);

  const diagramContentMinPx = useMemo(() => {
    const n = visibleWaypoints.length;
    const segCount = Math.max(0, n - 1);
    const perDot = 28;
    const perSegMin = 80;
    const base = n * perDot + segCount * perSegMin;
    const scaled = 260 + segCount * 96;
    return Math.max(base, scaled);
  }, [visibleWaypoints.length]);

  const diagramRowRef = useRef<HTMLDivElement>(null);
  const dotElRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [arcLayout, setArcLayout] = useState<{ w: number; xs: number[] } | null>(null);

  const measureArcs = useCallback(() => {
    const root = diagramRowRef.current;
    if (!root || visibleWaypoints.length < 2 || spanBindings.length === 0) {
      setArcLayout(null);
      return;
    }
    const br = root.getBoundingClientRect();
    const xs = visibleWaypoints.map((_, i) => {
      const el = dotElRefs.current[i];
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 - br.left;
    });
    setArcLayout({ w: Math.max(1, br.width), xs });
  }, [visibleWaypoints, spanBindings.length, segments, useUniform, diagramContentMinPx]);

  useLayoutEffect(() => {
    measureArcs();
  }, [measureArcs]);

  useEffect(() => {
    const root = diagramRowRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measureArcs());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measureArcs]);

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

  const arcBandPx = spanBindings.length > 0 ? 24 : 0;
  const paddingTopDiagram = 44 + arcBandPx;

  const openArticle = (a: GeoArticle) => {
    onArticleClick?.(a);
  };

  return (
    <div className="pointer-events-auto w-full min-w-0 rounded-[24px] border border-white/55 bg-background/72 backdrop-blur-2xl shadow-[0_30px_90px_rgba(15,23,42,0.18)] px-6 pt-4 pb-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
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
        <p className="text-[11px] font-sans text-muted-foreground mb-3">
          {startLabel}
          {startLabel && endLabel ? " — " : ""}
          {endLabel}
        </p>
      )}

      {articlePlan.wholeVoyageArticles.length > 0 && (
        <div className="mb-3 space-y-2">
          {articlePlan.wholeVoyageArticles.map((art) => (
            <div key={art.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-sans">
              <span className="text-muted-foreground line-clamp-2 min-w-0 flex-1 basis-[min(100%,12rem)]">
                {getLocalizedArticleTitle(art, lang)}
              </span>
              <button
                type="button"
                onClick={() => openArticle(art)}
                className="shrink-0 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/18 transition-colors"
              >
                {lang === "it" ? "Vai al racconto" : "Read the story"}
              </button>
            </div>
          ))}
        </div>
      )}

      {storyDisplayNames.length > 0 && (
        <p className="text-[10px] font-sans text-muted-foreground leading-snug mb-3">
          <span>{lang === "it" ? "Fa parte di: " : "Part of: "}</span>
          <span className="text-foreground/90">{storyDisplayNames.join(", ")}</span>
          <span className="text-muted-foreground/75">{lang === "it" ? " (tutte)" : " (all)"}</span>
        </p>
      )}

      <div
        className="max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] rounded-lg pb-3 pt-0.5"
        role="region"
        aria-label={routeRegionLabel}
        title={visibleWaypoints.length > 5 ? scrollHint : undefined}
      >
        <div
          ref={diagramRowRef}
          className="relative flex min-w-full items-center pl-5 pr-3"
          style={{
            paddingTop: paddingTopDiagram,
            paddingBottom: 40,
            width: "max-content",
            minWidth: `max(100%, ${diagramContentMinPx}px)`,
          }}
        >
          {arcLayout && spanBindings.length > 0 && (
            <svg
              className="pointer-events-none absolute left-0 overflow-visible text-accent/38"
              style={{ top: 6, width: arcLayout.w, height: arcBandPx + 4 }}
              width={arcLayout.w}
              height={arcBandPx + 4}
              aria-hidden
            >
              {spanBindings.map((span, si) => {
                const x0 = arcLayout.xs[span.fromVisible];
                const x1 = arcLayout.xs[span.toVisible];
                if (x0 == null || x1 == null || Number.isNaN(x0) || Number.isNaN(x1)) return null;
                const y = arcBandPx - 2 + si * 4;
                const mid = (x0 + x1) / 2;
                const dip = 11 + si * 3;
                const d = `M ${x0} ${y} Q ${mid} ${y - dip} ${x1} ${y}`;
                return (
                  <path
                    key={`${String(span.fromVisible)}-${String(span.toVisible)}-${String(si)}`}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>
          )}

          {visibleWaypoints.map((wp, i) => {
            const routeIndex = waypoints.findIndex((w) => w.id === wp.id);
            const n = visibleWaypoints.length;
            const seqHeading = getVisibleStopsLegendHeading(i, n, lang);
            const wpName = getLocalizedWaypointName(wp, lang, routeIndex >= 0 ? routeIndex : i);
            const isFirst = i === 0;
            const isLast = i === visibleWaypoints.length - 1;
            const isEndpoint = isFirst || isLast;
            const labelAbove = i % 2 === 1;
            const pointArts = pointArticlesByVis.get(i);

            const segDist = i < segments.length ? segments[i] : 0;
            const growValue =
              useUniform || totalDistance === 0 ? 1 : segDist / totalDistance;

            const edgeArts = !isLast ? edgeArticlesByEdge.get(i) : undefined;
            const edgeHasStory = Boolean(edgeArts?.length);

            return (
              <Fragment key={wp.id}>
                <button
                  type="button"
                  ref={(el) => {
                    dotElRefs.current[i] = el;
                  }}
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

                  <div
                    className={`
                    absolute left-1/2 -translate-x-1/2 flex flex-col items-center
                    ${labelAbove ? "bottom-full" : "top-full"}
                  `}
                    style={labelAbove ? { marginBottom: 2 } : { marginTop: 2 }}
                  >
                    {labelAbove ? (
                      <>
                        <span className="flex flex-col items-center gap-0.5 max-w-[min(220px,45vw)]">
                          {seqHeading ? (
                            <span className="text-[8px] leading-tight font-sans uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap">
                              {seqHeading}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center justify-center gap-1">
                            <span className="text-[10px] leading-tight font-sans font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap truncate max-w-[11rem]">
                              {wpName}
                            </span>
                            {pointArts?.length && onArticleClick ? (
                              <LegendArticleChip articles={pointArts} lang={lang} onOpen={openArticle} />
                            ) : null}
                          </span>
                        </span>
                        <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                      </>
                    ) : (
                      <>
                        {!isEndpoint && <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />}
                        <span
                          className={`
                          flex flex-col items-center gap-0.5 text-[10px] leading-tight font-sans transition-colors max-w-[min(220px,45vw)]
                          ${isEndpoint
                            ? "font-semibold text-foreground mt-1"
                            : "font-medium text-muted-foreground group-hover:text-foreground"}
                        `}
                        >
                          {seqHeading ? (
                            <span className="text-[8px] font-normal uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap">
                              {seqHeading}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center justify-center gap-1">
                            <span className="truncate max-w-[11rem]">{wpName}</span>
                            {pointArts?.length && onArticleClick ? (
                              <LegendArticleChip articles={pointArts} lang={lang} onOpen={openArticle} />
                            ) : null}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </button>

                {!isLast && (
                  <div
                    className="relative flex shrink-0 items-center"
                    style={{
                      flex: `${growValue} 0 auto`,
                      minWidth: 72,
                    }}
                  >
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 bottom-full text-[9px] font-sans font-medium whitespace-nowrap ${distColor} ${
                        edgeHasStory ? "mb-3" : "mb-1.5"
                      }`}
                    >
                      {formatDistance(segDist, isWater)}
                    </span>

                    {edgeArts?.length && onArticleClick ? (
                      <div className="absolute left-1/2 top-1/2 z-[11] -translate-x-1/2 -translate-y-1/2">
                        <LegendArticleChip articles={edgeArts} lang={lang} onOpen={openArticle} />
                      </div>
                    ) : null}

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
