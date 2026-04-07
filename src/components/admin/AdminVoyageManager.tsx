import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, X, ChevronUp, ChevronDown, Ship, Mountain, MapPin, Grip, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { haversineNM, totalWaypointDistance, fetchOSRMRoute } from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint } from "@/lib/voyage-utils";

interface WaypointForm {
  lat: number;
  lng: number;
  name: string;
  waypoint_type: "technical" | "narrative";
  date_start: string;
  date_end: string;
}

const AdminVoyageManager = () => {
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [waypoints, setWaypoints] = useState<Record<string, VoyageWaypoint[]>>({});
  const [selectedVoyageId, setSelectedVoyageId] = useState<string | null>(null);
  const [showVoyageForm, setShowVoyageForm] = useState(false);
  const [editingVoyage, setEditingVoyage] = useState<Voyage | null>(null);
  const [voyageForm, setVoyageForm] = useState({ name: "", description: "", type: "water" as "water" | "land", status: "planned" as "planned" | "active" | "completed" });
  const [editingWaypoint, setEditingWaypoint] = useState<VoyageWaypoint | null>(null);
  const [wpForm, setWpForm] = useState<WaypointForm>({ lat: 0, lng: 0, name: "", waypoint_type: "narrative", date_start: "", date_end: "" });
  const [showWpForm, setShowWpForm] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const placingModeRef = useRef(false);
  const selectedVoyageRef = useRef<string | null>(null);

  useEffect(() => { placingModeRef.current = placingMode; }, [placingMode]);
  useEffect(() => { selectedVoyageRef.current = selectedVoyageId; }, [selectedVoyageId]);

  useEffect(() => { fetchVoyages(); }, []);

  const fetchVoyages = async () => {
    const { data } = await supabase.from("voyages").select("*").order("sort_order", { ascending: true });
    setVoyages((data || []) as unknown as Voyage[]);
  };

  const fetchWaypoints = async (voyageId: string) => {
    const { data } = await supabase.from("voyage_waypoints").select("*").eq("voyage_id", voyageId).order("sort_order", { ascending: true });
    const wps = (data || []) as unknown as VoyageWaypoint[];
    setWaypoints((prev) => ({ ...prev, [voyageId]: wps }));
    return wps;
  };

  // Initialize map
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

    // Click handler for placing waypoints
    mapRef.current.on("click", (e) => {
      if (!placingModeRef.current || !selectedVoyageRef.current) return;
      setWpForm({ lat: e.lngLat.lat, lng: e.lngLat.lng, name: "", waypoint_type: "narrative", date_start: "", date_end: "" });
      setEditingWaypoint(null);
      setShowWpForm(true);
      setPlacingMode(false);
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Draw route + waypoints on map when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => drawRouteOnMap(map);
    if (map.isStyleLoaded()) draw();
    else map.on("load", draw);
  }, [selectedVoyageId, waypoints, voyages]);

  const drawRouteOnMap = (map: maplibregl.Map) => {
    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Clear old layers/sources
    const style = map.getStyle();
    if (style) {
      style.layers.forEach((l) => {
        if (l.id.startsWith("admin-route-")) map.removeLayer(l.id);
      });
      Object.keys(style.sources).forEach((s) => {
        if (s.startsWith("admin-route-")) map.removeSource(s);
      });
    }

    if (!selectedVoyageId) return;
    const wps = waypoints[selectedVoyageId] || [];
    if (wps.length < 2) {
      // Just show single waypoint marker
      wps.forEach((wp) => {
        const el = createWpMarkerEl(wp);
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([wp.lng, wp.lat])
          .addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          updateWaypointPosition(wp.id, pos.lat, pos.lng);
        });
        markersRef.current.push(marker);
      });
      if (wps.length === 1) map.flyTo({ center: [wps[0].lng, wps[0].lat], zoom: 8 });
      return;
    }

    const voyage = voyages.find((v) => v.id === selectedVoyageId);
    const isWater = voyage?.type === "water";

    // Draw line
    const lineId = `admin-route-line`;
    map.addSource(lineId, {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: wps.map((w) => [w.lng, w.lat]) },
        properties: {},
      },
    });
    map.addLayer({
      id: lineId,
      type: "line",
      source: lineId,
      paint: {
        "line-color": isWater ? "hsl(210, 60%, 45%)" : "hsl(30, 50%, 40%)",
        "line-width": 3,
        "line-opacity": 0.8,
      },
    });

    // Add draggable markers for waypoints
    wps.forEach((wp, i) => {
      const el = createWpMarkerEl(wp, i, wps.length);
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        updateWaypointPosition(wp.id, pos.lat, pos.lng);
      });
      markersRef.current.push(marker);
    });

    // Fit bounds
    const bounds = wps.reduce(
      (b, w) => b.extend([w.lng, w.lat]),
      new maplibregl.LngLatBounds([wps[0].lng, wps[0].lat], [wps[0].lng, wps[0].lat])
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
  };

  const createWpMarkerEl = (wp: VoyageWaypoint, index?: number, total?: number) => {
    const el = document.createElement("div");
    const isNarrative = wp.waypoint_type === "narrative";
    const isStart = index === 0;
    const isEnd = index !== undefined && total !== undefined && index === total - 1;
    const size = isNarrative ? 14 : 8;
    el.style.cssText = `
      width:${size}px;height:${size}px;border-radius:50%;cursor:grab;
      background:${isStart ? "hsl(120,40%,40%)" : isEnd ? "hsl(0,50%,50%)" : isNarrative ? "hsl(210,60%,45%)" : "hsl(210,20%,65%)"};
      border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);
    `;
    if (wp.name && isNarrative) {
      el.title = wp.name;
    }
    return el;
  };

  const updateWaypointPosition = async (id: string, lat: number, lng: number) => {
    await supabase.from("voyage_waypoints").update({ lat, lng } as any).eq("id", id);
    if (selectedVoyageId) fetchWaypoints(selectedVoyageId);
    toast.success("Waypoint moved");
  };

  const selectVoyage = async (voyageId: string) => {
    setSelectedVoyageId(voyageId);
    if (!waypoints[voyageId]) {
      await fetchWaypoints(voyageId);
    }
  };

  // Voyage CRUD
  const openVoyageForm = (voyage?: Voyage) => {
    if (voyage) {
      setEditingVoyage(voyage);
      setVoyageForm({ name: voyage.name, description: voyage.description || "", type: voyage.type, status: voyage.status });
    } else {
      setEditingVoyage(null);
      setVoyageForm({ name: "", description: "", type: "water", status: "planned" });
    }
    setShowVoyageForm(true);
  };

  const saveVoyage = async () => {
    const data: any = {
      name: voyageForm.name,
      description: voyageForm.description,
      type: voyageForm.type,
      status: voyageForm.status,
      sort_order: editingVoyage ? editingVoyage.sort_order : voyages.length,
    };
    if (editingVoyage) {
      await supabase.from("voyages").update(data).eq("id", editingVoyage.id);
      toast.success("Voyage updated");
    } else {
      const { data: newVoyage } = await supabase.from("voyages").insert(data).select().single();
      if (newVoyage) setSelectedVoyageId((newVoyage as any).id);
      toast.success("Voyage created");
    }
    setShowVoyageForm(false);
    fetchVoyages();
  };

  const deleteVoyage = async (id: string, name: string) => {
    if (!confirm(`Delete voyage "${name}" and all its waypoints?`)) return;
    await supabase.from("voyage_waypoints").delete().eq("voyage_id", id);
    await supabase.from("voyages").delete().eq("id", id);
    if (selectedVoyageId === id) setSelectedVoyageId(null);
    toast.success("Voyage deleted");
    fetchVoyages();
  };

  // Waypoint CRUD
  const saveWaypoint = async () => {
    const voyageId = selectedVoyageId!;
    const currentWps = waypoints[voyageId] || [];
    const data: any = {
      voyage_id: voyageId,
      lat: wpForm.lat,
      lng: wpForm.lng,
      name: wpForm.name || null,
      waypoint_type: wpForm.waypoint_type,
      date_start: wpForm.date_start ? new Date(wpForm.date_start).toISOString() : null,
      date_end: wpForm.date_end ? new Date(wpForm.date_end).toISOString() : null,
      sort_order: editingWaypoint ? editingWaypoint.sort_order : currentWps.length,
    };

    if (editingWaypoint) {
      await supabase.from("voyage_waypoints").update(data).eq("id", editingWaypoint.id);
      toast.success("Waypoint updated");
    } else {
      await supabase.from("voyage_waypoints").insert(data);
      toast.success("Waypoint added");
    }
    setShowWpForm(false);
    fetchWaypoints(voyageId);
  };

  const deleteWaypoint = async (id: string) => {
    if (!confirm("Delete this waypoint?")) return;
    await supabase.from("voyage_waypoints").delete().eq("id", id);
    toast.success("Waypoint deleted");
    if (selectedVoyageId) fetchWaypoints(selectedVoyageId);
  };

  const moveWaypoint = async (wp: VoyageWaypoint, direction: "up" | "down") => {
    const wps = waypoints[wp.voyage_id] || [];
    const idx = wps.findIndex((w) => w.id === wp.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= wps.length) return;
    const other = wps[swapIdx];
    await Promise.all([
      supabase.from("voyage_waypoints").update({ sort_order: other.sort_order } as any).eq("id", wp.id),
      supabase.from("voyage_waypoints").update({ sort_order: wp.sort_order } as any).eq("id", other.id),
    ]);
    fetchWaypoints(wp.voyage_id);
  };

  const editWaypointForm = (wp: VoyageWaypoint) => {
    setEditingWaypoint(wp);
    setWpForm({
      lat: wp.lat,
      lng: wp.lng,
      name: wp.name || "",
      waypoint_type: wp.waypoint_type || "narrative",
      date_start: wp.date_start ? new Date(wp.date_start).toISOString().slice(0, 16) : "",
      date_end: wp.date_end ? new Date(wp.date_end).toISOString().slice(0, 16) : "",
    });
    setShowWpForm(true);
  };

  const selectedVoyage = voyages.find((v) => v.id === selectedVoyageId);
  const selectedWaypoints = selectedVoyageId ? (waypoints[selectedVoyageId] || []) : [];
  const distance = selectedWaypoints.length >= 2 ? totalWaypointDistance(selectedWaypoints) : 0;
  const isWater = selectedVoyage?.type === "water";

  return (
    <div className="space-y-6">
      {/* Voyages list + form */}
      <div className="flex items-center justify-between">
        <h3 className="editorial-heading text-lg">Voyages</h3>
        <button onClick={() => openVoyageForm()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity">
          <Plus size={14} /> New Voyage
        </button>
      </div>

      {showVoyageForm && (
        <div className="border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-sans font-medium">{editingVoyage ? "Edit Voyage" : "New Voyage"}</h4>
            <button onClick={() => setShowVoyageForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Name</label>
              <input type="text" value={voyageForm.name} onChange={(e) => setVoyageForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Type</label>
                <select value={voyageForm.type} onChange={(e) => setVoyageForm((f) => ({ ...f, type: e.target.value as any }))} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent">
                  <option value="water">🚢 Water</option>
                  <option value="land">🚐 Land</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Status</label>
                <select value={voyageForm.status} onChange={(e) => setVoyageForm((f) => ({ ...f, status: e.target.value as any }))} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent">
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description</label>
            <textarea value={voyageForm.description} onChange={(e) => setVoyageForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none" />
          </div>
          <button onClick={saveVoyage} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity">
            {editingVoyage ? "Update" : "Create"}
          </button>
        </div>
      )}

      {/* Voyages list */}
      <div className="space-y-0">
        {voyages.map((v) => (
          <div
            key={v.id}
            className={`flex items-center justify-between py-3 px-3 border-b border-border group cursor-pointer transition-colors ${
              selectedVoyageId === v.id ? "bg-accent/10" : "hover:bg-muted/30"
            }`}
            onClick={() => selectVoyage(v.id)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {v.type === "water" ? <Ship size={14} className="text-blue-500 shrink-0" /> : <Mountain size={14} className="text-amber-600 shrink-0" />}
              <div className="min-w-0">
                <h4 className="text-sm font-sans font-medium truncate">{v.name}</h4>
                <span className="text-[10px] font-sans text-muted-foreground uppercase tracking-wider">{v.status}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={(e) => { e.stopPropagation(); openVoyageForm(v); }} className="p-1.5 text-muted-foreground hover:text-foreground"><Edit size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); deleteVoyage(v.id, v.name); }} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-border">
        <div className="relative" style={{ height: "400px" }}>
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[200px]" />
          {selectedVoyageId && placingMode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-4 py-2 text-xs font-sans font-medium shadow-lg z-10 flex items-center gap-2">
              <MapPin size={12} /> Click on map to place waypoint
              <button type="button" onClick={() => setPlacingMode(false)} className="ml-2 hover:opacity-70"><X size={12} /></button>
            </div>
          )}
        </div>

        {!selectedVoyageId && (
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">Seleziona un voyage dalla lista per aggiungere waypoint sulla mappa.</p>
        )}

        {selectedVoyageId && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4">
                <h4 className="text-sm font-sans font-medium">
                  Waypoints ({selectedWaypoints.length})
                </h4>
                {distance > 0 && (
                  <span className="text-xs font-sans text-accent">
                    {isWater ? `${Math.round(distance)} NM` : `${Math.round(distance * 1.852)} km`}
                  </span>
                )}
              </div>
              <button
                onClick={() => setPlacingMode(true)}
                className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-sans font-medium hover:opacity-90 transition-opacity"
              >
                <Plus size={12} /> Add Waypoint
              </button>
            </div>

            {/* Waypoint form */}
            {showWpForm && (
              <div className="border border-border p-4 mb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-sans font-medium">{editingWaypoint ? "Edit Waypoint" : "New Waypoint"}</h5>
                  <button onClick={() => setShowWpForm(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Lat</label>
                    <input type="number" step="0.0001" value={wpForm.lat} onChange={(e) => setWpForm((f) => ({ ...f, lat: Number(e.target.value) }))} className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Lng</label>
                    <input type="number" step="0.0001" value={wpForm.lng} onChange={(e) => setWpForm((f) => ({ ...f, lng: Number(e.target.value) }))} className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Type</label>
                    <select value={wpForm.waypoint_type} onChange={(e) => setWpForm((f) => ({ ...f, waypoint_type: e.target.value as any }))} className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent">
                      <option value="narrative">📍 Narrative</option>
                      <option value="technical">⚙️ Technical</option>
                    </select>
                  </div>
                </div>
                {wpForm.waypoint_type === "narrative" && (
                  <>
                    <div>
                      <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Name</label>
                      <input type="text" value={wpForm.name} onChange={(e) => setWpForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Porto di Bari" className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Date Start</label>
                        <input type="datetime-local" value={wpForm.date_start} onChange={(e) => setWpForm((f) => ({ ...f, date_start: e.target.value }))} className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="text-[10px] font-sans uppercase text-muted-foreground mb-1 block">Date End</label>
                        <input type="datetime-local" value={wpForm.date_end} onChange={(e) => setWpForm((f) => ({ ...f, date_end: e.target.value }))} className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent" />
                      </div>
                    </div>
                  </>
                )}
                <button onClick={saveWaypoint} className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-sans font-medium hover:opacity-90 transition-opacity">
                  {editingWaypoint ? "Update" : "Add"}
                </button>
              </div>
            )}

            {/* Waypoints list */}
            <div className="space-y-0 max-h-[250px] overflow-y-auto">
              {selectedWaypoints.map((wp, i) => (
                <div key={wp.id} className="flex items-center gap-2 py-2 px-2 border-b border-border/50 group text-xs">
                  <span className="text-muted-foreground/40 w-5 shrink-0 font-sans">{String(i + 1).padStart(2, "0")}</span>
                  {wp.waypoint_type === "technical" ? (
                    <span title="Technical (hidden)"><EyeOff size={10} className="text-muted-foreground shrink-0" /></span>
                  ) : (
                    <span title="Narrative (visible)"><Eye size={10} className="text-accent shrink-0" /></span>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-sans truncate block">{wp.name || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}</span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => moveWaypoint(wp, "up")} disabled={i === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronUp size={12} /></button>
                    <button onClick={() => moveWaypoint(wp, "down")} disabled={i === selectedWaypoints.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronDown size={12} /></button>
                    <button onClick={() => editWaypointForm(wp)} className="p-1 text-muted-foreground hover:text-foreground"><Edit size={12} /></button>
                    <button onClick={() => deleteWaypoint(wp.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>

            {selectedWaypoints.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                Click "Add Waypoint" then click on the map to place waypoints.
              </p>
            )}
          </div>
        )}
      </div>

      {voyages.length === 0 && !showVoyageForm && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No voyages yet.</p>
          <button onClick={() => openVoyageForm()} className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors">
            <Plus size={16} /> Create your first voyage
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminVoyageManager;
