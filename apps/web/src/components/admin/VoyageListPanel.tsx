import type { Dispatch, SetStateAction } from "react";
import { Edit, ChevronDown, ChevronRight } from "lucide-react";
import { getLocalizedVoyageName, type Voyage } from "@/lib/voyage-utils";
import type { Language } from "@/lib/language";
import type { VoyageListFilters, VoyageListSort } from "@/components/admin/AdminVoyageManager";

export interface VoyageListPanelProps {
  voyages: Voyage[];
  visibleVoyages: Voyage[];
  hasActiveFilters: boolean;
  listFilters: VoyageListFilters;
  setListFilters: Dispatch<SetStateAction<VoyageListFilters>>;
  listSort: VoyageListSort;
  setListSort: Dispatch<SetStateAction<VoyageListSort>>;
  routeListFiltersExpanded: boolean;
  setRouteListFiltersExpanded: Dispatch<SetStateAction<boolean>>;
  routeListFiltersAdvanced: boolean;
  setRouteListFiltersAdvanced: Dispatch<SetStateAction<boolean>>;
  selectedVoyageId: string | null;
  lang: Language;
  onSelectVoyage: (voyageId: string) => void;
  onEditVoyage: (voyage: Voyage) => void;
  onResetFilters: () => void;
}

const VoyageListPanel = ({
  voyages,
  visibleVoyages,
  hasActiveFilters,
  listFilters,
  setListFilters,
  listSort,
  setListSort,
  routeListFiltersExpanded,
  setRouteListFiltersExpanded,
  routeListFiltersAdvanced,
  setRouteListFiltersAdvanced,
  selectedVoyageId,
  lang,
  onSelectVoyage,
  onEditVoyage,
  onResetFilters,
}: VoyageListPanelProps) => {
  return (
    <>
      <div className="rounded-[16px] border border-border/70 bg-muted/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setRouteListFiltersExpanded((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans hover:bg-muted/30 transition-colors"
          aria-expanded={routeListFiltersExpanded}
        >
          {routeListFiltersExpanded ? (
            <ChevronDown className="shrink-0 text-muted-foreground" size={16} aria-hidden />
          ) : (
            <ChevronRight className="shrink-0 text-muted-foreground" size={16} aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">Filtri rotte</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {visibleVoyages.length}/{voyages.length} visibili
              {hasActiveFilters ? " · filtri attivi" : ""}
            </span>
          </div>
          {hasActiveFilters ? (
            <span
              role="presentation"
              className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider text-foreground"
            >
              Attivi
            </span>
          ) : null}
        </button>

        {routeListFiltersExpanded ? (
          <div className="border-t border-border/60 px-3 pb-2.5 pt-1 space-y-2">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
              <div className="min-w-[7.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Tipologia
                </label>
                <select
                  value={listFilters.type}
                  onChange={(event) =>
                    setListFilters((current) => ({ ...current, type: event.target.value as VoyageListFilters["type"] }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="all">Tutte</option>
                  <option value="water">Acqua</option>
                  <option value="land">Terra</option>
                </select>
              </div>

              <div className="min-w-[7.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Stato
                </label>
                <select
                  value={listFilters.publicationStatus}
                  onChange={(event) =>
                    setListFilters((current) => ({
                      ...current,
                      publicationStatus: event.target.value as VoyageListFilters["publicationStatus"],
                    }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="all">Tutte</option>
                  <option value="published">Pubblicate</option>
                  <option value="draft">Bozze</option>
                </select>
              </div>

              <div className="min-w-[9.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Data (filtro)
                </label>
                <select
                  value={listFilters.dateFilterMode}
                  onChange={(event) =>
                    setListFilters((current) => ({
                      ...current,
                      dateFilterMode: event.target.value as VoyageListFilters["dateFilterMode"],
                    }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="created">Creazione</option>
                  <option value="departure">Partenza viaggio</option>
                </select>
              </div>

              <div className="flex min-w-0 flex-[2] flex-wrap items-end gap-x-1.5 gap-y-1">
                <div className="min-w-[6.5rem] flex-1">
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Da
                  </label>
                  <input
                    type="date"
                    value={listFilters.dateFrom}
                    onChange={(event) => setListFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                    className="w-full min-w-0 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="min-w-[6.5rem] flex-1">
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    A
                  </label>
                  <input
                    type="date"
                    value={listFilters.dateTo}
                    onChange={(event) => setListFilters((current) => ({ ...current, dateTo: event.target.value }))}
                    className="w-full min-w-0 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRouteListFiltersAdvanced((v) => !v)}
                className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
              >
                {routeListFiltersAdvanced ? "Nascondi avanzate" : "Avanzate"}
              </button>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset filtri
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setRouteListFiltersExpanded(false)}
                className="ml-auto text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
              >
                Chiudi
              </button>
            </div>

            {routeListFiltersAdvanced ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/40">
                <div>
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Ordina per
                  </label>
                  <select
                    value={listSort.field}
                    onChange={(event) =>
                      setListSort((current) => ({ ...current, field: event.target.value as VoyageListSort["field"] }))
                    }
                    className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="created_at">Data creazione</option>
                    <option value="start_date">Data partenza</option>
                    <option value="type">Tipologia</option>
                    <option value="publicationStatus">Stato</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Direzione
                  </label>
                  <select
                    value={listSort.direction}
                    onChange={(event) =>
                      setListSort((current) => ({
                        ...current,
                        direction: event.target.value as VoyageListSort["direction"],
                      }))
                    }
                    className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-[20px] border border-border/70 bg-background/40 p-3 space-y-2">
        <p className="text-xs font-sans font-medium text-foreground">Elenco rotte</p>
        {visibleVoyages.length === 0 ? (
          <p className="text-xs text-muted-foreground font-sans py-1">Nessuna rotta con i filtri attuali.</p>
        ) : (
          <div className="space-y-1.5 max-h-[min(240px,40vh)] overflow-y-auto pr-1">
            {visibleVoyages.map((voyage) => {
              const displayName = getLocalizedVoyageName(voyage, lang);
              const isActive = selectedVoyageId === voyage.id;
              return (
                <div key={voyage.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectVoyage(voyage.id)}
                    className={`flex-1 min-w-0 rounded-[14px] border px-3 py-2 text-left text-sm font-sans transition-colors ${
                      isActive
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border/70 bg-background/60 hover:border-accent/50 text-foreground"
                    }`}
                  >
                    <span className="block truncate">{displayName}</span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {voyage.type} · {voyage.status}
                      {!voyage.is_published ? " · bozza" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditVoyage(voyage)}
                    className="shrink-0 self-stretch inline-flex items-center justify-center rounded-[14px] border border-border/70 bg-background/80 px-2.5 text-muted-foreground hover:border-accent hover:text-foreground transition-colors"
                    title="Modifica nome, descrizione e dettagli viaggio (non i waypoint)"
                    aria-label="Modifica info viaggio"
                  >
                    <Edit size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default VoyageListPanel;
