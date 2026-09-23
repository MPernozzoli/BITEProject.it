import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Anchor, Crosshair, EyeOff, Loader2, LocateFixed, Navigation, Save, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import {
  bindMapToContainerResize,
  bindMapToTheme,
  createThemedCartoStyle,
  isMapLibreSupported,
  requestMapResize,
} from "@/lib/maplibre";
import {
  buildMapPresenceUpsertPayload,
  getMapPresenceIconMarkup,
  isMissingMapPresenceRelationError,
  mergeMapPresenceTrackers,
  type MapPresenceTrackerRow,
} from "@/lib/map-presence";
import {
  getFleetBoatPositions,
  getLocalizedWaypointName,
  type Voyage,
  type VoyageBoatPosition,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";

type CrewFormState = {
  label_it: string;
  label_en: string;
  description_it: string;
  description_en: string;
  latitude: string;
  longitude: string;
  is_visible: boolean;
  is_onboard: boolean;
  updated_at: string;
};

const formatCoordinateInput = (value: number | null) => (Number.isFinite(value) ? String(value) : "");

const createCrewFormState = (row: MapPresenceTrackerRow): CrewFormState => ({
  label_it: row.label_it ?? "",
  label_en: row.label_en ?? "",
  description_it: row.description_it ?? "",
  description_en: row.description_en ?? "",
  latitude: formatCoordinateInput(row.latitude),
  longitude: formatCoordinateInput(row.longitude),
  is_visible: row.is_visible,
  is_onboard: row.is_onboard,
  updated_at: row.updated_at,
});

const createDefaultCrewForm = (): CrewFormState => createCrewFormState(mergeMapPresenceTrackers([]).crew);

const parseCoordinate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const hasCoordinates = (form: CrewFormState) =>
  Number.isFinite(parseCoordinate(form.latitude)) && Number.isFinite(parseCoordinate(form.longitude));

const getFormCoordinates = (form: CrewFormState) => {
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const createCrewMarkerElement = (title: string, options?: { isDimmed?: boolean }) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-presence-marker map-presence-marker--crew map-presence-marker--selected";
  if (options?.isDimmed) button.classList.add("map-presence-marker--dimmed");
  button.setAttribute("aria-label", title);
  button.title = title;
  button.innerHTML = `
    <span class="map-presence-marker__halo" aria-hidden="true"></span>
    <span class="map-presence-marker__chip" aria-hidden="true">
      <span class="map-presence-marker__icon">${getMapPresenceIconMarkup("crew")}</span>
    </span>
  `;
  return button;
};

const buildCrewPayload = (form: CrewFormState, userId: string | null | undefined): TablesInsert<"logbook_map_markers"> => {
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  const coordinatesAreEmpty = latitude === null && longitude === null;

  if (!coordinatesAreEmpty && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new Error("Inserisci sia latitudine che longitudine con un formato valido.");
  }

  if (Number.isFinite(latitude) && (latitude < -90 || latitude > 90)) {
    throw new Error("La latitudine deve essere compresa tra -90 e 90.");
  }

  if (Number.isFinite(longitude) && (longitude < -180 || longitude > 180)) {
    throw new Error("La longitudine deve essere compresa tra -180 e 180.");
  }

  return buildMapPresenceUpsertPayload("crew", {
    label_it: form.label_it.trim() || "Equipaggio",
    label_en: form.label_en.trim() || "Crew",
    description_it: form.description_it.trim() || null,
    description_en: form.description_en.trim() || null,
    latitude: coordinatesAreEmpty ? null : latitude,
    longitude: coordinatesAreEmpty ? null : longitude,
    is_visible: form.is_visible,
    is_onboard: form.is_onboard,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  });
};

type BoatVoyageStatus = {
  voyageId: string;
  voyageName: string;
  position: VoyageBoatPosition;
  fromLabel: string | null;
  toLabel: string | null;
};

const localizedVoyageName = (voyage: Pick<Voyage, "name" | "name_it" | "name_en">) =>
  voyage.name_it?.trim() || voyage.name?.trim() || voyage.name_en?.trim() || "Viaggio";

/** Read-only: where the boat currently is, derived from voyage actuals (see lib/voyage-utils.ts). */
const useBoatStatus = () => {
  const [statuses, setStatuses] = useState<BoatVoyageStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: voyages, error: voyagesError } = await supabase
        .from("voyages")
        .select("id, type, cached_geometry, status, name, name_it, name_en")
        .eq("status", "active");
      if (voyagesError) throw voyagesError;

      const activeVoyages = (voyages || []) as unknown as Voyage[];
      if (activeVoyages.length === 0) {
        setStatuses([]);
        return;
      }

      const { data: waypoints, error: waypointsError } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .in("voyage_id", activeVoyages.map((voyage) => voyage.id))
        .order("sort_order", { ascending: true });
      if (waypointsError) throw waypointsError;

      const waypointsMap: Record<string, VoyageWaypoint[]> = {};
      (waypoints || []).forEach((waypoint) => {
        const typed = waypoint as unknown as VoyageWaypoint;
        (waypointsMap[typed.voyage_id] ||= []).push(typed);
      });

      const positions = getFleetBoatPositions(activeVoyages, waypointsMap);
      const nextStatuses: BoatVoyageStatus[] = [];
      activeVoyages.forEach((voyage) => {
        const position = positions[voyage.id];
        if (!position) return;
        const wps = waypointsMap[voyage.id] || [];
        const findLabel = (waypointId: string | undefined) => {
          if (!waypointId) return null;
          const index = wps.findIndex((wp) => wp.id === waypointId);
          const wp = index >= 0 ? wps[index] : null;
          return wp ? getLocalizedWaypointName(wp, "it", index) : null;
        };
        nextStatuses.push({
          voyageId: voyage.id,
          voyageName: localizedVoyageName(voyage),
          position,
          fromLabel: position.status === "in-transit" ? findLabel(position.fromWaypointId) : findLabel(position.waypointId),
          toLabel: position.status === "in-transit" ? findLabel(position.toWaypointId) : null,
        });
      });
      setStatuses(nextStatuses);
    } catch (error) {
      console.error("Failed to load derived boat status", error);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { statuses, loading };
};

const AdminMapPresenceManager = () => {
  const { session } = useAuth();
  const [form, setForm] = useState<CrewFormState>(createDefaultCrewForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const { statuses: boatStatuses, loading: boatLoading } = useBoatStatus();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapResizeCleanupRef = useRef<(() => void) | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hasPerformedInitialFitRef = useRef(false);
  const placingRef = useRef(false);

  const loadCrewTracker = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("logbook_map_markers").select("*").eq("id", "crew").maybeSingle();

      if (error) {
        if (isMissingMapPresenceRelationError(error)) {
          setForm(createDefaultCrewForm());
          toast.error("La tabella dei tracker non e ancora disponibile sul database. La mappa e visibile, ma prima applica la migration.");
          return;
        }
        throw error;
      }

      const trackerMap = mergeMapPresenceTrackers(data ? [data as MapPresenceTrackerRow] : []);
      setForm(createCrewFormState(trackerMap.crew));
    } catch (error) {
      console.error("Failed to load crew map marker", error);
      setForm(createDefaultCrewForm());
      toast.error("Impossibile caricare il tracker crew dal database. Ho aperto comunque l'editor locale.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCrewTracker();
  }, [loadCrewTracker]);

  const patchForm = useCallback((patch: Partial<CrewFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const updateCoordinates = useCallback(
    (latitude: number, longitude: number) => {
      patchForm({ latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) });
    },
    [patchForm]
  );

  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  const saveCrewTracker = useCallback(async () => {
    setSaving(true);
    try {
      const payload = buildCrewPayload(form, session?.user.id);
      const { data, error } = await supabase.from("logbook_map_markers").upsert(payload).select("*").single();
      if (error) throw error;

      setForm(createCrewFormState(data as MapPresenceTrackerRow));
      toast.success("Tracker crew aggiornato.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossibile salvare il tracker.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [form, session?.user.id]);

  const previewCoordinates = useMemo(() => getFormCoordinates(form), [form]);

  const clearPreviewMarker = useCallback(() => {
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
  }, []);

  const focusCrewOnMap = useCallback(() => {
    const map = mapRef.current;
    if (!map || !previewCoordinates) return;
    map.easeTo({
      center: [previewCoordinates.longitude, previewCoordinates.latitude],
      zoom: Math.max(map.getZoom(), 8),
      duration: 450,
      essential: true,
    });
  }, [previewCoordinates]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (mapUnavailable) return;

    if (!isMapLibreSupported()) {
      setMapUnavailable(true);
      return;
    }

    let map: maplibregl.Map | null = null;

    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: createThemedCartoStyle(),
        center: [15, 40],
        zoom: 5,
        attributionControl: false,
      });

      // La basemap segue il tema anche se cambia a mappa aperta.
      bindMapToTheme(map);

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        setMapLoaded(true);
        requestMapResize(map);
      });

      map.on("click", (event) => {
        const target = event.originalEvent.target as HTMLElement | null;
        if (target?.closest(".map-presence-marker")) return;
        if (!placingRef.current) return;

        updateCoordinates(event.lngLat.lat, event.lngLat.lng);
        setPlacing(false);
        toast.success("Nuova posizione crew impostata.");
      });

      mapResizeCleanupRef.current = bindMapToContainerResize(map, mapContainerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize admin map presence map", error);
      setMapUnavailable(true);
      setMapLoaded(false);
    }

    return () => {
      clearPreviewMarker();
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      map?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [clearPreviewMarker, mapUnavailable, updateCoordinates]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = placing ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [placing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clearPreviewMarker();

    if (!previewCoordinates) return;

    const title = form.label_it.trim() || "Equipaggio";
    const element = createCrewMarkerElement(title, { isDimmed: !form.is_visible || form.is_onboard });

    const marker = new maplibregl.Marker({ element, draggable: true, anchor: "center" })
      .setLngLat([previewCoordinates.longitude, previewCoordinates.latitude])
      .addTo(map);

    marker.on("dragstart", () => setPlacing(false));
    marker.on("dragend", () => {
      const position = marker.getLngLat();
      updateCoordinates(position.lat, position.lng);
    });

    previewMarkerRef.current = marker;

    if (!hasPerformedInitialFitRef.current) {
      hasPerformedInitialFitRef.current = true;
      map.jumpTo({ center: [previewCoordinates.longitude, previewCoordinates.latitude], zoom: 8 });
    }
  }, [clearPreviewMarker, form.is_onboard, form.is_visible, form.label_it, previewCoordinates, updateCoordinates]);

  const coordinatesReady = hasCoordinates(form);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
      <section className="glass-panel rounded-[30px] p-4 md:p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Tracker map</p>
            <h2 className="editorial-heading text-3xl md:text-4xl">Posizione crew</h2>
            <p className="mt-2 max-w-2xl text-sm font-sans text-muted-foreground leading-relaxed">
              Usa <span className="text-foreground font-medium">Posiziona sulla mappa</span> e clicca sulla carta, oppure trascina
              direttamente il marker. La posizione della barca non si imposta piu qui: e calcolata automaticamente dalle partenze/arrivi
              registrati sui viaggi (vedi il pannello a destra).
            </p>
          </div>
          <div className="glass-panel-soft rounded-[22px] px-4 py-3 text-sm font-sans text-muted-foreground">
            {loading ? "Caricamento tracker dal database in corso." : placing ? "Click sulla mappa per aggiornare la crew." : "Drag del marker attivo."}
          </div>
        </div>

        <div className="relative h-[30rem] overflow-hidden rounded-[26px] border border-glass-edge/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.46),rgba(243,246,247,0.7))] dark:bg-[linear-gradient(180deg,rgba(26,37,55,0.46),rgba(20,30,46,0.7))]">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {mapUnavailable ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-none w-[min(26rem,100%)] rounded-[24px] border border-glass-edge/70 bg-glass/82 px-5 py-5 text-center shadow-[0_20px_44px_rgba(15,23,42,0.10)] backdrop-blur-sm">
                <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-3">Mappa non disponibile</p>
                <p className="text-sm font-sans text-foreground/72 leading-relaxed">
                  Questo browser o dispositivo non riesce a inizializzare MapLibre in questa pagina admin. Puoi comunque inserire latitudine e
                  longitudine manualmente nel pannello a destra.
                </p>
              </div>
            </div>
          ) : !mapLoaded ? (
            <MapLoadingPlaceholder label="Caricamento mappa tracker" />
          ) : null}
        </div>
      </section>

      <div className="space-y-4">
        <section className="glass-panel-soft rounded-[30px] p-5 md:p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Tracker mappa</p>
              <div className="flex items-center gap-3">
                <span className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground">
                  <Users size={18} />
                </span>
                <div>
                  <h3 className="editorial-heading text-2xl">Crew</h3>
                  <p className="text-sm font-sans text-muted-foreground">Posizione manuale dell'equipaggio quando non e a bordo.</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {!form.is_visible && (
                <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  <EyeOff size={12} />
                  Nascosto
                </span>
              )}
              {form.is_onboard && (
                <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  <Users size={12} />
                  A bordo
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={placing ? "secondary" : "outline"} onClick={() => setPlacing((current) => !current)}>
              <Crosshair />
              Posiziona sulla mappa
            </Button>
            <Button type="button" variant="outline" disabled={!coordinatesReady} onClick={focusCrewOnMap}>
              <LocateFixed />
              Centra
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Titolo IT</label>
              <Input value={form.label_it} onChange={(event) => patchForm({ label_it: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Title EN</label>
              <Input value={form.label_en} onChange={(event) => patchForm({ label_en: event.target.value })} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Tooltip IT</label>
              <Textarea rows={3} value={form.description_it} onChange={(event) => patchForm({ description_it: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Tooltip EN</label>
              <Textarea rows={3} value={form.description_en} onChange={(event) => patchForm({ description_en: event.target.value })} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Latitudine</label>
              <Input inputMode="decimal" placeholder="45.4408" value={form.latitude} onChange={(event) => patchForm({ latitude: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Longitudine</label>
              <Input inputMode="decimal" placeholder="12.3155" value={form.longitude} onChange={(event) => patchForm({ longitude: event.target.value })} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">Visibile in mappa</p>
                <p className="text-sm font-sans text-foreground/72">Controlla se il marker compare nel logbook pubblico.</p>
              </div>
              <Switch checked={form.is_visible} onCheckedChange={(checked) => patchForm({ is_visible: checked })} />
            </div>
            <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">A bordo</p>
                <p className="text-sm font-sans text-foreground/72">Nasconde la crew nel pubblico.</p>
              </div>
              <Switch checked={form.is_onboard} onCheckedChange={(checked) => patchForm({ is_onboard: checked })} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-sans text-muted-foreground">
              Ultimo aggiornamento: <span className="text-foreground">{new Date(form.updated_at).toLocaleString("it-IT")}</span>
            </p>
            <Button type="button" onClick={() => void saveCrewTracker()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Salva tracker
            </Button>
          </div>
        </section>

        <section className="glass-panel-soft rounded-[30px] p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground">
              <Navigation size={18} />
            </span>
            <div>
              <h3 className="editorial-heading text-2xl">Barca</h3>
              <p className="text-sm font-sans text-muted-foreground">
                Posizione automatica, calcolata dalle partenze/arrivi registrati sui viaggi. Sola lettura.
              </p>
            </div>
          </div>

          {boatLoading ? (
            <p className="text-sm font-sans text-muted-foreground">Caricamento stato barca in corso.</p>
          ) : boatStatuses.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">Nessun viaggio attivo al momento.</p>
          ) : (
            <div className="space-y-3">
              {boatStatuses.map((status) => (
                <div key={status.voyageId} className="glass-panel rounded-[22px] px-4 py-3 flex items-start gap-3">
                  <span className="mt-0.5 text-muted-foreground">
                    <Anchor size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-sans font-medium text-foreground">{status.voyageName}</p>
                    <p className="text-sm font-sans text-foreground/72">
                      {status.position.status === "docked"
                        ? `Ormeggiata a ${status.fromLabel ?? "—"}.`
                        : `In navigazione da ${status.fromLabel ?? "—"} verso ${status.toLabel ?? "—"} (~${Math.round(
                            status.position.fraction * 100
                          )}%).`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminMapPresenceManager;
