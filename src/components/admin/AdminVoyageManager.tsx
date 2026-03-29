import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus,
  Edit,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Ship,
  Mountain,
  Eye,
  EyeOff,
  LocateFixed,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  totalWaypointDistance,
  reverseGeocodePlace,
  buildWaypointDefaultName,
  formatWaypointCoordinateLabel,
  buildVoyageGeometry,
  getStraightVoyageGeometry,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

interface VoyageFormState {
  name: string;
  description: string;
  type: "water" | "land";
  status: "planned" | "active" | "completed";
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
}

const emptyVoyageForm: VoyageFormState = {
  name: "",
  description: "",
  type: "water",
  status: "planned",
  start_date: "",
  start_time: "",
  end_date: "",
  end_time: "",
};

const popupLabelStyle = "display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:hsl(220,10%,45%);margin-bottom:6px;font-family:var(--font-sans);";
const popupInputStyle = "width:100%;padding:8px 10px;border:1px solid hsl(var(--border));background:hsl(var(--background));font-size:12px;font-family:var(--font-sans);outline:none;";
const popupHintStyle = "font-size:11px;line-height:1.45;color:hsl(220,10%,45%);font-family:var(--font-sans);";

const sortWaypoints = (waypoints: VoyageWaypoint[]) =>
  [...waypoints].sort((a, b) => a.sort_order - b.sort_order);

const getNextWaypointOrder = (waypoints: VoyageWaypoint[]) =>
  waypoints.length ? Math.max(...waypoints.map((waypoint) => waypoint.sort_order)) + 1 : 0;

const getErrorMessage = (error: { message?: string | null } | null, fallback: string) =>
  error?.message || fallback;

const isMissingWaypointMetadataColumnError = (
  error: { message?: string | null; details?: string | null; hint?: string | null } | null
) => {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return ["waypoint_type", "date_start", "date_end"].some((column) => text.includes(column)) &&
    (text.includes("column") || text.includes("schema cache"));
};

type VoyageRecord = Record<string, any> &
  Pick<Voyage, "id" | "name" | "type" | "status" | "sort_order" | "created_at" | "updated_at">;

type WaypointRecord = Record<string, any> &
  Pick<VoyageWaypoint, "id" | "voyage_id" | "lat" | "lng" | "sort_order" | "created_at">;

const normalizeWaypoint = (waypoint: WaypointRecord): VoyageWaypoint => ({
  ...waypoint,
  name: waypoint?.name ?? "",
  waypoint_type: waypoint?.waypoint_type === "narrative" ? "narrative" : "technical",
  date_start: waypoint?.date_start ?? null,
  date_end: waypoint?.date_end ?? null,
});

const normalizeVoyage = (voyage: VoyageRecord): Voyage => ({
  ...voyage,
  description: voyage?.description ?? "",
  cached_geometry: voyage?.cached_geometry ?? null,
  start_date: voyage?.start_date ?? null,
  start_time: voyage?.start_time ?? null,
  end_date: voyage?.end_date ?? null,
  end_time: voyage?.end_time ?? null,
});

const formatVoyageDateRange = (voyage: Voyage) => {
  if (!voyage.start_date && !voyage.end_date) return null;
  const start = [voyage.start_date, voyage.start_time].filter(Boolean).join(" ");
  const end = [voyage.end_date, voyage.end_time].filter(Boolean).join(" ");
  if (start && end) return `${start} → ${end}`;
  return start || end;
};

const getCachedGeometryCoordinates = (voyage: Voyage | undefined): [number, number][] => {
  const coordinates = (voyage?.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
  return Array.isArray(coordinates) ? coordinates : [];
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getDistanceToSegmentSquared = (
  point: maplibregl.Point,
  segmentStart: maplibregl.Point,
  segmentEnd: maplibregl.Point
) => {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - segmentStart.x;
    const py = point.y - segmentStart.y;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / (dx * dx + dy * dy)
    )
  );
  const projectedX = segmentStart.x + t * dx;
  const projectedY = segmentStart.y + t * dy;
  const deltaX = point.x - projectedX;
  const deltaY = point.y - projectedY;
  return deltaX * deltaX + deltaY * deltaY;
};

const getNearestSegmentIndex = (
  map: maplibregl.Map,
  point: maplibregl.Point,
  waypoints: VoyageWaypoint[]
) => {
  if (waypoints.length < 2) return null;

  let nearestSegmentIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const segmentStart = map.project([waypoints[index].lng, waypoints[index].lat]);
    const segmentEnd = map.project([waypoints[index + 1].lng, waypoints[index + 1].lat]);
    const distance = getDistanceToSegmentSquared(point, segmentStart, segmentEnd);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestSegmentIndex = index;
    }
  }

  return nearestSegmentIndex;
};

const AdminVoyageManager = () => {
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [waypoints, setWaypoints] = useState<Record<string, VoyageWaypoint[]>>({});
  const [selectedVoyageId, setSelectedVoyageId] = useState<string | null>(null);
  const [showVoyageForm, setShowVoyageForm] = useState(false);
  const [editingVoyage, setEditingVoyage] = useState<Voyage | null>(null);
  const [voyageForm, setVoyageForm] = useState<VoyageFormState>(emptyVoyageForm);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markersByWaypointRef = useRef<Record<string, maplibregl.Marker>>({});
  const voyagesRef = useRef<Voyage[]>([]);
  const waypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const selectedVoyageRef = useRef<string | null>(null);
  const pendingPopupWaypointIdRef = useRef<string | null>(null);
  const geometryRequestRef = useRef<Record<string, number>>({});
  const geometryOverrideRef = useRef<Record<string, [number, number][]>>({});
  const segmentInsertRef = useRef<{ voyageId: string; insertIndex: number } | null>(null);
  const segmentPreviewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routeLineMouseDownRef = useRef<((event: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const routeLineMouseEnterRef = useRef<(() => void) | null>(null);
  const routeLineMouseLeaveRef = useRef<(() => void) | null>(null);
  const suppressMapClickUntilRef = useRef(0);

  const commitVoyages = useCallback((nextVoyages: Voyage[]) => {
    voyagesRef.current = nextVoyages;
    setVoyages(nextVoyages);
  }, []);

  const commitWaypoints = useCallback((voyageId: string, nextWaypoints: VoyageWaypoint[]) => {
    const sorted = sortWaypoints(nextWaypoints);
    const nextMap = { ...waypointsRef.current, [voyageId]: sorted };
    waypointsRef.current = nextMap;
    setWaypoints(nextMap);
    return sorted;
  }, []);

  useEffect(() => {
    selectedVoyageRef.current = selectedVoyageId;
  }, [selectedVoyageId]);

  const fetchVoyages = useCallback(async () => {
    const { data, error } = await supabase.from("voyages").select("*").order("sort_order", { ascending: true });
    if (error) {
      toast.error(getErrorMessage(error, "Unable to load voyages"));
      return;
    }
    commitVoyages((data || []).map((voyage) => normalizeVoyage(voyage)));
  }, [commitVoyages]);

  const fetchWaypoints = useCallback(async (voyageId: string) => {
    const { data, error } = await supabase
      .from("voyage_waypoints")
      .select("*")
      .eq("voyage_id", voyageId)
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error(getErrorMessage(error, "Unable to load waypoints"));
      return [];
    }

    return commitWaypoints(voyageId, (data || []).map((waypoint) => normalizeWaypoint(waypoint)));
  }, [commitWaypoints]);

  useEffect(() => {
    void fetchVoyages();
  }, [fetchVoyages]);

  const removeSegmentPreviewMarker = useCallback(() => {
    segmentPreviewMarkerRef.current?.remove();
    segmentPreviewMarkerRef.current = null;
  }, []);

  const ensureSegmentPreviewMarker = useCallback((map: maplibregl.Map, lng: number, lat: number) => {
    if (!segmentPreviewMarkerRef.current) {
      const previewEl = document.createElement("div");
      previewEl.style.cssText = `
        width:14px;
        height:14px;
        border-radius:999px;
        border:2px solid white;
        background:hsl(42, 95%, 58%);
        box-shadow:0 2px 10px rgba(0,0,0,0.22);
      `;
      segmentPreviewMarkerRef.current = new maplibregl.Marker({ element: previewEl })
        .setLngLat([lng, lat])
        .addTo(map);
      return;
    }

    segmentPreviewMarkerRef.current.setLngLat([lng, lat]);
  }, []);

  const syncVoyageGeometry = useCallback(async (voyageId: string, candidateWaypoints?: VoyageWaypoint[]) => {
    const voyage = voyagesRef.current.find((item) => item.id === voyageId);
    if (!voyage) return;

    const sortedWaypoints = sortWaypoints(candidateWaypoints || waypointsRef.current[voyageId] || []);
    const requestId = (geometryRequestRef.current[voyageId] || 0) + 1;
    geometryRequestRef.current[voyageId] = requestId;

    const coordinates = await buildVoyageGeometry(sortedWaypoints, voyage.type);
    if (geometryRequestRef.current[voyageId] !== requestId) return;

    geometryOverrideRef.current[voyageId] = coordinates;
    const cachedGeometry = coordinates.length >= 2 ? { type: "LineString" as const, coordinates } : null;
    const payload: TablesUpdate<"voyages"> = { cached_geometry: cachedGeometry };
    const { error } = await supabase.from("voyages").update(payload).eq("id", voyageId);

    if (error) {
      console.error("Unable to sync voyage geometry", error);
      return;
    }

    commitVoyages(
      voyagesRef.current.map((item) =>
        item.id === voyageId
          ? normalizeVoyage({ ...item, cached_geometry: cachedGeometry })
          : item
      )
    );
  }, [commitVoyages]);

  const updateWaypoint = useCallback(
    async (
      voyageId: string,
      waypointId: string,
      changes: Partial<VoyageWaypoint>,
      options?: { successMessage?: string | null; syncGeometry?: boolean }
    ) => {
      const payload = changes as TablesUpdate<"voyage_waypoints">;
      const { error } = await supabase.from("voyage_waypoints").update(payload).eq("id", waypointId);
      if (error) {
        toast.error(getErrorMessage(error, "Unable to update waypoint"));
        return false;
      }

      const nextWaypoints = commitWaypoints(
        voyageId,
        (waypointsRef.current[voyageId] || []).map((waypoint) =>
          waypoint.id === waypointId ? normalizeWaypoint({ ...waypoint, ...changes }) : waypoint
        )
      );

      if (options?.syncGeometry) {
        geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(nextWaypoints);
        void syncVoyageGeometry(voyageId, nextWaypoints);
      }

      if (options?.successMessage) {
        toast.success(options.successMessage);
      }

      return true;
    },
    [commitWaypoints, syncVoyageGeometry]
  );

  const insertWaypointAtIndex = useCallback(
    async (voyageId: string, lat: number, lng: number, insertIndex: number) => {
      const currentWaypoints = waypointsRef.current[voyageId] || [];
      const boundedIndex = Math.max(0, Math.min(insertIndex, currentWaypoints.length));
      const provisionalName = buildWaypointDefaultName(boundedIndex, lat, lng);
      const shiftedWaypoints = currentWaypoints.map((waypoint, index) =>
        index >= boundedIndex ? normalizeWaypoint({ ...waypoint, sort_order: index + 1 }) : waypoint
      );

      const shiftedUpdates = shiftedWaypoints.filter(
        (waypoint, index) => waypoint.sort_order !== currentWaypoints[index].sort_order
      );

      if (shiftedUpdates.length) {
        const results = await Promise.all(
          shiftedUpdates.map((waypoint) =>
            supabase.from("voyage_waypoints").update({ sort_order: waypoint.sort_order }).eq("id", waypoint.id)
          )
        );
        const failedResult = results.find((result) => result.error);
        if (failedResult?.error) {
          toast.error(getErrorMessage(failedResult.error, "Unable to insert waypoint"));
          return false;
        }
      }

      const baseData: TablesInsert<"voyage_waypoints"> = {
        voyage_id: voyageId,
        lat,
        lng,
        name: provisionalName,
        sort_order: boundedIndex,
      };
      const metadata: Pick<TablesInsert<"voyage_waypoints">, "waypoint_type"> = { waypoint_type: "technical" };
      const runInsert = (payload: TablesInsert<"voyage_waypoints">) =>
        supabase.from("voyage_waypoints").insert(payload).select().single();

      let { data, error } = await runInsert({ ...baseData, ...metadata });
      if (error && isMissingWaypointMetadataColumnError(error)) {
        ({ data, error } = await runInsert(baseData));
      }

      if (error || !data) {
        toast.error(getErrorMessage(error, "Unable to insert waypoint"));
        return false;
      }

      const createdWaypoint = normalizeWaypoint(data);
      pendingPopupWaypointIdRef.current = createdWaypoint.id;
      const nextWaypoints = commitWaypoints(voyageId, [
        ...shiftedWaypoints.slice(0, boundedIndex),
        createdWaypoint,
        ...shiftedWaypoints.slice(boundedIndex),
      ]);
      geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(nextWaypoints);
      void syncVoyageGeometry(voyageId, nextWaypoints);

      const suggestedPlace = await reverseGeocodePlace(lat, lng);
      if (!suggestedPlace) return true;

      const currentWaypoint = (waypointsRef.current[voyageId] || []).find((item) => item.id === createdWaypoint.id);
      if (!currentWaypoint || currentWaypoint.name !== provisionalName) return true;

      const suggestedName = buildWaypointDefaultName(boundedIndex, lat, lng, suggestedPlace);
      if (suggestedName === provisionalName) return true;

      await updateWaypoint(voyageId, createdWaypoint.id, { name: suggestedName });
      return true;
    },
    [commitWaypoints, syncVoyageGeometry, updateWaypoint]
  );

  const deleteWaypoint = useCallback(
    async (voyageId: string, waypointId: string) => {
      if (!confirm("Delete this waypoint?")) return;

      const { error } = await supabase.from("voyage_waypoints").delete().eq("id", waypointId);
      if (error) {
        toast.error(getErrorMessage(error, "Unable to delete waypoint"));
        return;
      }

      const nextWaypoints = commitWaypoints(
        voyageId,
        (waypointsRef.current[voyageId] || []).filter((waypoint) => waypoint.id !== waypointId)
      );
      geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(nextWaypoints);
      void syncVoyageGeometry(voyageId, nextWaypoints);
      toast.success("Waypoint deleted");
    },
    [commitWaypoints, syncVoyageGeometry]
  );

  const fitMapToWaypoints = useCallback((candidateWaypoints: VoyageWaypoint[]) => {
    const map = mapRef.current;
    if (!map || !candidateWaypoints.length) return;

    if (candidateWaypoints.length === 1) {
      map.flyTo({
        center: [candidateWaypoints[0].lng, candidateWaypoints[0].lat],
        zoom: Math.max(map.getZoom(), 10),
        duration: 500,
      });
      return;
    }

    const bounds = candidateWaypoints.reduce(
      (accumulator, waypoint) => accumulator.extend([waypoint.lng, waypoint.lat]),
      new maplibregl.LngLatBounds(
        [candidateWaypoints[0].lng, candidateWaypoints[0].lat],
        [candidateWaypoints[0].lng, candidateWaypoints[0].lat]
      )
    );

    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 });
  }, []);

  const focusWaypointOnMap = useCallback((waypointId: string) => {
    const marker = markersByWaypointRef.current[waypointId];
    const map = mapRef.current;
    if (!marker || !map) return false;

    const position = marker.getLngLat();
    map.flyTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 8), duration: 500 });
    return true;
  }, []);

  const openWaypointPopup = useCallback((waypointId: string) => {
    const marker = markersByWaypointRef.current[waypointId];
    if (!marker) return;

    const hasFocused = focusWaypointOnMap(waypointId);
    if (!hasFocused) return;

    if (!marker.getPopup()?.isOpen()) marker.togglePopup();
  }, [focusWaypointOnMap]);

  const createWaypointPopupContent = useCallback(
    (waypoint: VoyageWaypoint, index: number, total: number, popup: maplibregl.Popup) => {
      const isStart = index === 0;
      const isEnd = total > 1 && index === total - 1;
      const wrapper = document.createElement("form");
      wrapper.style.cssText = "width:240px;padding:2px;font-family:var(--font-sans);";

      const heading = isStart ? "Start" : isEnd ? "Arrival" : `Waypoint ${String(index + 1).padStart(2, "0")}`;
      const coords = formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng);
      const safeName = escapeHtml(waypoint.name || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng));

      wrapper.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;">
          <div>
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:hsl(220,10%,45%);">${heading}</p>
            <p style="margin:0;font-size:12px;color:hsl(220,15%,30%);">${coords}</p>
          </div>
          <span style="font-size:11px;padding:4px 7px;background:${waypoint.waypoint_type === "technical" ? "hsla(220,10%,60%,0.12)" : "hsla(180,40%,35%,0.12)"};color:${waypoint.waypoint_type === "technical" ? "hsl(220,10%,40%)" : "hsl(180,40%,28%)"};">
            ${waypoint.waypoint_type === "technical" ? "Hidden" : "Visible"}
          </span>
        </div>
        <label style="${popupLabelStyle}">Name</label>
        <input name="name" type="text" value="${safeName}" style="${popupInputStyle}margin-bottom:12px;" />
        <label style="${popupLabelStyle}">Visibility</label>
        <select name="waypoint_type" style="${popupInputStyle}margin-bottom:8px;">
          <option value="technical"${waypoint.waypoint_type === "technical" ? " selected" : ""}>Technical / hidden</option>
          <option value="narrative"${waypoint.waypoint_type === "narrative" ? " selected" : ""}>Narrative / public</option>
        </select>
        <p style="${popupHintStyle}margin:0 0 14px;">New waypoints start as technical. Switch to Narrative only for stops you want readers to see, or that should anchor a story. Drag the marker itself to move it.</p>
        <div style="display:flex;gap:8px;">
          <button type="submit" style="flex:1;padding:9px 10px;border:none;background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-size:12px;font-weight:600;cursor:pointer;">Save</button>
          <button type="button" data-action="delete" style="padding:9px 10px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));font-size:12px;font-weight:600;cursor:pointer;">Delete</button>
        </div>
      `;

      const nameInput = wrapper.querySelector('input[name="name"]') as HTMLInputElement | null;
      const typeSelect = wrapper.querySelector('select[name="waypoint_type"]') as HTMLSelectElement | null;
      const deleteButton = wrapper.querySelector('[data-action="delete"]') as HTMLButtonElement | null;

      wrapper.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = nameInput?.value.trim() || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng);
        const waypointType = typeSelect?.value === "technical" ? "technical" : "narrative";

        void (async () => {
          const success = await updateWaypoint(
            waypoint.voyage_id,
            waypoint.id,
            { name, waypoint_type: waypointType },
            { successMessage: "Waypoint updated" }
          );
          if (success) popup.remove();
        })();
      });

      deleteButton?.addEventListener("click", () => {
        popup.remove();
        void deleteWaypoint(waypoint.voyage_id, waypoint.id);
      });

      return wrapper;
    },
    [deleteWaypoint, updateWaypoint]
  );

  const createWaypointMarkerEl = useCallback((waypoint: VoyageWaypoint, index: number, total: number) => {
    const el = document.createElement("button");
    const isNarrative = waypoint.waypoint_type === "narrative";
    const isStart = index === 0;
    const isEnd = total > 1 && index === total - 1;
    const size = isNarrative ? 16 : 10;

    el.type = "button";
    el.className = "voyage-admin-marker";
    el.title = `${waypoint.name || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng)} · Drag to move`;
    el.style.cssText = `
      width:${size}px;
      height:${size}px;
      border-radius:999px;
      border:2px solid white;
      background:${isStart ? "hsl(136, 42%, 42%)" : isEnd ? "hsl(8, 65%, 54%)" : isNarrative ? "hsl(210, 60%, 45%)" : "hsl(215, 12%, 65%)"};
      box-shadow:0 2px 10px rgba(0,0,0,0.22);
      cursor:grab;
      padding:0;
    `;

    el.addEventListener("click", (event) => event.stopPropagation());
    el.addEventListener("mousedown", (event) => event.stopPropagation());

    return el;
  }, []);

  const drawRouteOnMap = useCallback((map: maplibregl.Map) => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    markersByWaypointRef.current = {};

    const style = map.getStyle();
    if (style) {
      if (routeLineMouseDownRef.current) {
        map.off("mousedown", "admin-route-line", routeLineMouseDownRef.current);
        routeLineMouseDownRef.current = null;
      }
      if (routeLineMouseEnterRef.current) {
        map.off("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
        routeLineMouseEnterRef.current = null;
      }
      if (routeLineMouseLeaveRef.current) {
        map.off("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
        routeLineMouseLeaveRef.current = null;
      }
      style.layers.forEach((layer) => {
        if (layer.id.startsWith("admin-route-")) map.removeLayer(layer.id);
      });
      Object.keys(style.sources).forEach((source) => {
        if (source.startsWith("admin-route-")) map.removeSource(source);
      });
    }

    if (!selectedVoyageRef.current) return;

    const selectedVoyage = voyagesRef.current.find((voyage) => voyage.id === selectedVoyageRef.current);
    const selectedWaypoints = waypointsRef.current[selectedVoyageRef.current] || [];
    if (!selectedWaypoints.length) return;

    const geometry =
      geometryOverrideRef.current[selectedVoyageRef.current] ||
      getCachedGeometryCoordinates(selectedVoyage) ||
      getStraightVoyageGeometry(selectedWaypoints);

    if (geometry.length >= 2) {
      map.addSource("admin-route-line", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: geometry },
          properties: {},
        },
      });

      map.addLayer({
        id: "admin-route-line",
        type: "line",
        source: "admin-route-line",
        paint: {
          "line-color": selectedVoyage?.type === "water" ? "hsl(210, 60%, 45%)" : "hsl(30, 50%, 40%)",
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });

      routeLineMouseDownRef.current = (event: maplibregl.MapLayerMouseEvent) => {
        if (!selectedVoyageRef.current) return;
        const currentWaypoints = waypointsRef.current[selectedVoyageRef.current] || [];
        const nearestSegmentIndex = getNearestSegmentIndex(map, event.point, currentWaypoints);
        if (nearestSegmentIndex == null) return;

        event.preventDefault();
        suppressMapClickUntilRef.current = Date.now() + 250;
        segmentInsertRef.current = {
          voyageId: selectedVoyageRef.current,
          insertIndex: nearestSegmentIndex + 1,
        };
        ensureSegmentPreviewMarker(map, event.lngLat.lng, event.lngLat.lat);
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
      };
      routeLineMouseEnterRef.current = () => {
        if (!segmentInsertRef.current) {
          map.getCanvas().style.cursor = "grab";
        }
      };
      routeLineMouseLeaveRef.current = () => {
        if (!segmentInsertRef.current) {
          map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
        }
      };

      map.on("mousedown", "admin-route-line", routeLineMouseDownRef.current);
      map.on("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
      map.on("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
    }

    selectedWaypoints.forEach((waypoint, index) => {
      const markerEl = createWaypointMarkerEl(waypoint, index, selectedWaypoints.length);
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false, closeOnMove: false });
      popup.setDOMContent(createWaypointPopupContent(waypoint, index, selectedWaypoints.length, popup));

      const marker = new maplibregl.Marker({ element: markerEl, draggable: true })
        .setLngLat([waypoint.lng, waypoint.lat])
        .setPopup(popup)
        .addTo(map);

      marker.on("dragend", () => {
        const position = marker.getLngLat();
        void updateWaypoint(
          waypoint.voyage_id,
          waypoint.id,
          { lat: position.lat, lng: position.lng },
          { successMessage: "Waypoint moved", syncGeometry: true }
        );
      });

      markersRef.current.push(marker);
      markersByWaypointRef.current[waypoint.id] = marker;

      if (pendingPopupWaypointIdRef.current === waypoint.id) {
        pendingPopupWaypointIdRef.current = null;
        requestAnimationFrame(() => marker.togglePopup());
      }
    });
  }, [createWaypointMarkerEl, createWaypointPopupContent, ensureSegmentPreviewMarker, updateWaypoint]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
          },
        },
        layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
      },
      center: [15, 40],
      zoom: 5,
      attributionControl: false,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    mapRef.current.once("load", () => {
      requestAnimationFrame(() => mapRef.current?.resize());
    });

    mapRef.current.on("mousemove", (event) => {
      if (!segmentInsertRef.current) return;
      ensureSegmentPreviewMarker(mapRef.current!, event.lngLat.lng, event.lngLat.lat);
    });

    mapRef.current.on("mouseup", (event) => {
      const activeInsert = segmentInsertRef.current;
      const map = mapRef.current;
      if (!activeInsert || !map) return;

      segmentInsertRef.current = null;
      removeSegmentPreviewMarker();
      if (!map.dragPan.isEnabled()) map.dragPan.enable();
      map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
      suppressMapClickUntilRef.current = Date.now() + 250;

      void insertWaypointAtIndex(
        activeInsert.voyageId,
        event.lngLat.lat,
        event.lngLat.lng,
        activeInsert.insertIndex
      );
    });

    mapRef.current.on("click", (event) => {
      const voyageId = selectedVoyageRef.current;
      if (!voyageId) return;
      if (Date.now() < suppressMapClickUntilRef.current) return;

      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest(".voyage-admin-marker") || target?.closest(".maplibregl-popup")) return;

      void insertWaypointAtIndex(
        voyageId,
        event.lngLat.lat,
        event.lngLat.lng,
        waypointsRef.current[voyageId]?.length || 0
      );
    });

    return () => {
      segmentInsertRef.current = null;
      removeSegmentPreviewMarker();
      if (routeLineMouseDownRef.current) {
        mapRef.current?.off("mousedown", "admin-route-line", routeLineMouseDownRef.current);
        routeLineMouseDownRef.current = null;
      }
      if (routeLineMouseEnterRef.current) {
        mapRef.current?.off("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
        routeLineMouseEnterRef.current = null;
      }
      if (routeLineMouseLeaveRef.current) {
        mapRef.current?.off("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
        routeLineMouseLeaveRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [ensureSegmentPreviewMarker, insertWaypointAtIndex, removeSegmentPreviewMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => drawRouteOnMap(map);
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [drawRouteOnMap, selectedVoyageId, voyages, waypoints]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = selectedVoyageId ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [selectedVoyageId]);

  const selectVoyage = useCallback(async (voyageId: string) => {
    setSelectedVoyageId(voyageId);
    const loadedWaypoints = waypointsRef.current[voyageId] || await fetchWaypoints(voyageId);
    fitMapToWaypoints(loadedWaypoints);
  }, [fetchWaypoints, fitMapToWaypoints]);

  const openVoyageForm = useCallback((voyage?: Voyage) => {
    if (voyage) {
      setEditingVoyage(voyage);
      setVoyageForm({
        name: voyage.name,
        description: voyage.description || "",
        type: voyage.type,
        status: voyage.status,
        start_date: voyage.start_date || "",
        start_time: voyage.start_time ? voyage.start_time.slice(0, 5) : "",
        end_date: voyage.end_date || "",
        end_time: voyage.end_time ? voyage.end_time.slice(0, 5) : "",
      });
    } else {
      setEditingVoyage(null);
      setVoyageForm(emptyVoyageForm);
    }
    setShowVoyageForm(true);
  }, []);

  const saveVoyage = useCallback(async () => {
    const data: any = {
      name: voyageForm.name,
      description: voyageForm.description,
      type: voyageForm.type,
      status: voyageForm.status,
      sort_order: editingVoyage ? editingVoyage.sort_order : voyagesRef.current.length,
    };

    if (editingVoyage) {
      const { error } = await supabase.from("voyages").update(data).eq("id", editingVoyage.id);
      if (error) {
        toast.error(getErrorMessage(error, "Unable to update voyage"));
        return;
      }

      const nextVoyages = voyagesRef.current.map((voyage) =>
        voyage.id === editingVoyage.id ? normalizeVoyage({ ...voyage, ...data }) : voyage
      );
      commitVoyages(nextVoyages);
      if ((waypointsRef.current[editingVoyage.id] || []).length >= 2) {
        void syncVoyageGeometry(editingVoyage.id, waypointsRef.current[editingVoyage.id]);
      }
      toast.success("Voyage updated");
    } else {
      const { data: newVoyage, error } = await supabase.from("voyages").insert(data).select().single();
      if (error || !newVoyage) {
        toast.error(getErrorMessage(error, "Unable to create voyage"));
        return;
      }

      const normalizedVoyage = normalizeVoyage(newVoyage);
      commitVoyages([...voyagesRef.current, normalizedVoyage]);
      setSelectedVoyageId(normalizedVoyage.id);
      toast.success("Voyage created");
    }

    setShowVoyageForm(false);
  }, [commitVoyages, editingVoyage, syncVoyageGeometry, voyageForm]);

  const deleteVoyage = useCallback(async (voyageId: string, name: string) => {
    if (!confirm(`Delete voyage "${name}" and all its waypoints?`)) return;

    const { error } = await supabase.from("voyages").delete().eq("id", voyageId);
    if (error) {
      toast.error(getErrorMessage(error, "Unable to delete voyage"));
      return;
    }

    const { [voyageId]: _removedWaypoints, ...remainingWaypoints } = waypointsRef.current;
    waypointsRef.current = remainingWaypoints;
    setWaypoints(remainingWaypoints);

    const nextVoyages = voyagesRef.current.filter((voyage) => voyage.id !== voyageId);
    commitVoyages(nextVoyages);
    delete geometryOverrideRef.current[voyageId];
    delete geometryRequestRef.current[voyageId];

    if (selectedVoyageRef.current === voyageId) {
      setSelectedVoyageId(null);
    }

    toast.success("Voyage deleted");
  }, [commitVoyages]);

  const moveWaypoint = useCallback(async (waypoint: VoyageWaypoint, direction: "up" | "down") => {
    const currentWaypoints = waypointsRef.current[waypoint.voyage_id] || [];
    const index = currentWaypoints.findIndex((item) => item.id === waypoint.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= currentWaypoints.length) return;

    const other = currentWaypoints[swapIndex];
    const [first, second] = await Promise.all([
      supabase.from("voyage_waypoints").update({ sort_order: other.sort_order }).eq("id", waypoint.id),
      supabase.from("voyage_waypoints").update({ sort_order: waypoint.sort_order }).eq("id", other.id),
    ]);

    if (first.error || second.error) {
      toast.error(getErrorMessage(first.error || second.error, "Unable to reorder waypoint"));
      return;
    }

    const nextWaypoints = commitWaypoints(
      waypoint.voyage_id,
      currentWaypoints.map((item) => {
        if (item.id === waypoint.id) return normalizeWaypoint({ ...item, sort_order: other.sort_order });
        if (item.id === other.id) return normalizeWaypoint({ ...item, sort_order: waypoint.sort_order });
        return item;
      })
    );

    geometryOverrideRef.current[waypoint.voyage_id] = getStraightVoyageGeometry(nextWaypoints);
    void syncVoyageGeometry(waypoint.voyage_id, nextWaypoints);
  }, [commitWaypoints, syncVoyageGeometry]);

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId);
  const selectedWaypoints = selectedVoyageId ? (waypoints[selectedVoyageId] || []) : [];
  const distance = selectedWaypoints.length >= 2 ? totalWaypointDistance(selectedWaypoints) : 0;
  const voyageDates = selectedVoyage ? formatVoyageDateRange(selectedVoyage) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="editorial-heading text-lg">Voyages</h3>
        <button
          onClick={() => openVoyageForm()}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> New Voyage
        </button>
      </div>

      {showVoyageForm && (
        <div className="border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-sans font-medium">{editingVoyage ? "Edit Voyage" : "New Voyage"}</h4>
            <button onClick={() => setShowVoyageForm(false)} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Name</label>
              <input
                type="text"
                value={voyageForm.name}
                onChange={(event) => setVoyageForm((form) => ({ ...form, name: event.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Type</label>
                <select
                  value={voyageForm.type}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, type: event.target.value as Voyage["type"] }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                >
                  <option value="water">🚢 Water</option>
                  <option value="land">🚐 Land</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Status</label>
                <select
                  value={voyageForm.status}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, status: event.target.value as Voyage["status"] }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description</label>
            <textarea
              value={voyageForm.description}
              onChange={(event) => setVoyageForm((form) => ({ ...form, description: event.target.value }))}
              rows={2}
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Start</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.start_date}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, start_date: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={voyageForm.start_time}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, start_time: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">Time is optional.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">End</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.end_date}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, end_date: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={voyageForm.end_time}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, end_time: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">Leave blank if the arrival is still open.</p>
            </div>
          </div>

          <button
            onClick={() => void saveVoyage()}
            className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity"
          >
            {editingVoyage ? "Update" : "Create"}
          </button>
        </div>
      )}

      <div className="space-y-0">
        {voyages.map((voyage) => {
          const dateRange = formatVoyageDateRange(voyage);
          return (
            <div
              key={voyage.id}
              className={`flex items-center justify-between py-3 px-3 border-b border-border group cursor-pointer transition-colors ${
                selectedVoyageId === voyage.id ? "bg-accent/10" : "hover:bg-muted/30"
              }`}
              onClick={() => void selectVoyage(voyage.id)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {voyage.type === "water" ? (
                  <Ship size={14} className="text-blue-500 shrink-0" />
                ) : (
                  <Mountain size={14} className="text-amber-600 shrink-0" />
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-sans font-medium truncate">{voyage.name}</h4>
                  <div className="flex items-center gap-2 text-[10px] font-sans uppercase tracking-wider text-muted-foreground">
                    <span>{voyage.status}</span>
                    {dateRange && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                        <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                          <Clock3 size={10} /> {dateRange}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openVoyageForm(voyage);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Edit size={12} />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteVoyage(voyage.id, voyage.name);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border border-border">
        <div className="relative" style={{ height: "420px" }}>
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[240px]" />
          {selectedVoyageId && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-background/92 backdrop-blur-md border border-border px-4 py-2 text-xs font-sans text-foreground shadow-lg z-10">
              Click anywhere to add a technical waypoint. Drag a route segment to insert an intermediate point. Drag a waypoint to move it. Use the marker popup to rename it, change visibility, or delete it.
            </div>
          )}
        </div>

        {!selectedVoyageId && (
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            Seleziona un voyage dalla lista. Da quel momento, ogni click sulla mappa crea subito uno start o un nuovo waypoint tecnico.
          </p>
        )}

        {selectedVoyageId && (
          <div className="p-4 border-t border-border space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-sans font-medium">Waypoints ({selectedWaypoints.length})</h4>
                <p className="text-xs text-muted-foreground font-sans">
                  {selectedWaypoints.length >= 2
                    ? `${Math.round(distance)} NM traced${voyageDates ? ` · ${voyageDates}` : ""}`
                    : voyageDates || "The first click creates the start waypoint as technical."}
                </p>
              </div>
            </div>

            <div className="space-y-0 max-h-[260px] overflow-y-auto">
              {selectedWaypoints.map((waypoint, index) => (
                <div
                  key={waypoint.id}
                  className="flex items-center gap-2 py-2 px-2 border-b border-border/50 group text-xs"
                >
                  <span className="text-muted-foreground/40 w-5 shrink-0 font-sans">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {waypoint.waypoint_type === "technical" ? (
                    <span title="Technical (hidden from public map)">
                      <EyeOff size={10} className="text-muted-foreground shrink-0" />
                    </span>
                  ) : (
                    <span title="Narrative (visible to readers)">
                      <Eye size={10} className="text-accent shrink-0" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => openWaypointPopup(waypoint.id)}
                    className="flex-1 min-w-0 text-left hover:text-foreground transition-colors"
                  >
                    <span className="font-sans truncate block">
                      {waypoint.name || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-sans">
                      {formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}
                    </span>
                  </button>
                  <button
                    onClick={() => void deleteWaypoint(waypoint.voyage_id, waypoint.id)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                    title="Delete waypoint"
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openWaypointPopup(waypoint.id)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Edit waypoint"
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      onClick={() => moveWaypoint(waypoint, "up")}
                      disabled={index === 0}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={() => moveWaypoint(waypoint, "down")}
                      disabled={index === selectedWaypoints.length - 1}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={() => {
                        focusWaypointOnMap(waypoint.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Center waypoint on map"
                    >
                      <LocateFixed size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedWaypoints.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                The next click on the map will create the start waypoint as technical.
              </p>
            )}
          </div>
        )}
      </div>

      {voyages.length === 0 && !showVoyageForm && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No voyages yet.</p>
          <button
            onClick={() => openVoyageForm()}
            className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors"
          >
            <Plus size={16} /> Create your first voyage
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminVoyageManager;
