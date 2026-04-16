import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, Loader2, Save, Ship, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import {
  buildMapPresenceUpsertPayload,
  mapPresenceTrackerIds,
  mergeMapPresenceTrackers,
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

const trackerCardCopy = {
  boat: {
    title: "Barca",
    eyebrow: "Marker pubblico",
    summary: "Posizione manuale di Spritz sulla mappa del logbook.",
  },
  crew: {
    title: "Crew",
    eyebrow: "Marker pubblico",
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

  const loadTrackers = useCallback(async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("logbook_map_markers")
        .select("*")
        .in("id", [...mapPresenceTrackerIds])
        .order("id", { ascending: true });

      if (error) throw error;

      const trackerMap = mergeMapPresenceTrackers((data || []) as MapPresenceTrackerRow[]);
      setForms({
        boat: createTrackerFormState(trackerMap.boat),
        crew: createTrackerFormState(trackerMap.crew),
      });
    } catch (error) {
      console.error("Failed to load logbook map markers", error);
      toast.error("Impossibile caricare i marker della mappa.");
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
        toast.success(id === "boat" ? "Marker barca aggiornato." : "Marker crew aggiornato.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Impossibile salvare il marker.";
        toast.error(message);
      } finally {
        setSavingId(null);
      }
    },
    [forms, session?.user.id, setTrackerForm]
  );

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
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="glass-panel-soft rounded-[28px] h-[23rem] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel-soft rounded-[28px] p-5 md:p-6">
        <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Presence markers</p>
        <p className="max-w-3xl text-sm font-sans text-muted-foreground leading-relaxed">
          Questi marker restano separati dalle rotte e compaiono solo sulla mappa del logbook. La crew puo essere nascosta con lo switch
          {" "}
          <span className="font-medium text-foreground">A bordo</span>
          {" "}
          che attiva anche la variante della barca con equipaggio a bordo.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {trackerEntries.map(({ id, icon: Icon, form, copy }) => (
          <section key={id} className="glass-panel-soft rounded-[30px] p-5 md:p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
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
              </div>
              {!form.is_visible && (
                <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  <EyeOff size={12} />
                  Nascosto
                </span>
              )}
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
                <Textarea
                  rows={3}
                  value={form.description_it}
                  onChange={(event) => setTrackerForm(id, { description_it: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Tooltip EN</label>
                <Textarea
                  rows={3}
                  value={form.description_en}
                  onChange={(event) => setTrackerForm(id, { description_en: event.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Latitudine</label>
                <Input
                  inputMode="decimal"
                  placeholder="45.4408"
                  value={form.latitude}
                  onChange={(event) => setTrackerForm(id, { latitude: event.target.value })}
                  disabled={id === "crew" && form.is_onboard}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Longitudine</label>
                <Input
                  inputMode="decimal"
                  placeholder="12.3155"
                  value={form.longitude}
                  onChange={(event) => setTrackerForm(id, { longitude: event.target.value })}
                  disabled={id === "crew" && form.is_onboard}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">Visibile in mappa</p>
                  <p className="text-sm font-sans text-foreground/72">
                    Il marker resta disponibile nel layer pubblico del logbook.
                  </p>
                </div>
                <Switch checked={form.is_visible} onCheckedChange={(checked) => setTrackerForm(id, { is_visible: checked })} />
              </div>

              {id === "crew" ? (
                <div className="glass-panel rounded-[22px] px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">A bordo</p>
                    <p className="text-sm font-sans text-foreground/72">
                      Oscura la crew e usa la barca con equipaggio a bordo.
                    </p>
                  </div>
                  <Switch checked={form.is_onboard} onCheckedChange={(checked) => setTrackerForm(id, { is_onboard: checked })} />
                </div>
              ) : (
                <div className="glass-panel rounded-[22px] px-4 py-3">
                  <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground mb-1">Variante barca</p>
                  <p className="text-sm font-sans text-foreground/72">
                    Se la crew e segnata come a bordo, questo marker cambia icona automaticamente.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-sans text-muted-foreground">
                Ultimo aggiornamento:
                {" "}
                <span className="text-foreground">{new Date(form.updated_at).toLocaleString("it-IT")}</span>
              </p>
              <Button onClick={() => void saveTracker(id)} disabled={savingId === id}>
                {savingId === id ? <Loader2 className="animate-spin" /> : <Save />}
                Salva marker
              </Button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default AdminMapPresenceManager;
