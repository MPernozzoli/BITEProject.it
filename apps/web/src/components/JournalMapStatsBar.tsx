import { Anchor, Check, ChevronDown, Mountain, Navigation, Ship } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getLocalizedVoyageName, type Voyage } from "@/lib/voyage-utils";
import type { Language } from "@/lib/language";

const getVoyageTypeIconClassName = (voyageType: Voyage["type"]) =>
  voyageType === "water" ? "text-sky-700" : "text-orange-700";

const getVoyageStatusPillClassName = (status: Voyage["status"]) => {
  if (status === "planned") {
    return "border border-dashed border-slate-300/80 bg-slate-50/65 text-slate-600";
  }

  if (status === "active") {
    return "border border-sky-300/75 bg-sky-50/75 text-sky-800";
  }

  return "border border-slate-300/75 bg-white/70 text-slate-700";
};

export interface JournalMapStats {
  seaNM: number;
  landKM: number;
  voyageCount: number;
  activeVoyage: Voyage | undefined;
}

/**
 * Barra statistiche flottante al centro-alto della vista mappa del logbook:
 * miglia in mare, km a terra, numero viaggi e selettore viaggio/tipo.
 * Solo desktop (`hidden md:flex`).
 */
export interface JournalMapStatsBarProps {
  stats: JournalMapStats;
  voyages: Voyage[];
  filteredVoyages: Voyage[];
  voyageTypeFilter: "all" | Voyage["type"];
  setVoyageTypeFilter: (filter: "all" | Voyage["type"]) => void;
  voyageFilterOpen: boolean;
  setVoyageFilterOpen: (open: boolean) => void;
  focusedVoyageId: string | null;
  handleVoyageFilterSelect: (voyageId: string | null) => void;
  lang: Language;
}

const JournalMapStatsBar = ({
  stats,
  voyages,
  filteredVoyages,
  voyageTypeFilter,
  setVoyageTypeFilter,
  voyageFilterOpen,
  setVoyageFilterOpen,
  focusedVoyageId,
  handleVoyageFilterSelect,
  lang,
}: JournalMapStatsBarProps) => {
  if (stats.seaNM <= 0 && stats.landKM <= 0) return null;

  return (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-2 rounded-full bg-background/75 backdrop-blur-xl border border-white/60 shadow-lg px-4 py-2">
          {stats.seaNM > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-sky-800/85">
              <Ship size={10} /> {stats.seaNM.toLocaleString()} NM
            </span>
          ) : null}
          {stats.seaNM > 0 && stats.landKM > 0 ? <span className="w-px h-3 bg-border" /> : null}
          {stats.landKM > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-orange-800/85">
              <Mountain size={10} /> {stats.landKM.toLocaleString()} KM
            </span>
          ) : null}
          <span className="w-px h-3 bg-border" />
          <Popover open={voyageFilterOpen} onOpenChange={setVoyageFilterOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-sans tracking-wider uppercase transition-colors duration-interaction ease-out-expo ${
                  focusedVoyageId ? "bg-accent/12 text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Navigation size={10} />
                {stats.voyageCount} {lang === "it" ? "viaggi" : "voyages"}
                <ChevronDown size={10} className={`transition-transform duration-200 ease-out-expo ${voyageFilterOpen ? "rotate-180" : ""}`} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              sideOffset={12}
              className="w-[340px] max-h-[min(72vh,560px)] flex flex-col overflow-hidden rounded-[24px] border-white/60 bg-background/88 p-2 backdrop-blur-2xl"
            >
              <div className="mb-1 shrink-0 px-2 py-1">
                <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                  {lang === "it" ? "Focus viaggio" : "Voyage focus"}
                </p>
              </div>
              <div className="mb-2 flex shrink-0 items-center gap-1 px-2">
                <button
                  type="button"
                  onClick={() => setVoyageTypeFilter("all")}
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                    voyageTypeFilter === "all"
                      ? "bg-foreground text-background"
                      : "bg-white/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "it" ? "tutti" : "all"}
                </button>
                <button
                  type="button"
                  onClick={() => setVoyageTypeFilter("water")}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                    voyageTypeFilter === "water"
                      ? "bg-sky-100 text-sky-800"
                      : "bg-sky-50/70 text-sky-700 hover:bg-sky-100"
                  }`}
                >
                  <Ship size={10} />
                  {lang === "it" ? "mare" : "water"}
                </button>
                <button
                  type="button"
                  onClick={() => setVoyageTypeFilter("land")}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                    voyageTypeFilter === "land"
                      ? "bg-orange-100 text-orange-800"
                      : "bg-orange-50/70 text-orange-700 hover:bg-orange-100"
                  }`}
                >
                  <Mountain size={10} />
                  {lang === "it" ? "terra" : "land"}
                </button>
              </div>
              <div className="max-h-[min(52vh,440px)] min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
                <button
                  type="button"
                  onClick={() => handleVoyageFilterSelect(null)}
                  className={`flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left text-xs font-sans transition-colors duration-interaction ease-out-expo ${
                    !focusedVoyageId ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                  }`}
                >
                  <span>{lang === "it" ? "Tutti i viaggi" : "All voyages"}</span>
                  {!focusedVoyageId ? <Check size={12} className="text-accent" /> : null}
                </button>
                {filteredVoyages.map((voyage) => {
                  const isSelected = focusedVoyageId === voyage.id;
                  const isWaterVoyage = voyage.type === "water";
                  const localizedStatus = lang === "it"
                    ? voyage.status === "planned"
                      ? "programmata"
                      : voyage.status === "active"
                        ? "in corso"
                        : "completata"
                    : voyage.status === "planned"
                      ? "planned"
                      : voyage.status === "active"
                        ? "active"
                        : "completed";
                  return (
                    <button
                      key={voyage.id}
                      type="button"
                      onClick={() => handleVoyageFilterSelect(voyage.id)}
                      className={`flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left text-xs font-sans transition-colors duration-interaction ease-out-expo ${
                        isSelected ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                      }`}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`shrink-0 ${getVoyageTypeIconClassName(voyage.type)}`}>
                            {isWaterVoyage ? <Ship size={12} /> : <Mountain size={12} />}
                          </span>
                          <span className="truncate">{getLocalizedVoyageName(voyage, lang)}</span>
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${getVoyageStatusPillClassName(voyage.status)}`}
                        >
                          {localizedStatus}
                        </span>
                      </span>
                      {isSelected ? <Check size={12} className="text-accent shrink-0" /> : null}
                    </button>
                  );
                })}
                {filteredVoyages.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs font-sans text-muted-foreground">
                    {lang === "it" ? "Nessun viaggio in questo filtro" : "No voyages in this filter"}
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
          {stats.activeVoyage && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-accent">
                <Anchor size={10} /> {getLocalizedVoyageName(stats.activeVoyage, lang)}
              </span>
            </>
          )}
        </div>
  );
};

export default JournalMapStatsBar;
