import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { geocodePlaces, type GeocodedPlace } from "@/lib/voyage-utils";

export interface VoyageLegCorrectionWaypoint {
  id: string;
  name: string;
  sortOrder: number;
}

export interface VoyageLegCorrectionModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save, so the widget can reload its leg/waypoint data. */
  onSaved: () => void;
  voyageId: string;
  /** Where the boat is now (already departed from): the current leg's from_waypoint. */
  fromWaypoint: VoyageLegCorrectionWaypoint;
  /** The next planned stop (currentLeg.to_waypoint): the one this modal can mark skipped. */
  toWaypoint: VoyageLegCorrectionWaypoint;
  lang: "it" | "en";
}

const copy = {
  it: {
    title: "Correggi tappa successiva",
    description: (from: string, to: string) =>
      `Solo per la tratta in corso, da ${from} a ${to}. Per modifiche più ampie al percorso usa l'editor di rotta classico.`,
    skipLabel: (to: string) => `La tappa prevista "${to}" non è stata raggiunta`,
    narrativeTitle: "Tappa reale (facoltativa)",
    narrativeHint: "Al massimo una, sostitutiva o aggiuntiva. Per un'altra riapri questa modale.",
    technicalTitle: "Tappe tecniche (facoltative)",
    technicalHint: "Solo per la forma del percorso: nessun nome pubblico.",
    searchPlaceholder: "Cerca un luogo...",
    add: "Aggiungi",
    remove: "Rimuovi",
    save: "Salva correzione",
    saving: "Salvo...",
    cancel: "Annulla",
    selected: "Selezionata",
    noResults: "Nessun risultato",
  },
  en: {
    title: "Correct next stop",
    description: (from: string, to: string) =>
      `Scoped to the current leg only, from ${from} to ${to}. For bigger route changes use the classic route editor.`,
    skipLabel: (to: string) => `The planned stop "${to}" was not reached`,
    narrativeTitle: "Real stop (optional)",
    narrativeHint: "At most one, replacing or additional. Reopen this modal for another.",
    technicalTitle: "Technical stops (optional)",
    technicalHint: "Route shape only: no public name.",
    searchPlaceholder: "Search a place...",
    add: "Add",
    remove: "Remove",
    save: "Save correction",
    saving: "Saving...",
    cancel: "Cancel",
    selected: "Selected",
    noResults: "No results",
  },
} as const;

const VoyageLegCorrectionModal = ({
  open,
  onClose,
  onSaved,
  voyageId,
  fromWaypoint,
  toWaypoint,
  lang,
}: VoyageLegCorrectionModalProps) => {
  const t = copy[lang];
  const [skipNext, setSkipNext] = useState(false);

  const [narrativeQuery, setNarrativeQuery] = useState("");
  const [narrativeResults, setNarrativeResults] = useState<GeocodedPlace[]>([]);
  const [narrativeSearching, setNarrativeSearching] = useState(false);
  const [narrativeSelected, setNarrativeSelected] = useState<GeocodedPlace | null>(null);

  const [technicalQuery, setTechnicalQuery] = useState("");
  const [technicalResults, setTechnicalResults] = useState<GeocodedPlace[]>([]);
  const [technicalSearching, setTechnicalSearching] = useState(false);
  const [technicalStops, setTechnicalStops] = useState<GeocodedPlace[]>([]);

  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSkipNext(false);
    setNarrativeQuery("");
    setNarrativeResults([]);
    setNarrativeSelected(null);
    setTechnicalQuery("");
    setTechnicalResults([]);
    setTechnicalStops([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runSearch = async (
    query: string,
    setResults: (results: GeocodedPlace[]) => void,
    setSearching: (value: boolean) => void
  ) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const results = await geocodePlaces(query, 5);
      setResults(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const hasWork = skipNext || Boolean(narrativeSelected) || technicalStops.length > 0;

  const handleSave = async () => {
    if (!hasWork) {
      handleClose();
      return;
    }
    setSaving(true);
    try {
      const newStops: { place: GeocodedPlace; waypoint_type: "narrative" | "technical" }[] = [];
      if (narrativeSelected) newStops.push({ place: narrativeSelected, waypoint_type: "narrative" });
      technicalStops.forEach((place) => newStops.push({ place, waypoint_type: "technical" }));

      if (newStops.length > 0) {
        // Un'unica RPC transazionale: sposta in blocco il sort_order delle tappe
        // a valle e inserisce le nuove in un solo statement atomico, senza gli
        // N round-trip separati di prima (a rischio di sort_order incoerente su
        // un errore a metà o due correzioni concorrenti sulla stessa leg).
        const { error } = await supabase.rpc("insert_voyage_leg_correction_stops", {
          _voyage_id: voyageId,
          _anchor_sort_order: toWaypoint.sortOrder,
          _stops: newStops.map((stop) => ({
            lat: stop.place.lat,
            lng: stop.place.lng,
            name: stop.place.name,
            waypoint_type: stop.waypoint_type,
          })),
        });
        if (error) throw error;
      }

      if (skipNext) {
        const { error } = await supabase.rpc("set_voyage_waypoint_actual_status", {
          _waypoint_id: toWaypoint.id,
          _status: "skipped",
        });
        if (error) throw error;
      }

      toast.success(lang === "it" ? "Correzione salvata" : "Correction saved");
      reset();
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description(fromWaypoint.name, toWaypoint.name)}</DialogDescription>

        <label className="flex items-start gap-2.5 rounded-[16px] border border-border/60 bg-muted/30 p-3 text-sm font-sans">
          <input
            type="checkbox"
            checked={skipNext}
            onChange={(event) => setSkipNext(event.target.checked)}
            className="mt-0.5"
          />
          <span>{t.skipLabel(toWaypoint.name)}</span>
        </label>

        <section className="grid gap-2">
          <div>
            <p className="text-xs font-sans font-semibold uppercase tracking-[0.1em] text-foreground">{t.narrativeTitle}</p>
            <p className="text-[11px] text-muted-foreground font-sans">{t.narrativeHint}</p>
          </div>
          {narrativeSelected ? (
            <div className="flex items-center gap-2 rounded-[14px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-sans">
              <MapPin size={14} className="shrink-0 text-accent" />
              <span className="flex-1 min-w-0 truncate">{narrativeSelected.name}</span>
              <button
                type="button"
                onClick={() => setNarrativeSelected(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t.remove}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={narrativeQuery}
                  onChange={(event) => setNarrativeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void runSearch(narrativeQuery, setNarrativeResults, setNarrativeSearching);
                  }}
                  placeholder={t.searchPlaceholder}
                  className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void runSearch(narrativeQuery, setNarrativeResults, setNarrativeSearching)}
                  disabled={narrativeSearching}
                  className="inline-flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-sans text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  {narrativeSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </div>
              {narrativeResults.length > 0 && (
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                  {narrativeResults.map((result, index) => (
                    <button
                      type="button"
                      key={`${result.lat}-${result.lng}-${index}`}
                      onClick={() => {
                        setNarrativeSelected(result);
                        setNarrativeResults([]);
                        setNarrativeQuery("");
                      }}
                      className="block w-full rounded-[12px] border border-border/60 bg-background/60 px-3 py-2 text-left text-xs font-sans hover:border-accent"
                    >
                      {result.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="grid gap-2">
          <div>
            <p className="text-xs font-sans font-semibold uppercase tracking-[0.1em] text-foreground">{t.technicalTitle}</p>
            <p className="text-[11px] text-muted-foreground font-sans">{t.technicalHint}</p>
          </div>
          {technicalStops.length > 0 && (
            <ul className="space-y-1.5">
              {technicalStops.map((stop, index) => (
                <li
                  key={`${stop.lat}-${stop.lng}-${index}`}
                  className="flex items-center gap-2 rounded-[14px] border border-border/60 bg-muted/30 px-3 py-2 text-sm font-sans"
                >
                  <MapPin size={14} className="shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">{stop.name}</span>
                  <button
                    type="button"
                    onClick={() => setTechnicalStops((current) => current.filter((_, i) => i !== index))}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t.remove}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={technicalQuery}
              onChange={(event) => setTechnicalQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void runSearch(technicalQuery, setTechnicalResults, setTechnicalSearching);
              }}
              placeholder={t.searchPlaceholder}
              className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void runSearch(technicalQuery, setTechnicalResults, setTechnicalSearching)}
              disabled={technicalSearching}
              className="inline-flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-sans text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              {technicalSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
          </div>
          {technicalResults.length > 0 && (
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
              {technicalResults.map((result, index) => (
                <button
                  type="button"
                  key={`${result.lat}-${result.lng}-${index}`}
                  onClick={() => {
                    setTechnicalStops((current) => [...current, result]);
                    setTechnicalResults([]);
                    setTechnicalQuery("");
                  }}
                  className="block w-full rounded-[12px] border border-border/60 bg-background/60 px-3 py-2 text-left text-xs font-sans hover:border-accent"
                >
                  {result.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-full border border-border px-4 py-2 text-sm font-sans text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !hasWork}
            className="rounded-full bg-primary px-4 py-2 text-sm font-sans text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VoyageLegCorrectionModal;
