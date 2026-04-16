import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, EyeOff, Loader2, LocateFixed, MapPinned, Save, Ship, Users } from "lucide-react";
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
  createCartoRasterStyle,
  isMapLibreSupported,
  requestMapResize,
} from "@/lib/maplibre";
import {
  buildMapPresenceUpsertPayload,
  getMapPresenceIconMarkup,
  isMissingMapPresenceRelationError,
  mapPresenceTrackerIds,
  mergeMapPresenceTrackers,
  type MapPresenceMarkerKind,
  type MapPresenceTrackerId,
  type MapPresenceTrackerRow,
} from "@/lib/map-presence";

type TrackerFormState = {
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

type TrackerPreview = {
  id: MapPresenceTrackerId;
  kind: MapPresenceMarkerKind;
  latitude: number;
  longitude: number;
  isDimmed: boolean;
  title: string;
};

const trackerCardCopy = {
  boat: {
    title: "Barca",
    eyebrow: "Tracker mappa",
    summary: "Posizione manuale di Spritz sulla mappa del logbook.",
  },
  crew: {
    title: "Crew",
    eyebrow: "Tracker mappa",
    summary: "Posizione manuale dell'equipaggio quando non e a bordo.",
  },
} as const;

const formatCoordinateInput = (value: number | null) => (Number.isFinite(value) ? String(value) : "");

const createTrackerFormState = (row: MapPresenceTrackerRow): TrackerFormState => ({
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

const parseCoordinate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const hasCoordinates = (form: TrackerFormState) =>
  Number.isFinite(parseCoordinate(form.latitude)) && Number.isFinite(parseCoordinate(form.longitude));

const getTrackerCoordinates = (form: TrackerFormState) => {
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const createPresenceMarkerElement = (
  kind: MapPresenceMarkerKind,
  title: string,
  options?: { isSelected?: boolean; isDimmed?: boolean }
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `map-presence-marker map-presence-marker--${kind}`;
  if (options?.isSelected) button.classList.add("map-presence-marker--selected");
  if (options?.isDimmed) button.classList.add("map-presence-marker--dimmed");
  button.setAttribute("aria-label", title);
  button.title = title;
  button.innerHTML = `
    <span class="map-presence-marker__halo" aria-hidden="true"></span>
    <span class="map-presence-marker__chip" aria-hidden="true">
      <span class="map-presence-marker__icon">${getMapPresenceIconMarkup(kind)}</span>
    </span>
  `;
  return button;
};

const buildTrackerPayload = (
  id: MapPresenceTrackerId,
  form: TrackerFormState,
  userId: string | null | undefined
): TablesInsert<"logbook_map_markers"> => {
  const fallbackLabelIt = id === "boat" ? "Spritz" : "Equipaggio";
  const fallbackLabelEn = id === "boat" ? "Spritz" : "Crew";
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

  return buildMapPresenceUpsertPayload(id, {
    label_it: form.label_it.trim() || fallbackLabelIt,
    label_en: form.label_en.trim() || fallbackLabelEn,
    description_it: form.description_it.trim() || null,
    description_en: form.description_en.trim() || null,
    latitude: coordinatesAreEmpty ? null : latitude,
    longitude: coordinatesAreEmpty ? null : longitude,
    is_visible: form.is_visible,
    is_onboard: id === "crew" ? form.is_onboard : false,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  });
};

const AdminMapPresenceManager = () => {
  const { session } = useAuth();
  const [forms, setForms] = useState<Record<MapPresenceTrackerId, TrackerFormState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<MapPresenceTrackerId | null>(null);
  const [activeTrackerId, setActiveTrackerId] = useState<MapPresenceTrackerId>("boat");
  const [placingTrackerId, setPlacingTrackerId] = useState<MapPresenceTrackerId | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapResizeCleanupRef = useRef<(() => void) | null>(null);
  const previewMarkersRef = useRef<Record<MapPresenceTrackerId, maplibregl.Marker | null>>({
    boat: null,
    crew: null,
  });
  const hasPerformedInitialFitRef = useRef(false);
  const placingTrackerIdRef = useRef<MapPresenceTrackerId | null>(null);

  const loadTrackers = useCallback(async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("logbook_map_markers")
        .select("*")
        .in("id", [...mapPresenceTrackerIds])
        .order("id", { ascending: true });

      if (error) {
        if (isMissingMapPresenceRelationError(error)) {
          const trackerMap = mergeMapPresenceTrackers([]);
          setForms({
            boat: createTrackerFormState(trackerMap.boat),
            crew: createTrackerFormState(trackerMap.crew),
          });
          toast.error("La tabella dei tracker non e ancora disponibile sul database. La mappa e visibile, ma prima applica la migration.");
          return;
        }
        throw error;
      }

      const trackerMap = mergeMapPresenceTrackers((data || []) as MapPresenceTrackerRow[]);
      setForms({
        boat: createTrackerFormState(trackerMap.boat),
        crew: createTrackerFormState(trackerMap.crew),
      });
    } catch (error) {
      console.error("Failed to load logbook map markers", error);
      const trackerMap = mergeMapPresenceTrackers([]);
      setForms({
        boat: createTrackerFormState(trackerMap.boat),
        crew: createTrackerFormState(trackerMap.crew),
      });
      toast.error("Impossibile caricare i tracker dal database. Ho aperto comunque l'editor locale.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrackers();
  }, [loadTrackers]);

  const setTrackerForm = useCallback(
    (id: MapPresenceTrackerId, patch: Partial<TrackerFormState>) => {
      setForms((current) => {
        if (!current) return current;
        return {
          ...current,
          [id]: {
            ...current[id],
            ...patch,
          },
        };
      });
    },
    []
  );

  const updateTrackerCoordinates = useCallback(
    (id: MapPresenceTrackerId, latitude: number, longitude: number) => {
      setTrackerForm(id, {
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
      });
    },
    [setTrackerForm]
  );

  useEffect(() => {
    placingTrackerIdRef.current = placingTrackerId;
  }, [placingTrackerId]);

  const saveTracker = useCallback(
    async (id: MapPresenceTrackerId) => {
      if (!forms) return;

      setSavingId(id);
      try {
        const payload = buildTrackerPayload(id, forms[id], session?.user.id);
        const { data, error } = await supabase
          .from("logbook_map_markers")
          .upsert(payload)
          .select("*")
          .single();

        if (error) throw error;

        const row = data as MapPresenceTrackerRow;
        setTrackerForm(id, createTrackerFormState(row));
        toast.success(id === "boat" ? "Tracker barca aggiornato." : "Tracker crew aggiornato.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Impossibile salvare il tracker.";
        toast.error(message);
      } finally {
        setSavingId(null);
      }
    },
    [forms, session?.user.id, setTrackerForm]
  );

  const trackerPreviews = useMemo<TrackerPreview[]>(() => {
    if (!forms) return [];

    return mapPresenceTrackerIds.flatMap((id): TrackerPreview[] => {
      const form = forms[id];
      const coordinates = getTrackerCoordinates(form);
      if (!coordinates) return [];

      if (id === "boat") {
        return [
          {
            id,
            kind: forms.crew.is_onboard ? "boat-aboard" : "boat",
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            isDimmed: !form.is_visible,
            title: form.label_it.trim() || "Spritz",
          },
        ];
      }

      return [
        {
          id,
          kind: "crew",
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          isDimmed: !form.is_visible || form.is_onboard,
          title: form.label_it.trim() || "Equipaggio",
        },
      ];
    });
  }, [forms]);

  const clearPreviewMarkers = useCallback(() => {
    mapPresenceTrackerIds.forEach((id) => {
      previewMarkersRef.current[id]?.remove();
      previewMarkersRef.current[id] = null;
    });
  }, []);

  const focusTrackerOnMap = useCallback(
    (id: MapPresenceTrackerId) => {
      if (!forms) return;

      const map = mapRef.current;
      const coordinates = getTrackerCoordinates(forms[id]);
      if (!map || !coordinates) return;

      map.easeTo({
        center: [coordinates.longitude, coordinates.latitude],
        zoom: Math.max(map.getZoom(), 8),
        duration: 450,
        essential: true,
      });
    },
    [forms]
  );

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
        style: createCartoRasterStyle(),
        center: [15, 40],
        zoom: 5,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        setMapLoaded(true);
        requestMapResize(map);
      });

      map.on("click", (event) => {
        const target = event.originalEvent.target as HTMLElement | null;
        if (target?.closest(".map-presence-marker")) return;

        const trackerId = placingTrackerIdRef.current;
        if (!trackerId) return;

        updateTrackerCoordinates(trackerId, event.lngLat.lat, event.lngLat.lng);
        setActiveTrackerId(trackerId);
        setPlacingTrackerId(null);
        toast.success(trackerId === "boat" ? "Nuova posizione barca impostata." : "Nuova posizione crew impostata.");
      });

      mapResizeCleanupRef.current = bindMapToContainerResize(map, mapContainerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize admin map presence map", error);
      setMapUnavailable(true);
      setMapLoaded(false);
    }

    return () => {
      clearPreviewMarkers();
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      map?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [clearPreviewMarkers, mapUnavailable, updateTrackerCoordinates]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = placingTrackerId ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [placingTrackerId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !forms) return;

    clearPreviewMarkers();

    trackerPreviews.forEach((tracker) => {
      const element = createPresenceMarkerElement(tracker.kind, tracker.title, {
        isSelected: activeTrackerId === tracker.id,
        isDimmed: tracker.isDimmed,
      });

      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setActiveTrackerId(tracker.id);
      });

      const marker = new maplibregl.Marker({
        element,
        draggable: true,
        anchor: "center",
      })
        .setLngLat([tracker.longitude, tracker.latitude])
        .addTo(map);

      marker.on("dragstart", () => {
        setActiveTrackerId(tracker.id);
        setPlacingTrackerId(null);
      });

      marker.on("dragend", () => {
        const position = marker.getLngLat();
        updateTrackerCoordinates(tracker.id, position.lat, position.lng);
      });

      previewMarkersRef.current[tracker.id] = marker;
    });

    if (!hasPerformedInitialFitRef.current && trackerPreviews.length > 0) {
      hasPerformedInitialFitRef.current = true;
      if (trackerPreviews.length === 1) {
        map.jumpTo({
          center: [trackerPreviews[0].longitude, trackerPreviews[0].latitude],
          zoom: 8,
        });
      } else {
        const bounds = trackerPreviews.reduce(
          (accumulator, tracker) => accumulator.extend([tracker.longitude, tracker.latitude]),
          new maplibregl.LngLatBounds(
            [trackerPreviews[0].longitude, trackerPreviews[0].latitude],
            [trackerPreviews[0].longitude, trackerPreviews[0].latitude]
          )
        );
        map.fitBounds(bounds, { padding: 70, maxZoom: 9, duration: 0 });
      }
    }
  }, [activeTrackerId, clearPreviewMarkers, forms, trackerPreviews, updateTrackerCoordinates]);

  const trackerEntries = useMemo(
    () =>
      mapPresenceTrackerIds.map((id) => ({
        id,
        icon: id === "boat" ? Ship : Users,
        form: forms?.[id] ?? null,
        copy: trackerCardCopy[id],
      })),
    [forms]
  );

  if (loading || !forms) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="glass-panel-soft rounded-[30px] min-h-[32rem] animate-pulse" />
        <div className="grid gap-4">
          {[0, 1].map((item) => (
            <div key={item} className="glass-panel-soft rounded-[28px] h-[24rem] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
      <section className="glass-panel rounded-[30px] p-4 md:p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Tracker map</p>
            <h2 className="editorial-heading text-3xl md:text-4xl">Posizionamento</h2>
            <p className="mt-2 max-w-2xl text-sm font-sans text-muted-foreground leading-relaxed">
              Seleziona un tracker, poi usa
              {" "}
              <span className="text-foreground font-medium">Posiziona sulla mappa</span>
              {" "}
              e clicca sulla carta, oppure trascina direttamente il marker come fai con i waypoint.
            </p>
          </div>
          <div className="glass-panel-soft rounded-[22px] px-4 py-3 text-sm font-sans text-muted-foreground">
            {placingTrackerId
              ? `Click sulla mappa per aggiornare ${placingTrackerId === "boat" ? "la barca" : "la crew"}.`
              : "Drag dei marker attivo. Nessun piazzamento in attesa."}
          </div>
        </div>

        <div className="relative h-[30rem] overflow-hidden rounded-[26px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.46),rgba(243,246,247,0.7))]">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {mapUnavailable ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-none w-[min(26rem,100%)] rounded-[24px] border border-white/70 bg-white/82 px-5 py-5 text-center shadow-[0_20px_44px_rgba(15,23,42,0.10)] backdrop-blur-sm">
                <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-3">Mappa non disponibile</p>
                <p className="text-sm font-sans text-foreground/72 leading-relaxed">
                  Questo browser o dispositivo non riesce a inizializzare MapLibre in questa pagina admin. Puoi comunque inserire latitudine e
                  longitudine manualmente nei pannelli a destra.
                </p>
              </div>
            </div>
          ) : !mapLoaded ? (
            <MapLoadingPlaceholder label="Caricamento mappa tracker" />
          ) : null}
        </div>
      </section>

      <div className="space-y-4">
        {trackerEntries.map(({ id, icon: Icon, form, copy }) => {
          const coordinatesReady = hasCoordinates(form);
          const isActive = activeTrackerId === id;
          const saving = savingId === id;

          return (
            <section
              key={id}
              className={`glass-panel-soft rounded-[30px] p-5 md:p-6 space-y-5 transition-colors ${
                isActive ? "ring-1 ring-accent/40" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTrackerId(id);
                    setPlacingTrackerId(null);
                    if (coordinatesReady) {
                      focusTrackerOnMap(id);
                    }
                  }}
                  className="text-left"
                >
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{copy.eyebrow}</p>
                  <div className="flex items-center gap-3">
                    <span className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground">
                      <Icon size={18} />
                    </span>
                    <div>
                      <h3 className="editorial-heading text-2xl">{copy.title}</h3>
                      <p className="text-sm font-sans text-muted-foreground">{copy.summary}</p>
                    </div>
                  </div>
                </button>
                <div className="flex flex-col items-end gap-2">
                  {!form.is_visible && (
                    <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      <EyeOff size={12} />
                      Nascosto
                    </span>
                  )}
                  {id === "crew" && form.is_onboard && (
                    <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      <Users size={12} />
                      A bordo
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={placingTrackerId === id ? "secondary" : "outline"}
                  onClick={() => {
                    setActiveTrackerId(id);
                    setPlacingTrackerId((current) => (current === id ? null : id));
                  }}
                >
                  <Crosshair />
                  Posiziona sulla mappa
                </Button>
                <Button type="button" variant="outline" disabled={!coordinatesReady} onClick={() => focusTrackerOnMap(id)}>
                  <LocateFixed />
                  Centra
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Titolo IT</label>
                  <Input value={form.label_it} onChange={(event) => setTrackerForm(id, { label_it: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Title EN</label>
                  <Input value={form.label_en} onChange={(event) => setTrackerForm(id, { label_en: event.target.value })} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Tooltip IT</label>
                  <Textarea rows={3} value={form.description_it} onChange={(event) => setTrackerForm(id, { description_it: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Tooltip EN</label>
                  <Textarea rows={3} value={form.description_en} onChange={(event) => setTrackerForm(id, { description_en: event.target.value })} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Latitudine</label>
                  <Input inputMode="decimal" placeholder="45.4408" value={form.latitude} onChange={(event) => setTrackerForm(id, { latitude: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Longitudine</label>
                  <Input inputMode="decimal" placeholder="12.3155" value={form.longitude} onChange={(event) => setTrackerForm(id, { longitude: event.target.value })} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">Visibile in mappa</p>
                    <p className="text-sm font-sans text-foreground/72">Controlla se il marker compare nel logbook pubblico.</p>
                  </div>
                  <Switch checked={form.is_visible} onCheckedChange={(checked) => setTrackerForm(id, { is_visible: checked })} />
                </div>

                {id === "crew" ? (
                  <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">A bordo</p>
                      <p className="text-sm font-sans text-foreground/72">Nasconde la crew nel pubblico e attiva la barca con equipaggio.</p>
                    </div>
                    <Switch checked={form.is_onboard} onCheckedChange={(checked) => setTrackerForm(id, { is_onboard: checked })} />
                  </div>
                ) : (
                  <div className="glass-panel rounded-[22px] px-4 py-3">
                    <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground mb-1">Variante barca</p>
                    <p className="text-sm font-sans text-foreground/72">Segue automaticamente lo stato “a bordo” della crew.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-sans text-muted-foreground">
                  Ultimo aggiornamento:
                  {" "}
                  <span className="text-foreground">{new Date(form.updated_at).toLocaleString("it-IT")}</span>
                </p>
                <Button type="button" onClick={() => void saveTracker(id)} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  Salva tracker
                </Button>
              </div>
            </section>
          );
        })}

        <div className="glass-panel-soft rounded-[26px] p-5">
          <div className="flex items-start gap-3">
            <span className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground">
              <MapPinned size={16} />
            </span>
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-2">Workflow</p>
              <p className="text-sm font-sans text-foreground/72 leading-relaxed">
                Seleziona il tracker, entra in modalita posizionamento e clicca sulla mappa. Per micro-spostamenti puoi trascinare il marker
                direttamente come nel manager dei waypoint.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminMapPresenceManager;
