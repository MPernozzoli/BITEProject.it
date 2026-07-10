import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import {
  buildVoyageSegmentGeometry,
  getArticleVoyageFocus,
  getAssociatedArticleForWaypoint,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  getVisibleStopsLegendHeading,
  getVoyageMapLineStringCoordinates,
  normalizeWaypointMedia,
  resolveArticleRouteRange,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";
import {
  getComplexityExplanation,
  getComplexityLabel,
  getComplexityTitle,
  getDangerLabel,
  getLegComplexity,
  getLegDangerLevel,
  isLegCurrentOrFuture,
  isVoyageBookableNow,
  type BookableLeg,
  type BookableLegAvailability,
} from "@/lib/booking-utils";
import { getMapPresenceIconMarkup, type MapPresenceMarker } from "@/lib/map-presence";
import { bindMapToContainerResize, createCartoRasterStyle, requestMapResize } from "@/lib/maplibre";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";

const MAP_MARKER_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

interface VoyageMapProps {
  voyages: Voyage[];
  waypointsMap: Record<string, VoyageWaypoint[]>;
  articles: GeoArticle[];
  selectedArticleId?: string | null;
  hoveredArticleId?: string | null;
  highlightedVoyageId?: string | null;
  presenceMarkers?: MapPresenceMarker[];
  onArticleClick?: (article: GeoArticle) => void;
  onVoyageSelect?: (voyageId: string | null) => void;
  selectedRouteVoyageId?: string | null;
  bookingLegsByVoyage?: Record<string, BookableLegAvailability[]>;
  bookingSelectionAnchor?: { voyageId: string; waypointId: string } | null;
  onWaypointBookingAction?: (voyageId: string, waypointId: string, direction: "from" | "to") => void;
  flyToWaypointRef?: MutableRefObject<((lat: number, lng: number, popupLabel?: string) => void) | null>;
  lang: "en" | "it";
  initialFitReady?: boolean;
  disableInteractions?: boolean;
  onMapUnavailable?: () => void;
}

const escapePopupHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildPopupModule = (tone: "article" | "booking" | "media" | "story", label: string, body: string) => `
  <section class="voyage-popup__module voyage-popup__module--${tone}">
    <div class="voyage-popup__module-kicker">${escapePopupHtml(label)}</div>
    ${body}
  </section>
`;

const buildPopupMediaModule = (waypoint: VoyageWaypoint, label: string) => {
  const media = normalizeWaypointMedia(waypoint.media).find((item) => item.kind === "image" || item.kind === "video");
  if (!media) return "";

  const mediaName = media.name ? `<span class="voyage-popup__media-caption">${escapePopupHtml(media.name)}</span>` : "";
  const url = escapePopupHtml(media.url);

  if (media.kind === "video") {
    return buildPopupModule(
      "media",
      label,
      `<video class="voyage-popup__media" src="${url}" muted playsinline preload="metadata"></video>${mediaName}`
    );
  }

  return buildPopupModule(
    "media",
    label,
    `<img class="voyage-popup__media" src="${url}" alt="${escapePopupHtml(media.name || label)}" loading="lazy" />${mediaName}`
  );
};

const buildComplexityHelpMarkup = (lang: "en" | "it", label: string, explanation: string) => {
  const helpLabel = lang === "it" ? "Spiegazione complessità" : "Complexity explanation";
  return `
    <span class="voyage-popup__help">
      <button type="button" class="voyage-popup__help-trigger" aria-label="${escapePopupHtml(helpLabel)}" aria-describedby="voyage-popup-complexity-help">?</button>
      <span id="voyage-popup-complexity-help" role="tooltip" class="voyage-popup__help-tooltip">
        <span class="voyage-popup__help-title">${escapePopupHtml(label)}</span>
        <span>${escapePopupHtml(explanation)}</span>
      </span>
    </span>
  `;
};

/**
 * Compact, color-coded complexity chip meant to live inside the booking module — the
 * complexity estimate only matters to someone deciding whether to book this leg.
 */
const buildComplexityChipMarkup = (leg: BookableLeg, lang: "en" | "it") => {
  const level = getLegComplexity(leg);
  const danger = getLegDangerLevel(leg);
  const label = getComplexityLabel(level, lang);
  const helpTitle = `${getComplexityTitle(lang)} · ${label}`;
  return `
    <div class="voyage-popup__complexity">
      <span class="voyage-popup__complexity-dot voyage-popup__complexity-dot--${level}">${level}</span>
      <span class="voyage-popup__complexity-label">${escapePopupHtml(label)}${
        danger > 0 ? ` · ${escapePopupHtml(getDangerLabel(danger, lang))}` : ""
      }</span>
      ${buildComplexityHelpMarkup(lang, helpTitle, getComplexityExplanation(leg, lang))}
    </div>
  `;
};

const clampWaypointIndex = (value: number, max: number) => Math.max(0, Math.min(value, max));

const buildMapPresenceTooltipTimestamp = (value: string, locale: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const createPresenceMarkerElement = (marker: MapPresenceMarker) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `map-presence-marker map-presence-marker--${marker.kind}`;
  button.setAttribute("aria-label", marker.title);
  button.title = marker.title;

  const iconMarkup = getMapPresenceIconMarkup(marker.kind);

  button.innerHTML = `
    <span class="map-presence-marker__halo" aria-hidden="true"></span>
    <span class="map-presence-marker__chip" aria-hidden="true">
      <span class="map-presence-marker__icon">${iconMarkup}</span>
    </span>
  `;

  return button;
};

type PositionedArticle = GeoArticle & { displayLat: number; displayLng: number };

function buildPositionedArticlesForCluster(
  articles: GeoArticle[],
  waypointsMap: Record<string, VoyageWaypoint[]>
): PositionedArticle[] {
  return articles
    .map((article) => {
      if (article.latitude != null && article.longitude != null) {
        return { ...article, displayLat: article.latitude, displayLng: article.longitude };
      }
      if (article.voyage_id) {
        const wps = waypointsMap[article.voyage_id] || [];
        if (wps.length < 1) return null;
        const range = resolveArticleRouteRange(article, wps);
        if (range) {
          const start = clampWaypointIndex(range[0], wps.length - 1);
          const end = clampWaypointIndex(range[1], wps.length - 1);
          const midIdx = Math.round((start + end) / 2);
          const wp = wps[midIdx] || wps[0];
          return { ...article, displayLat: wp.lat, displayLng: wp.lng };
        }
        const mid = wps[Math.floor(wps.length / 2)];
        return { ...article, displayLat: mid.lat, displayLng: mid.lng };
      }
      return null;
    })
    .filter(Boolean) as PositionedArticle[];
}

const getVoyageYearTier = (voyage: Voyage) => {
  if (!voyage.start_date) return 0;
  const startDate = new Date(voyage.start_date);
  if (Number.isNaN(startDate.getTime())) return 0;

  return Math.max(0, new Date().getFullYear() - startDate.getFullYear());
};

const getVoyageLineWidthScale = (voyage: Voyage) => {
  const yearTier = getVoyageYearTier(voyage);
  if (yearTier <= 0) return 1;
  if (yearTier === 1) return 0.76;
  if (yearTier === 2) return 0.56;
  return 0.34;
};

const getVoyageStrokeColor = (voyage: Voyage, variant: "base" | "focus" = "base") => {
  if (voyage.type === "water") {
    if (variant === "focus") return "hsl(206, 84%, 40%)";
    if (voyage.status === "completed") return "hsl(208, 48%, 34%)";
    if (voyage.status === "planned") return "hsl(205, 60%, 68%)";
    return "hsl(206, 72%, 47%)";
  }

  if (variant === "focus") return "hsl(28, 90%, 44%)";
  if (voyage.status === "completed") return "hsl(28, 54%, 36%)";
  if (voyage.status === "planned") return "hsl(31, 72%, 70%)";
  return "hsl(30, 78%, 50%)";
};

const getVoyageStatusDashArray = (voyage: Voyage): number[] | undefined => {
  if (voyage.status === "planned") {
    return voyage.type === "water" ? [2.2, 2.8] : [1.6, 2.2];
  }

  return undefined;
};

const getVoyageStatusCasingColor = (voyage: Voyage) => {
  if (voyage.type === "water") {
    if (voyage.status === "active") return "hsla(206, 80%, 44%, 0.22)";
    if (voyage.status === "planned") return "hsla(205, 56%, 70%, 0.18)";
    return "hsla(208, 46%, 24%, 0.18)";
  }

  if (voyage.status === "active") return "hsla(30, 84%, 46%, 0.22)";
  if (voyage.status === "planned") return "hsla(31, 68%, 70%, 0.16)";
  return "hsla(28, 44%, 28%, 0.16)";
};

const getVoyageLineMetrics = (
  voyage: Voyage,
  state: { isFocused: boolean; isHovered: boolean; isDimmed: boolean; activeArticleFocusMode?: "voyage" | "segment" | "point" | null }
) => {
  const { isFocused, isHovered, isDimmed, activeArticleFocusMode } = state;
  const widthScale = getVoyageLineWidthScale(voyage);

  const baseWidth = isFocused
    ? activeArticleFocusMode === "voyage" ? 5.8 : 4.8
    : isHovered
      ? 5.2
      : voyage.status === "active"
        ? 4.6
        : voyage.status === "planned"
          ? 3.2
          : 3.4;
  const width = Math.max(0.9, baseWidth * widthScale);

  const opacity = isDimmed
    ? 0.16
    : voyage.status === "planned"
      ? isFocused || isHovered ? 0.82 : 0.58
      : voyage.status === "active"
        ? isFocused || isHovered ? 1 : 0.94
        : isFocused || isHovered
          ? 0.98
          : 0.78;

  const casingWidth = isFocused
    ? width + Math.max(1.4, 4 * widthScale)
    : isHovered
      ? width + Math.max(1.2, 3.4 * widthScale)
      : voyage.status === "active"
        ? width + Math.max(1.1, 3 * widthScale)
        : width + Math.max(1, 2.4 * widthScale);

  const casingOpacity = isDimmed
    ? 0.08
    : voyage.status === "active"
      ? isFocused || isHovered ? 0.42 : 0.3
      : voyage.status === "planned"
        ? isFocused || isHovered ? 0.24 : 0.16
        : isFocused || isHovered
          ? 0.24
          : 0.16;

  return { width, opacity, casingWidth, casingOpacity };
};

const getArticleSegmentGeometry = (
  waypoints: VoyageWaypoint[],
  type: Voyage["type"],
  startIndex: number,
  endIndex: number,
  cachedGeometry?: [number, number][] | null
) => {
  return buildVoyageSegmentGeometry(waypoints, type, startIndex, endIndex, cachedGeometry);
};

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  hoveredArticleId,
  highlightedVoyageId,
  presenceMarkers = [],
  onArticleClick,
  onVoyageSelect,
  selectedRouteVoyageId: controlledRouteVoyageId,
  bookingLegsByVoyage = {},
  bookingSelectionAnchor = null,
  onWaypointBookingAction,
  flyToWaypointRef,
  lang,
  initialFitReady = true,
  disableInteractions = false,
  onMapUnavailable,
}: VoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const waypointPopupPersistentRef = useRef(false);
  const presenceMarkersRef = useRef<maplibregl.Marker[]>([]);
  const presencePopupRef = useRef<maplibregl.Popup | null>(null);
  const lineLayerHandlersRef = useRef<Record<string, {
    click: (e: maplibregl.MapLayerMouseEvent) => void;
    mouseenter: () => void;
    mouseleave: () => void;
  }>>({});
  const waypointLayerHandlersRef = useRef<Record<string, {
    mouseenter: (event: maplibregl.MapLayerMouseEvent) => void;
    mousemove: (event: maplibregl.MapLayerMouseEvent) => void;
    mouseleave: (event: maplibregl.MapLayerMouseEvent) => void;
  }>>({});
  const onArticleClickRef = useRef(onArticleClick);
  const onVoyageSelectRef = useRef(onVoyageSelect);
  const hasPerformedInitialFitRef = useRef(false);
  const mapResizeCleanupRef = useRef<(() => void) | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hoveredRouteVoyageId, setHoveredRouteVoyageId] = useState<string | null>(null);

  const clusterIndexRef = useRef<Supercluster | null>(null);
  const articlesByIdRef = useRef<Map<string, PositionedArticle>>(new Map());
  const runArticleMarkersSyncRef = useRef<() => void>(() => {});
  const hoveredRouteVoyageIdRef = useRef<string | null>(null);
  hoveredRouteVoyageIdRef.current = hoveredRouteVoyageId;

  const selectedArticleIdRef = useRef(selectedArticleId);
  selectedArticleIdRef.current = selectedArticleId;
  const hoveredArticleIdRef = useRef(hoveredArticleId);
  hoveredArticleIdRef.current = hoveredArticleId;
  const highlightedVoyageIdRef = useRef(highlightedVoyageId);
  highlightedVoyageIdRef.current = highlightedVoyageId;
  const langRef = useRef(lang);
  langRef.current = lang;
  const onWaypointBookingActionRef = useRef(onWaypointBookingAction);
  onWaypointBookingActionRef.current = onWaypointBookingAction;
  const bookingSelectionAnchorRef = useRef(bookingSelectionAnchor);
  bookingSelectionAnchorRef.current = bookingSelectionAnchor;

  const publishedVoyages = useMemo(() => voyages.filter((v) => v.is_published), [voyages]);
  const articlesForMap = useMemo(
    () => articles.filter((a) => a.published_at != null),
    [articles]
  );
  const positionedArticles = useMemo(
    () => buildPositionedArticlesForCluster(articlesForMap, waypointsMap),
    [articlesForMap, waypointsMap]
  );

  /** Tutti i waypoint pubblici (tutti i viaggi) per cluster sulla mappa */
  const mapWaypointClusterInputs = useMemo(() => {
    type Item = {
      key: string;
      lng: number;
      lat: number;
      voyageId: string;
      waypoint: VoyageWaypoint;
      sequenceHeading: string;
      name: string;
      articleTitle: string;
      fillColor: string;
      /** Colore tratto principale del percorso (come layer `voyage-line-*`). */
      routeStrokeColor: string;
      isBookableVoyage: boolean;
      hasOutboundAvailability: boolean;
      hasInboundAvailability: boolean;
      hasAnyBookingLeg: boolean;
      /** Whether any leg touching this waypoint (outbound or inbound) is still current/future, i.e. not past/completed. */
      hasCurrentLegFromHere: boolean;
      /** The leg departing from this waypoint, if any (only set when that leg is still current/future). */
      outboundLeg: BookableLeg | null;
    };
    const items: Item[] = [];
    for (const voyage of publishedVoyages) {
      const wps = waypointsMap[voyage.id] || [];
      if (!wps.length) continue;
      const visible = getPublicVoyageWaypoints(wps, articlesForMap, voyage.id);
      const isActive = voyage.status === "active";
      for (let vi = 0; vi < visible.length; vi++) {
        const w = visible[vi]!;
        const routeIndex = wps.findIndex((waypoint) => waypoint.id === w.id);
        const safeIndex = routeIndex >= 0 ? routeIndex : vi;
        const associatedArticle = getAssociatedArticleForWaypoint(articlesForMap, voyage.id, safeIndex, wps);
        const isStart = vi === 0;
        const isEnd = vi === visible.length - 1;
        const fillColor = isStart
          ? "hsl(136, 42%, 42%)"
          : isEnd
            ? "hsl(8, 65%, 54%)"
            : isActive
              ? "hsl(180, 20%, 35%)"
              : "hsl(220, 10%, 70%)";
        const name = getLocalizedWaypointName(w, lang, safeIndex);
        const sequenceHeading = getVisibleStopsLegendHeading(vi, visible.length, lang);
        const articleTitle = associatedArticle
          ? lang === "en"
            ? associatedArticle.title_en
            : associatedArticle.title_it || associatedArticle.title_en
          : "";
        const routeStrokeColor = getVoyageStrokeColor(voyage, "base");
        const voyageIsBookable = isVoyageBookableNow(voyage);
        const voyageBookingLegs = voyageIsBookable ? bookingLegsByVoyage[voyage.id] || [] : [];
        const waypointIndexById = new Map(wps.map((waypoint, index) => [waypoint.id, index]));
        const hasOutboundAvailability = voyageBookingLegs.some((leg) => {
          const startIndex = waypointIndexById.get(leg.from_waypoint_id);
          return leg.available && startIndex != null && startIndex >= safeIndex;
        });
        const hasInboundAvailability = voyageBookingLegs.some((leg) => {
          const endIndex = waypointIndexById.get(leg.to_waypoint_id);
          return leg.available && endIndex != null && endIndex <= safeIndex;
        });
        const hasCurrentLegFromHere = voyageBookingLegs.some((leg) => {
          if (!isLegCurrentOrFuture(leg)) return false;
          const startIndex = waypointIndexById.get(leg.from_waypoint_id);
          const endIndex = waypointIndexById.get(leg.to_waypoint_id);
          return (startIndex != null && startIndex >= safeIndex) || (endIndex != null && endIndex <= safeIndex);
        });
        const outboundLeg = voyageBookingLegs.find(
          (leg) => leg.from_waypoint_id === w.id && isLegCurrentOrFuture(leg)
        );
        items.push({
          key: `${voyage.id}:${w.id}`,
          lng: w.lng,
          lat: w.lat,
          voyageId: voyage.id,
          waypoint: w,
          sequenceHeading,
          name,
          articleTitle,
          fillColor,
          routeStrokeColor,
          isBookableVoyage: voyageIsBookable,
          hasOutboundAvailability,
          hasInboundAvailability,
          hasAnyBookingLeg: voyageBookingLegs.length > 0,
          hasCurrentLegFromHere,
          outboundLeg: outboundLeg ?? null,
        });
      }
    }
    return items;
  }, [publishedVoyages, waypointsMap, articlesForMap, lang, bookingLegsByVoyage]);

  const waypointClusterIndexRef = useRef<Supercluster | null>(null);
  const mapWaypointsByKeyRef = useRef<Map<string, (typeof mapWaypointClusterInputs)[0]>>(new Map());
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const runWaypointMarkersSyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (mapUnavailable) {
      onMapUnavailable?.();
    }
  }, [mapUnavailable, onMapUnavailable]);

  const clearInteractiveLayerHandlers = useCallback((map: maplibregl.Map) => {
    Object.entries(lineLayerHandlersRef.current).forEach(([layerId, handlers]) => {
      map.off("click", layerId, handlers.click);
      map.off("mouseenter", layerId, handlers.mouseenter);
      map.off("mouseleave", layerId, handlers.mouseleave);
    });
    lineLayerHandlersRef.current = {};

    Object.entries(waypointLayerHandlersRef.current).forEach(([layerId, handlers]) => {
      map.off("mouseenter", layerId, handlers.mouseenter);
      map.off("mousemove", layerId, handlers.mousemove);
      map.off("mouseleave", layerId, handlers.mouseleave);
    });
    waypointLayerHandlersRef.current = {};
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  const clearPresenceMarkers = useCallback(() => {
    presencePopupRef.current?.remove();
    presencePopupRef.current = null;
    presenceMarkersRef.current.forEach((marker) => marker.remove());
    presenceMarkersRef.current = [];
  }, []);

  // Keep refs in sync
  onArticleClickRef.current = onArticleClick;
  onVoyageSelectRef.current = onVoyageSelect;

  useEffect(() => {
    if (controlledRouteVoyageId !== undefined) {
      setHoveredRouteVoyageId(controlledRouteVoyageId);
    }
  }, [controlledRouteVoyageId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      setMapLoaded(false);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: createCartoRasterStyle(),
        center: [15, 40],
        zoom: 5,
        attributionControl: false,
      });

      map.on("load", () => {
        setMapLoaded(true);
        requestMapResize(map);
      });

      map.on("webglcontextlost", () => {
        setMapLoaded(false);
      });

      map.on("webglcontextrestored", () => {
        requestMapResize(map);
      });

      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("click", (e) => {
        const point = e.point;
        queueMicrotask(() => {
          const hitLayerIds = Object.keys(lineLayerHandlersRef.current);
          const features =
            hitLayerIds.length > 0 ? map.queryRenderedFeatures(point, { layers: hitLayerIds }) : [];
          if (features.length === 0) {
            setHoveredRouteVoyageId(null);
            onVoyageSelectRef.current?.(null);
          }
        });
      });

      mapResizeCleanupRef.current = bindMapToContainerResize(map, containerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize voyage map", error);
      popupRef.current?.remove();
      popupRef.current = null;
      waypointPopupPersistentRef.current = false;
      clearPresenceMarkers();
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      waypointMarkersRef.current.forEach((marker) => marker.remove());
      waypointMarkersRef.current = [];
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      setMapLoaded(false);
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      clearPresenceMarkers();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      waypointMarkersRef.current.forEach((marker) => marker.remove());
      waypointMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearInteractiveLayerHandlers, clearPresenceMarkers, mapUnavailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToWaypointRef) return;

    flyToWaypointRef.current = (lat: number, lng: number, popupLabel?: string) => {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 10), duration: 1200 });

      popupRef.current?.remove();
      popupRef.current = null;

      if (popupLabel) {
        const popup = new maplibregl.Popup({
          offset: 12,
          closeButton: true,
          closeOnClick: true,
          maxWidth: "260px",
        });

        const popupHtml = `
          <div style="display:grid;gap:4px;font-family:var(--font-sans);min-width:120px;max-width:240px;">
            <strong style="font-size:12px;line-height:1.35;color:hsl(220,40%,15%);">${escapePopupHtml(popupLabel)}</strong>
          </div>
        `;

        popup.setLngLat([lng, lat]).setHTML(popupHtml);

        map.once("moveend", () => {
          popup.addTo(map);
        });

        popupRef.current = popup;
      }
    };

    return () => {
      flyToWaypointRef.current = null;
    };
  }, [flyToWaypointRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (disableInteractions) {
      setHoveredRouteVoyageId(null);
    }

    const handlers = [
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.dragPan,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];

    handlers.forEach((handler) => {
      if (disableInteractions) {
        handler.disable();
      } else {
        handler.enable();
      }
    });

    map.getCanvas().style.pointerEvents = disableInteractions ? "none" : "auto";
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = disableInteractions ? "none" : "auto";
      containerRef.current.style.touchAction = disableInteractions ? "none" : "auto";
    }
  }, [disableInteractions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clearPresenceMarkers();

    const locale = lang === "it" ? "it-IT" : "en-US";
    const updatedLabel = lang === "it" ? "Aggiornato" : "Updated";

    presenceMarkers.forEach((marker) => {
      const element = createPresenceMarkerElement(marker);
      const markerInstance = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map);

      const showPopup = () => {
        presencePopupRef.current?.remove();
        presencePopupRef.current = null;

        const updatedAtLabel = buildMapPresenceTooltipTimestamp(marker.updatedAt, locale);
        const popupHtml = `
          <div style="display:grid;gap:6px;min-width:170px;max-width:240px;font-family:var(--font-sans);">
            <strong style="font-size:12px;line-height:1.35;color:hsl(220,40%,15%);">${escapePopupHtml(marker.title)}</strong>
            ${
              marker.description
                ? `<p style="margin:0;font-size:12px;line-height:1.5;color:hsl(220,18%,28%);">${escapePopupHtml(marker.description)}</p>`
                : ""
            }
            ${
              updatedAtLabel
                ? `<span style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:hsl(220,10%,45%);">${escapePopupHtml(updatedLabel)} ${escapePopupHtml(updatedAtLabel)}</span>`
                : ""
            }
          </div>
        `;

        const popup = new maplibregl.Popup({
          offset: 18,
          closeButton: false,
          closeOnClick: true,
          maxWidth: "260px",
        });

        popup.setLngLat([marker.longitude, marker.latitude]).setHTML(popupHtml).addTo(map);
        presencePopupRef.current = popup;
      };

      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showPopup();
      });

      element.addEventListener("focus", showPopup);
      presenceMarkersRef.current.push(markerInstance);
    });

    return () => {
      clearPresenceMarkers();
    };
  }, [clearPresenceMarkers, lang, presenceMarkers]);

  // Draw voyage routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const getCachedGeometryCoordinates = (voyage: Voyage) => {
        const coordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        return Array.isArray(coordinates) ? coordinates : [];
      };

      const activeArticle =
        articlesForMap.find((article) => article.id === selectedArticleId) || null;
      const activeArticleFocus = activeArticle ? getArticleVoyageFocus(activeArticle) : null;
      const routeFocusVoyageId = activeArticleFocus?.voyageId || highlightedVoyageId || null;
      const hoverFocusVoyageId = routeFocusVoyageId ? null : hoveredRouteVoyageId;

      clearInteractiveLayerHandlers(map);

      const style = map.getStyle();
      if (style) {
        [...style.layers].reverse().forEach((l) => {
          if (l.id.startsWith("voyage-")) {
            map.removeLayer(l.id);
          }
        });

        Object.keys(style.sources).forEach((sourceId) => {
          if (sourceId.startsWith("voyage-") && map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        });
      }

      publishedVoyages.forEach((voyage) => {
        const wps = waypointsMap[voyage.id] || [];
        if (!wps.length) return;

        const routeArticleFocus =
          activeArticle && activeArticle.voyage_id === voyage.id ? getArticleVoyageFocus(activeArticle, wps) : null;

        const isFocused = routeFocusVoyageId === voyage.id;
        const isHovered = hoverFocusVoyageId === voyage.id;
        const isActive = voyage.status === "active";
        const hasComparisonFocus = Boolean(routeFocusVoyageId || hoverFocusVoyageId);
        const isDimmed = hasComparisonFocus && !isFocused && !isHovered;
        const baseColor = getVoyageStrokeColor(voyage, "base");
        const focusColor = getVoyageStrokeColor(voyage, "focus");

        const routeCoordinates = getVoyageMapLineStringCoordinates(voyage, wps, articlesForMap);

        const lineId = `voyage-line-${voyage.id}`;
        const lineCasingId = `voyage-line-casing-${voyage.id}`;
        const lineHitId = `voyage-hit-${voyage.id}`;
        if (routeCoordinates.length >= 2) {
          map.addSource(lineId, {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: routeCoordinates,
              },
              properties: {},
            },
          });

          const lineMetrics = getVoyageLineMetrics(voyage, {
            isFocused,
            isHovered,
            isDimmed,
            activeArticleFocusMode: routeArticleFocus ? (routeArticleFocus.mode === "none" ? null : routeArticleFocus.mode) : null,
          });

          map.addLayer({
            id: lineCasingId,
            type: "line",
            source: lineId,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": getVoyageStatusCasingColor(voyage),
              "line-width": lineMetrics.casingWidth,
              "line-opacity": lineMetrics.casingOpacity,
              ...(voyage.status === "planned" ? { "line-dasharray": [2.6, 3.4] } : {}),
            },
          });

          map.addLayer({
            id: lineId,
            type: "line",
            source: lineId,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": baseColor,
              "line-width": lineMetrics.width,
              "line-opacity": lineMetrics.opacity,
              ...(getVoyageStatusDashArray(voyage) ? { "line-dasharray": getVoyageStatusDashArray(voyage) } : {}),
            },
          });

          map.addLayer({
            id: lineHitId,
            type: "line",
            source: lineId,
            paint: {
              "line-color": baseColor,
              "line-width": 30,
              "line-opacity": 0,
            },
          });

          const lineHandlers = {
            click: (e: maplibregl.MapLayerMouseEvent) => {
              e.originalEvent.stopPropagation();
              const isAlready = hoveredRouteVoyageIdRef.current === voyage.id;
              const nextId = isAlready ? null : voyage.id;
              setHoveredRouteVoyageId(nextId);
              onVoyageSelectRef.current?.(nextId);
            },
            mouseenter: () => {
              map.getCanvas().style.cursor = "pointer";
            },
            mouseleave: () => {
              map.getCanvas().style.cursor = "";
            },
          };

          lineLayerHandlersRef.current[lineHitId] = lineHandlers;
          map.on("click", lineHitId, lineHandlers.click);
          map.on("mouseenter", lineHitId, lineHandlers.mouseenter);
          map.on("mouseleave", lineHitId, lineHandlers.mouseleave);
        }

        if (routeArticleFocus?.voyageId === voyage.id) {
          if (routeArticleFocus.mode === "voyage" && routeCoordinates.length >= 2) {
            const focusLineId = `voyage-line-focus-${voyage.id}`;
            map.addSource(focusLineId, {
              type: "geojson",
              data: {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: routeCoordinates,
                },
                properties: {},
              },
            });

            map.addLayer({
              id: focusLineId,
              type: "line",
              source: focusLineId,
              paint: {
                "line-color": focusColor,
                "line-width": Math.max(1.8, 7 * getVoyageLineWidthScale(voyage)),
                "line-opacity": 0.96,
              },
            });
          }

          if (
            routeArticleFocus.mode === "segment" &&
            routeArticleFocus.startIndex != null &&
            routeArticleFocus.endIndex != null
          ) {
            const focusSegmentCoordinates = getArticleSegmentGeometry(
              wps,
              voyage.type,
              routeArticleFocus.startIndex,
              routeArticleFocus.endIndex,
              getCachedGeometryCoordinates(voyage)
            );

            if (focusSegmentCoordinates.length >= 2) {
              const focusSegmentId = `voyage-line-focus-${voyage.id}`;
              map.addSource(focusSegmentId, {
                type: "geojson",
                data: {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: focusSegmentCoordinates,
                  },
                  properties: {},
                },
              });

              map.addLayer({
                id: focusSegmentId,
                type: "line",
                source: focusSegmentId,
                paint: {
                  "line-color": focusColor,
                  "line-width": Math.max(1.8, 7 * getVoyageLineWidthScale(voyage)),
                  "line-opacity": 0.96,
                },
              });
            }
          }
        }

        /* Waypoint visibili: cluster HTML (effect separato), non layer circle */

        if (
          routeArticleFocus?.voyageId === voyage.id &&
          routeArticleFocus.mode === "point" &&
          routeArticleFocus.startIndex != null &&
          wps.length
        ) {
          const focusPointIndex = clampWaypointIndex(routeArticleFocus.startIndex, wps.length - 1);
          const focusWaypoint = wps[focusPointIndex];
          const focusPointId = `voyage-point-focus-${voyage.id}`;

          if (focusWaypoint) {
            map.addSource(focusPointId, {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: [{
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [focusWaypoint.lng, focusWaypoint.lat],
                  },
                  properties: {},
                }],
              },
            });

            map.addLayer({
              id: focusPointId,
              type: "circle",
              source: focusPointId,
              paint: {
                "circle-radius": 8,
                "circle-color": focusColor,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#fff",
              },
            });
          }
        }
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.once("load", draw);
    }

    return () => {
      map.off("load", draw);
    };
  }, [
    articlesForMap,
    bookingLegsByVoyage,
    clearInteractiveLayerHandlers,
    highlightedVoyageId,
    hoveredRouteVoyageId,
    lang,
    publishedVoyages,
    selectedArticleId,
    waypointsMap,
  ]);

  // Waypoint pubblici (tutti i viaggi): cluster leggeri, distinti dagli articoli
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const index = new Supercluster({
      radius: 56,
      maxZoom: 22,
      minPoints: 2,
      minZoom: 0,
    });

    index.load(
      mapWaypointClusterInputs.map((item) => ({
        type: "Feature" as const,
        properties: { id: item.key },
        geometry: {
          type: "Point" as const,
          coordinates: [item.lng, item.lat] as [number, number],
        },
      }))
    );

    waypointClusterIndexRef.current = index;
    mapWaypointsByKeyRef.current = new Map(mapWaypointClusterInputs.map((i) => [i.key, i]));

    const showWaypointPopup = (
      coords: [number, number],
      meta: (typeof mapWaypointClusterInputs)[0],
      persist = false
    ) => {
      if (!meta.name && !meta.sequenceHeading) return;
      waypointPopupPersistentRef.current = persist;
      const L = langRef.current;
      const routeColor = meta.routeStrokeColor;
      const articleBlock = meta.articleTitle
        ? buildPopupModule(
            "article",
            L === "it" ? "Articolo" : "Article",
            `<div class="voyage-popup__module-title">${escapePopupHtml(meta.articleTitle)}</div>`
          )
        : "";
      const mediaBlock = buildPopupMediaModule(meta.waypoint, L === "it" ? "Media tappa" : "Stop media");
      const complexityChip = meta.outboundLeg ? buildComplexityChipMarkup(meta.outboundLeg, L) : "";
      const canBookFrom = meta.isBookableVoyage && meta.hasOutboundAvailability;
      const canBookTo = meta.isBookableVoyage && meta.hasInboundAvailability;
      const hasBookingAction = canBookFrom || canBookTo;
      // A leg is "completed" once every leg touching this stop is in the past — at that point
      // the complexity estimate and booking module are no longer relevant and must not show.
      const isPastCompleted = meta.hasAnyBookingLeg && !meta.hasCurrentLegFromHere;
      const bookingHint = !meta.hasAnyBookingLeg
        ? `<p class="voyage-popup__hint">${L === "it" ? "Prenotazioni non ancora aperte per questa tappa." : "Bookings are not open for this stop yet."}</p>`
        : !canBookFrom && !canBookTo
          ? `<p class="voyage-popup__hint">${L === "it" ? "Scegli un'altra tappa sulla stessa rotta per verificare le tratte disponibili." : "Choose another stop on the same route to check available legs."}</p>`
          : "";
      const bookableBlock = meta.isBookableVoyage && !isPastCompleted
        ? buildPopupModule(
            "booking",
            L === "it" ? "Viaggio prenotabile" : "Bookable voyage",
            `${complexityChip}`
            + `${hasBookingAction ? `<div class="voyage-popup__actions">
              <button type="button" class="voyage-popup__action" data-booking-direction="from" ${canBookFrom ? "" : "disabled"}>${L === "it" ? "Prenota da qui" : "Book from here"}</button>
              <button type="button" class="voyage-popup__action" data-booking-direction="to" ${canBookTo ? "" : "disabled"}>${L === "it" ? "Prenota fino a qui" : "Book to here"}</button>
            </div>` : ""}`
            + bookingHint
          )
        : "";
      const popupHtml = `
        <div class="voyage-popup" style="--voyage-popup-accent:${routeColor};">
          <div class="voyage-popup__header">
            ${meta.sequenceHeading ? `<span class="voyage-popup__badge">${escapePopupHtml(meta.sequenceHeading)}</span>` : ""}
            <div class="voyage-popup__title">${escapePopupHtml(meta.name || "—")}</div>
          </div>
          <div class="voyage-popup__body">
            ${mediaBlock}
            ${articleBlock}
            ${bookableBlock}
          </div>
        </div>
      `;
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          offset: 14,
          closeButton: true,
          closeOnClick: false,
          closeOnMove: false,
          maxWidth: "340px",
          className: "voyage-waypoint-popup",
        });
      }
      const p = popupRef.current;
      p.setLngLat(coords).setHTML(popupHtml).addTo(map);
      p.getElement().querySelectorAll<HTMLButtonElement>("[data-booking-direction]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const direction = button.dataset.bookingDirection === "to" ? "to" : "from";
          onWaypointBookingActionRef.current?.(meta.voyageId, meta.waypoint.id, direction);
        });
      });
      const popupRoot = p.getElement();
      if (popupRoot?.parentElement) {
        popupRoot.parentElement.appendChild(popupRoot);
      }
    };

    const syncWaypointMarkers = () => {
      const sc = waypointClusterIndexRef.current;
      if (!sc) return;

      waypointMarkersRef.current.forEach((m) => m.remove());
      waypointMarkersRef.current = [];

      const bounds = map.getBounds();
      const zoom = Math.floor(map.getZoom());
      const clusters = sc.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom
      );

      const markerFocusVoyageId =
        highlightedVoyageIdRef.current || hoveredRouteVoyageIdRef.current || null;

      clusters.forEach((feature) => {
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          id?: string;
        };

        if (props.cluster === true) {
          const el = document.createElement("div");
          el.style.cssText = `
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            z-index:4;pointer-events:auto;
            min-width:22px;height:22px;padding:0 5px;border-radius:9999px;
            background:hsla(210, 18%, 96%, 0.96);color:hsl(220, 20%, 34%);
            font-size:10.5px;font-weight:600;font-family:var(--font-sans);
            box-shadow:0 1px 4px rgba(15,23,42,0.12);
            border:1px solid hsl(220, 14%, 82%);
          `;
          el.textContent = String(props.point_count ?? "");
          el.title =
            langRef.current === "it"
              ? `${props.point_count ?? ""} scali vicini`
              : `${props.point_count ?? ""} nearby stops`;
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cid = props.cluster_id;
            if (cid == null) return;
            const expansionZoom = Math.min(sc.getClusterExpansionZoom(cid), 19);
            map.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: 420 });
          });
          waypointMarkersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          );
          return;
        }

        const meta = mapWaypointsByKeyRef.current.get(String(props.id));
        if (!meta) return;

        const isDimmed = Boolean(
          markerFocusVoyageId && meta.voyageId !== markerFocusVoyageId
        );
        const isBookingAnchor =
          bookingSelectionAnchorRef.current?.voyageId === meta.voyageId &&
          bookingSelectionAnchorRef.current?.waypointId === meta.waypoint.id;
        const size = 17;
        const el = document.createElement("div");
        el.style.cssText = `cursor:pointer;z-index:4;display:flex;align-items:center;justify-content:center;opacity:${isDimmed ? "0.38" : "1"};transition:opacity 0.2s ${MAP_MARKER_EASE};`;

        const dot = document.createElement("div");
        dot.style.cssText = `
          width:${size}px;height:${size}px;border-radius:50%;
          border:${isBookingAnchor ? "3px" : meta.isBookableVoyage ? "2.5px" : "1.5px"} solid ${isBookingAnchor ? "hsl(142,72%,35%)" : meta.isBookableVoyage ? "hsl(152,58%,44%)" : "hsl(0,0%,100%)"};
          background:${meta.fillColor};
          box-shadow:${isBookingAnchor ? "0 0 0 4px hsla(142,72%,35%,0.2),0 2px 9px rgba(15,23,42,0.18)" : meta.isBookableVoyage ? "0 0 0 4px hsla(152,58%,44%,0.16),0 2px 8px rgba(15,23,42,0.16)" : "0 1px 5px rgba(15,23,42,0.14)"};
          transition:transform 0.2s ${MAP_MARKER_EASE};
        `;
        el.appendChild(dot);

        const coords: [number, number] = [lng, lat];
        const markerWrap = (): HTMLElement | null => {
          const w = el.closest(".maplibregl-marker") ?? el.parentElement;
          return w instanceof HTMLElement ? w : null;
        };

        el.addEventListener("mouseenter", () => {
          dot.style.transform = "scale(1.12)";
          el.style.opacity = "1";
          const wrap = markerWrap();
          if (wrap) wrap.style.zIndex = "80";
          showWaypointPopup(coords, meta, false);
        });
        el.addEventListener("mouseleave", () => {
          dot.style.transform = "scale(1)";
          if (isDimmed) el.style.opacity = "0.38";
          const wrap = markerWrap();
          if (wrap) wrap.style.zIndex = "";
          if (!waypointPopupPersistentRef.current) {
            popupRef.current?.remove();
            popupRef.current = null;
          }
        });
        el.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          dot.style.transform = "scale(1.12)";
          showWaypointPopup(coords, meta, true);
        });

        waypointMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat(coords)
            .addTo(map)
        );
      });
    };

    runWaypointMarkersSyncRef.current = syncWaypointMarkers;

    let zoomRafWp = 0;
    const scheduleWpZoom = () => {
      if (zoomRafWp) return;
      zoomRafWp = window.requestAnimationFrame(() => {
        zoomRafWp = 0;
        syncWaypointMarkers();
      });
    };

    const onMoveEndWp = () => syncWaypointMarkers();
    map.on("moveend", onMoveEndWp);
    map.on("zoomend", onMoveEndWp);
    map.on("zoom", scheduleWpZoom);

    if (map.isStyleLoaded()) {
      syncWaypointMarkers();
    } else {
      map.once("load", syncWaypointMarkers);
    }

    return () => {
      if (zoomRafWp) window.cancelAnimationFrame(zoomRafWp);
      map.off("moveend", onMoveEndWp);
      map.off("zoomend", onMoveEndWp);
      map.off("zoom", scheduleWpZoom);
      map.off("load", syncWaypointMarkers);
      waypointMarkersRef.current.forEach((m) => m.remove());
      waypointMarkersRef.current = [];
      waypointClusterIndexRef.current = null;
      runWaypointMarkersSyncRef.current = () => {};
    };
  }, [mapWaypointClusterInputs]);

  useEffect(() => {
    runWaypointMarkersSyncRef.current();
  }, [bookingSelectionAnchor, highlightedVoyageId, hoveredRouteVoyageId]);

  // Articoli sulla mappa: Supercluster + marker (stesso stile di prima)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const index = new Supercluster({
      radius: 96,
      maxZoom: 22,
      minPoints: 2,
      minZoom: 0,
    });

    index.load(
      positionedArticles.map((article) => ({
        type: "Feature" as const,
        properties: { id: article.id },
        geometry: {
          type: "Point" as const,
          coordinates: [article.displayLng, article.displayLat] as [number, number],
        },
      }))
    );

    clusterIndexRef.current = index;
    articlesByIdRef.current = new Map(positionedArticles.map((a) => [a.id, a]));

    const syncMarkers = () => {
      const sc = clusterIndexRef.current;
      if (!sc) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const bounds = map.getBounds();
      const zoom = Math.floor(map.getZoom());
      const clusters = sc.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom
      );

      const markerFocusVoyageId =
        highlightedVoyageIdRef.current || hoveredRouteVoyageIdRef.current || null;
      const L = langRef.current;

      clusters.forEach((feature) => {
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          id?: string;
        };

        if (props.cluster === true) {
          const el = document.createElement("div");
          el.style.cssText = `
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            z-index:6;pointer-events:auto;
            min-width:36px;min-height:36px;padding:0 8px;border-radius:9999px;
            background:hsl(220,40%,22%);color:#fff;font-size:13px;font-weight:700;
            font-family:var(--font-sans);box-shadow:0 2px 10px rgba(0,0,0,0.25);
            border:2px solid #fff;
          `;
          el.textContent = String(props.point_count ?? "");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cid = props.cluster_id;
            if (cid == null) return;
            const expansionZoom = Math.min(sc.getClusterExpansionZoom(cid), 18);
            map.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: 450 });
          });
          markersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          );
          return;
        }

        const article = articlesByIdRef.current.get(String(props.id));
        if (!article) return;

        const isSelected = article.id === selectedArticleIdRef.current;
        const isHovered = article.id === hoveredArticleIdRef.current;
        const isFocused = isSelected || isHovered;
        const isDimmed = Boolean(
          markerFocusVoyageId && article.voyage_id !== markerFocusVoyageId && !isFocused
        );
        const title = L === "en" ? article.title_en : article.title_it || article.title_en;
        const size = isFocused ? 56 : isDimmed ? 38 : 44;

        const el = document.createElement("div");
        el.className = "voyage-marker-wrap";
        el.style.cssText = `cursor:pointer;z-index:6;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:${isDimmed ? "0.32" : "1"};transition:opacity 0.25s ${MAP_MARKER_EASE};`;

        const circle = document.createElement("div");
        circle.style.cssText = `
          width:${size}px;height:${size}px;border-radius:50%;
          border:3px solid ${isFocused ? "hsl(180,20%,35%)" : "#fff"};
          background:${article.cover_image ? `url(${article.cover_image}) center/cover` : "hsl(220,40%,15%)"};
          box-shadow:${isFocused ? "0 0 0 3px hsla(180,20%,35%,0.3),0 4px 12px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.25)"};
          transition:opacity 0.3s ${MAP_MARKER_EASE}, transform 0.3s ${MAP_MARKER_EASE}, box-shadow 0.3s ${MAP_MARKER_EASE};
        `;

        const label = document.createElement("div");
        label.textContent = title;
        label.title = title;
        const labelBase = `
          font-family:var(--font-sans);font-size:11px;font-weight:500;line-height:1.35;
          color:hsl(220,40%,15%);background:hsla(40,20%,97%,0.95);
          padding:6px 10px;border-radius:4px;
          box-shadow:0 2px 10px rgba(0,0,0,0.12);
          max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          text-align:center;pointer-events:none;
          opacity:${isFocused ? "1" : "0"};transition:opacity 0.2s ${MAP_MARKER_EASE}, max-width 0.2s ${MAP_MARKER_EASE}, box-shadow 0.2s ${MAP_MARKER_EASE};
        `;
        label.style.cssText = labelBase;
        if (isFocused) {
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        }

        el.appendChild(circle);
        el.appendChild(label);

        el.addEventListener("mouseenter", () => {
          circle.style.transform = "scale(1.1)";
          el.style.opacity = "1";
          label.style.opacity = "1";
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        });
        el.addEventListener("mouseleave", () => {
          if (
            article.id !== selectedArticleIdRef.current &&
            article.id !== hoveredArticleIdRef.current
          ) {
            circle.style.transform = "scale(1)";
            el.style.opacity = isDimmed ? "0.32" : "1";
            label.style.opacity = "0";
            label.style.maxWidth = "120px";
            label.style.whiteSpace = "nowrap";
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";
          }
        });

        el.addEventListener("click", () => {
          onArticleClickRef.current?.(article);
        });

        markersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lng, lat])
            .addTo(map)
        );
      });
    };

    runArticleMarkersSyncRef.current = syncMarkers;

    let zoomRaf = 0;
    const scheduleSyncFromZoom = () => {
      if (zoomRaf) return;
      zoomRaf = window.requestAnimationFrame(() => {
        zoomRaf = 0;
        syncMarkers();
      });
    };

    const onMoveEnd = () => syncMarkers();
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);
    map.on("zoom", scheduleSyncFromZoom);

    if (map.isStyleLoaded()) {
      syncMarkers();
    } else {
      map.once("load", syncMarkers);
    }

    return () => {
      if (zoomRaf) window.cancelAnimationFrame(zoomRaf);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onMoveEnd);
      map.off("zoom", scheduleSyncFromZoom);
      map.off("load", syncMarkers);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      clusterIndexRef.current = null;
      runArticleMarkersSyncRef.current = () => {};
    };
  }, [positionedArticles]);

  useEffect(() => {
    runArticleMarkersSyncRef.current();
  }, [selectedArticleId, hoveredArticleId, highlightedVoyageId, hoveredRouteVoyageId, lang]);

  // Fly to selected article with smart bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedArticleId) return;
    const article = articles.find((a) => a.id === selectedArticleId);
    if (!article) return;

    // If article has segment bounds, fit to segment (indici risolti da UUID se presenti)
    const segmentRange =
      article.voyage_id ? resolveArticleRouteRange(article, waypointsMap[article.voyage_id] || []) : null;
    if (article.voyage_id && segmentRange) {
      const wps = waypointsMap[article.voyage_id] || [];
      const start = segmentRange[0];
      const end = segmentRange[1];
      const segWps = wps.slice(start, end + 1);
      if (segWps.length >= 2) {
        const bounds = segWps.reduce(
          (b, w) => b.extend([w.lng, w.lat]),
          new maplibregl.LngLatBounds([segWps[0].lng, segWps[0].lat], [segWps[0].lng, segWps[0].lat])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 });
        return;
      }
      if (segWps.length === 1) {
        map.flyTo({ center: [segWps[0].lng, segWps[0].lat], zoom: 10, duration: 1200 });
        return;
      }
    }

    // If full voyage
    if (article.voyage_id && !segmentRange) {
      const wps = waypointsMap[article.voyage_id] || [];
      if (wps.length >= 2) {
        const bounds = wps.reduce(
          (b, w) => b.extend([w.lng, w.lat]),
          new maplibregl.LngLatBounds([wps[0].lng, wps[0].lat], [wps[0].lng, wps[0].lat])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 });
        return;
      }
      if (wps.length === 1) {
        map.flyTo({ center: [wps[0].lng, wps[0].lat], zoom: 10, duration: 1200 });
        return;
      }
    }

    // Single point
    if (article.latitude && article.longitude) {
      map.flyTo({ center: [article.longitude, article.latitude], zoom: 10, duration: 1200 });
    }
  }, [selectedArticleId, articles, waypointsMap]);

  // Fit bounds on initial load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initialFitReady || hasPerformedInitialFitRef.current) return;

    const isValidLngLat = (value: unknown): value is [number, number] =>
      Array.isArray(value) &&
      value.length >= 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]);

    const fit = () => {
      const points: [number, number][] = [];
      publishedVoyages.forEach((voyage) => {
        const geometryCoordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        geometryCoordinates?.forEach((coordinate) => {
          if (isValidLngLat(coordinate)) {
            points.push(coordinate);
          }
        });
      });
      publishedVoyages.forEach((v) => {
        const wps = waypointsMap[v.id] || [];
        wps.forEach((w) => {
          if (Number.isFinite(w.lat) && Number.isFinite(w.lng)) {
            points.push([w.lng, w.lat]);
          }
        });
      });
      articlesForMap.forEach((a) => {
        if (Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) {
          points.push([a.longitude, a.latitude]);
        }
      });
      positionedArticles.forEach((a) => {
        points.push([a.displayLng, a.displayLat]);
      });

      try {
        if (points.length >= 2) {
          hasPerformedInitialFitRef.current = true;
          const bounds = points.reduce(
            (b, p) => b.extend(p),
            new maplibregl.LngLatBounds(points[0], points[0])
          );
          map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
        } else if (points.length === 1) {
          hasPerformedInitialFitRef.current = true;
          map.flyTo({ center: points[0], zoom: 8 });
        }
      } catch (error) {
        console.error("Failed to fit initial voyage bounds", error);
      }
    };

    if (map.isStyleLoaded()) {
      fit();
    } else {
      map.once("load", fit);
    }
  }, [initialFitReady, publishedVoyages, waypointsMap, articlesForMap, positionedArticles]);

  if (mapUnavailable) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_top,hsl(var(--muted))_0%,transparent_60%)] px-6 text-center">
        <div className="max-w-md space-y-3">
          <p className="text-sm font-sans text-muted-foreground">
            {lang === "it"
              ? "La mappa non è disponibile su questo dispositivo o browser. Passa alla vista lista per continuare."
              : "The map is unavailable on this device or browser. Switch to list view to keep browsing."}
          </p>
          {onMapUnavailable ? (
            <button
              type="button"
              onClick={onMapUnavailable}
              className="inline-flex items-center justify-center rounded-full border border-white/60 bg-background/80 px-4 py-2 text-xs font-sans text-foreground shadow-lg transition-colors duration-interaction ease-out-expo hover:bg-background active:scale-[0.98]"
            >
              {lang === "it" ? "Apri vista lista" : "Open list view"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" aria-busy={!mapLoaded}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {!mapLoaded && !mapUnavailable ? (
        <MapLoadingPlaceholder label={lang === "it" ? "Caricamento mappa" : "Loading map"} />
      ) : null}
    </div>
  );
};

export default VoyageMap;
