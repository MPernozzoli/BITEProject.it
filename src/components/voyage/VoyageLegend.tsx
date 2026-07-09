import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { BookOpen, Mountain, Ship, TicketCheck, X } from "lucide-react";
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
import {
  getLegComplexity,
  getLegDangerLevel,
  isVoyageBookableNow,
  type BookableLegAvailability,
} from "@/lib/booking-utils";
import ComplexityIndicator from "@/components/booking/ComplexityIndicator";

export interface VoyageLegendStoryTitles {
  title_it: string | null;
  title_en: string | null;
  slug: string | null;
}

interface VoyageLegendProps {
  voyage: Voyage;
  waypoints: VoyageWaypoint[];
  articles: GeoArticle[];
  lang: Language;
  onClose: () => void;
  onWaypointClick?: (waypoint: VoyageWaypoint) => void;
  onArticleClick?: (article: GeoArticle) => void;
  bookingLegs?: BookableLegAvailability[];
  onWaypointBookingAction?: (voyageId: string, waypointId: string, direction: "from" | "to") => void;
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

/** Vertice a t=½ su una quadratica da (x0,y0) a (x2,y2) con controllo (xc,yc). */
function quadBezierMidAtHalf(
  x0: number,
  y0: number,
  xc: number,
  yc: number,
  x2: number,
  y2: number
): { x: number; y: number } {
  const t = 0.5;
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * xc + t * t * x2,
    y: u * u * y0 + 2 * u * t * yc + t * t * y2,
  };
}

const arcLayoutNearlyEqual = (
  a: { w: number; xs: number[] },
  b: { w: number; xs: number[] }
): boolean => {
  if (Math.abs(a.w - b.w) > 0.5) return false;
  if (a.xs.length !== b.xs.length) return false;
  return a.xs.every((v, i) => Math.abs(v - (b.xs[i] ?? 0)) < 0.5);
};

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
  const first = articles[0];
  if (!first) return null;
  const label = articles.map((a) => getLocalizedArticleTitle(a, lang)).join(" · ");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(first);
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
  bookingLegs = [],
  onWaypointBookingAction,
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

  const storyIndexLinks = useMemo(() => {
    return articlePlan.storyIds
      .map((id) => {
        const s = storyTitlesById?.[id];
        if (!s) return null;
        const name =
          lang === "it" ? s.title_it?.trim() || s.title_en?.trim() || "" : s.title_en?.trim() || s.title_it?.trim() || "";
        if (!name) return null;
        return { id, name, slug: s.slug?.trim() || null };
      })
      .filter(Boolean) as { id: string; name: string; slug: string | null }[];
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

  /** Bookable legs keyed by "fromWaypointId:toWaypointId" for per-edge complexity. */
  const legByWaypointPair = useMemo(() => {
    const map = new Map<string, BookableLegAvailability>();
    for (const leg of bookingLegs) {
      map.set(`${leg.from_waypoint_id}:${leg.to_waypoint_id}`, leg);
    }
    return map;
  }, [bookingLegs]);

  /** Ortodromia su tutti i waypoint del viaggio (anche tecnici), ordine `waypoints`. */
  const fullVoyageDistanceNm = useMemo(() => {
    if (waypoints.length < 2) return null;
    let total = 0;
    for (let i = 1; i < waypoints.length; i++) {
      total += haversineNM(
        waypoints[i - 1].lat,
        waypoints[i - 1].lng,
        waypoints[i].lat,
        waypoints[i].lng
      );
    }
    return total;
  }, [waypoints]);

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
  const arcFilterDomId = useId().replace(/:/g, "");

  const measureArcs = useCallback(() => {
    try {
      const root = diagramRowRef.current;
      if (!root || visibleWaypoints.length < 2 || spanBindings.length === 0) {
        setArcLayout((prev) => (prev === null ? prev : null));
        return;
      }
      const br = root.getBoundingClientRect();
      const xs = visibleWaypoints.map((_, i) => {
        const el = dotElRefs.current[i];
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 - br.left;
      });
      const next = { w: Math.max(1, br.width), xs };
      setArcLayout((prev) => {
        if (prev && arcLayoutNearlyEqual(prev, next)) return prev;
        return next;
      });
    } catch {
      setArcLayout((prev) => (prev === null ? prev : null));
    }
  }, [visibleWaypoints, spanBindings.length, segments, useUniform, diagramContentMinPx]);

  useLayoutEffect(() => {
    measureArcs();
  }, [measureArcs]);

  useEffect(() => {
    const root = diagramRowRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureArcs();
      });
    });
    ro.observe(root);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measureArcs]);

  const voyageName = getLocalizedVoyageName(voyage, lang);
  const startLabel = formatDate(voyage.start_date, lang);
  const endLabel = formatDate(voyage.end_date, lang);
  const TypeIcon = voyage.type === "water" ? Ship : Mountain;
  const isWater = voyage.type === "water";
  const firstVisibleWaypoint = visibleWaypoints[0] || null;
  const lastVisibleWaypoint = visibleWaypoints[visibleWaypoints.length - 1] || null;
  const voyageIsBookable = isVoyageBookableNow(voyage);
  const hasBookableLegs = bookingLegs.length > 0;
  const hasAvailableLegs = bookingLegs.some((leg) => leg.available);

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

  const arcSvgTop = 8;
  const arcBandPx = spanBindings.length > 0 ? 30 : 0;
  const paddingTopDiagram = 44 + arcBandPx;

  const openArticle = (a: GeoArticle) => {
    onArticleClick?.(a);
  };

  return (
    <div className="pointer-events-auto w-full min-w-0 rounded-[24px] border border-white/55 bg-background/72 backdrop-blur-2xl shadow-[0_30px_90px_rgba(15,23,42,0.18)] px-6 pt-4 pb-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TypeIcon
            size={15}
            className={`shrink-0 ${isWater ? "text-sky-600" : "text-orange-600"}`}
          />
          <span className="truncate text-sm font-semibold font-sans text-foreground">{voyageName}</span>
          {voyageIsBookable ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/70 bg-emerald-50/85 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-800">
              <TicketCheck size={10} />
              {lang === "it" ? "Prenotabile" : "Bookable"}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-3">
          {storyIndexLinks.length > 0 ? (
            <p className="max-w-[min(220px,46vw)] text-right text-[10px] font-sans leading-snug text-muted-foreground">
              <span>{lang === "it" ? "Fa parte di " : "Part of "}</span>
              {storyIndexLinks.map((s, idx) => (
                <Fragment key={s.id}>
                  {idx > 0 ? <span>, </span> : null}
                  {s.slug ? (
                    <Link
                      to={`/logbook/story/${s.slug}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground/90">{s.name}</span>
                  )}
                </Fragment>
              ))}
              <span className="text-muted-foreground/75">{lang === "it" ? " (tutte)" : " (all)"}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={lang === "it" ? "Chiudi" : "Close"}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {(startLabel || endLabel || fullVoyageDistanceNm != null) && (
        <p className="mb-3 text-[11px] font-sans leading-relaxed text-muted-foreground">
          {(startLabel || endLabel) && (
            <>
              {startLabel}
              {startLabel && endLabel ? " — " : ""}
              {endLabel}
            </>
          )}
          {(startLabel || endLabel) && fullVoyageDistanceNm != null ? (
            <span className="text-muted-foreground/65"> · </span>
          ) : null}
          {fullVoyageDistanceNm != null ? (
            <span className={isWater ? "font-medium text-sky-700/90" : "font-medium text-orange-700/90"}>
              {lang === "it" ? "Lunghezza totale " : "Total distance "}
              <span className="tabular-nums">{formatDistance(fullVoyageDistanceNm, isWater)}</span>
            </span>
          ) : null}
        </p>
      )}

      {voyageIsBookable ? (
        <div className="mb-3 rounded-[18px] border border-emerald-200/80 bg-emerald-50/82 p-3 font-sans shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-800">
                {lang === "it" ? "Puoi partecipare a questo viaggio" : "You can join this voyage"}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/75">
                {!hasBookableLegs
                  ? (lang === "it"
                    ? "Prenotazioni non ancora aperte per le singole tratte."
                    : "Bookings are not open for individual legs yet.")
                  : hasAvailableLegs
                    ? (lang === "it"
                      ? "Scegli un waypoint di partenza o arrivo, poi completa la selezione sulla mappa."
                      : "Choose a start or arrival waypoint, then complete the selection on the map.")
                    : (lang === "it"
                      ? "Le tratte esistono, ma al momento non risultano posti disponibili."
                      : "Legs exist, but no seats are currently available.")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                disabled={!hasAvailableLegs || !firstVisibleWaypoint || !onWaypointBookingAction}
                onClick={() => {
                  if (!firstVisibleWaypoint) return;
                  onWaypointBookingAction?.(voyage.id, firstVisibleWaypoint.id, "from");
                  onWaypointClick?.(firstVisibleWaypoint);
                }}
                className="inline-flex items-center justify-center rounded-full border border-emerald-400/80 bg-white/80 px-3 py-2 text-[11px] font-semibold text-emerald-800 transition hover:bg-white disabled:cursor-not-allowed disabled:border-emerald-200 disabled:text-emerald-900/35"
              >
                {lang === "it" ? "Prenota da inizio" : "Book from start"}
              </button>
              <button
                type="button"
                disabled={!hasAvailableLegs || !lastVisibleWaypoint || !onWaypointBookingAction}
                onClick={() => {
                  if (!lastVisibleWaypoint) return;
                  onWaypointBookingAction?.(voyage.id, lastVisibleWaypoint.id, "to");
                  onWaypointClick?.(lastVisibleWaypoint);
                }}
                className="inline-flex items-center justify-center rounded-full border border-emerald-400/80 bg-white/80 px-3 py-2 text-[11px] font-semibold text-emerald-800 transition hover:bg-white disabled:cursor-not-allowed disabled:border-emerald-200 disabled:text-emerald-900/35"
              >
                {lang === "it" ? "Prenota fino ad arrivo" : "Book to arrival"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            <>
              <svg
                className="pointer-events-none absolute left-0 overflow-visible"
                style={{ top: arcSvgTop, width: arcLayout.w, height: arcBandPx + 6 }}
                width={arcLayout.w}
                height={arcBandPx + 6}
                aria-hidden
              >
                <defs>
                  <filter id={arcFilterDomId} x="-20%" y="-60%" width="140%" height="220%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {spanBindings.map((span, si) => {
                  const x0 = arcLayout.xs[span.fromVisible];
                  const x1 = arcLayout.xs[span.toVisible];
                  if (x0 == null || x1 == null || Number.isNaN(x0) || Number.isNaN(x1)) return null;
                  const y = arcBandPx - 4 + si * 3;
                  const mid = (x0 + x1) / 2;
                  const dip = 14 + si * 4;
                  const d = `M ${x0} ${y} Q ${mid} ${y - dip} ${x1} ${y}`;
                  return (
                    <g key={`arc-${String(span.fromVisible)}-${String(span.toVisible)}-${String(si)}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke="hsl(var(--background))"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        opacity={0.65}
                      />
                      <path
                        d={d}
                        fill="none"
                        className="text-accent"
                        stroke="currentColor"
                        strokeWidth={1.35}
                        strokeLinecap="round"
                        strokeOpacity={0.55}
                        filter={`url(#${arcFilterDomId})`}
                      />
                    </g>
                  );
                })}
              </svg>
              {spanBindings.map((span, si) => {
                const x0 = arcLayout.xs[span.fromVisible];
                const x1 = arcLayout.xs[span.toVisible];
                if (x0 == null || x1 == null || Number.isNaN(x0) || Number.isNaN(x1) || !onArticleClick) return null;
                const yLine = arcBandPx - 4 + si * 3;
                const mid = (x0 + x1) / 2;
                const dip = 14 + si * 4;
                const yCtrl = yLine - dip;
                const { x: cx, y: cy } = quadBezierMidAtHalf(x0, yLine, mid, yCtrl, x1, yLine);
                return (
                  <div
                    key={`arc-chip-${String(span.fromVisible)}-${String(span.toVisible)}-${String(si)}`}
                    className="pointer-events-auto absolute z-[12] -translate-x-1/2 -translate-y-1/2"
                    style={{ left: cx, top: arcSvgTop + cy }}
                  >
                    <LegendArticleChip articles={span.articles} lang={lang} onOpen={openArticle} />
                  </div>
                );
              })}
            </>
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
            const edgeLeg = !isLast
              ? legByWaypointPair.get(`${wp.id}:${visibleWaypoints[i + 1]?.id ?? ""}`)
              : undefined;

            return (
              <Fragment key={wp.id}>
                <button
                  type="button"
                  ref={(el) => {
                    dotElRefs.current[i] = el;
                  }}
                  onClick={() => onWaypointClick?.(wp)}
                  className="group relative z-10 flex shrink-0 cursor-pointer flex-col items-center justify-center overflow-visible"
                  title={seqHeading ? `${seqHeading} — ${wpName}` : wpName}
                >
                  {!labelAbove && pointArts?.length && onArticleClick ? (
                    <div
                      className="absolute bottom-full left-1/2 z-[11] flex -translate-x-1/2 flex-col items-center"
                      style={{ marginBottom: 2 }}
                    >
                      <LegendArticleChip articles={pointArts} lang={lang} onOpen={openArticle} />
                      <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                    </div>
                  ) : null}

                  <span
                    className={`
                    block rounded-full transition-colors
                    ${isEndpoint ? "w-3.5 h-3.5" : "w-2.5 h-2.5"}
                    ${dotBase} ${dotHover} ring-2 ${ringColor}
                  `}
                  />

                  <div
                    className={`
                    absolute left-1/2 flex -translate-x-1/2 flex-col items-center
                    ${labelAbove ? "bottom-full" : "top-full"}
                  `}
                    style={labelAbove ? { marginBottom: 2 } : { marginTop: 2 }}
                  >
                    {labelAbove ? (
                      <>
                        <span className="flex max-w-[min(220px,45vw)] flex-col items-center gap-0.5">
                          {seqHeading ? (
                            <span className="whitespace-nowrap text-[8px] font-sans uppercase leading-tight tracking-wider text-muted-foreground/80">
                              {seqHeading}
                            </span>
                          ) : null}
                          <span className="max-w-[11rem] truncate text-[10px] font-sans font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                            {wpName}
                          </span>
                        </span>
                        <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                      </>
                    ) : (
                      <>
                        {!isEndpoint ? <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} /> : null}
                        <span
                          className={`
                          flex max-w-[min(220px,45vw)] flex-col items-center gap-0.5 text-[10px] font-sans leading-tight transition-colors
                          ${isEndpoint
                            ? "mt-1 font-semibold text-foreground"
                            : "font-medium text-muted-foreground group-hover:text-foreground"}
                        `}
                        >
                          {seqHeading ? (
                            <span className="whitespace-nowrap text-[8px] font-normal uppercase tracking-wider text-muted-foreground/80">
                              {seqHeading}
                            </span>
                          ) : null}
                          <span className="max-w-[11rem] truncate">{wpName}</span>
                        </span>
                      </>
                    )}
                  </div>

                  {labelAbove && pointArts?.length && onArticleClick ? (
                    <div
                      className="absolute top-full left-1/2 z-[11] flex -translate-x-1/2 flex-col items-center"
                      style={{ marginTop: 2 }}
                    >
                      <div className={`w-px ${stemBg}`} style={{ height: STEM_H }} />
                      <LegendArticleChip articles={pointArts} lang={lang} onOpen={openArticle} />
                    </div>
                  ) : null}
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

                    {edgeLeg ? (
                      <div className="pointer-events-auto absolute left-1/2 top-full z-[12] -translate-x-1/2" style={{ marginTop: 4 }}>
                        <ComplexityIndicator
                          variant="dot"
                          level={getLegComplexity(edgeLeg)}
                          dangerLevel={getLegDangerLevel(edgeLeg)}
                          lang={lang}
                        />
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
