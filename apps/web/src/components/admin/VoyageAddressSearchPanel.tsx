import type { Dispatch, SetStateAction } from "react";
import { Loader2, Search } from "lucide-react";
import type { GeocodedPlace } from "@/lib/voyage-utils";

export interface VoyageAddressSearchPanelProps {
  landSearchQuery: string;
  setLandSearchQuery: Dispatch<SetStateAction<string>>;
  landSearchResults: GeocodedPlace[];
  landSearchLoading: boolean;
  onSearch: () => void;
  onFocusResult: (result: GeocodedPlace) => void;
  onAddResult: (result: GeocodedPlace) => void;
}

const VoyageAddressSearchPanel = ({
  landSearchQuery,
  setLandSearchQuery,
  landSearchResults,
  landSearchLoading,
  onSearch,
  onFocusResult,
  onAddResult,
}: VoyageAddressSearchPanelProps) => {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-sans font-medium">Cerca indirizzi e POI</h4>
          <p className="text-xs text-muted-foreground font-sans">
            Cerca un luogo, centrati sulla mappa e aggiungilo direttamente come waypoint.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={landSearchQuery}
          onChange={(event) => setLandSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onSearch();
          }}
          placeholder="Indirizzo, città, POI, stazione..."
          className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onSearch}
          disabled={landSearchLoading}
          className="inline-flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-sans text-muted-foreground hover:text-foreground disabled:opacity-60"
          title="Cerca sulla mappa"
        >
          {landSearchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </div>

      {landSearchResults.length > 0 && (
        <div className="space-y-2 max-h-[220px] overflow-y-auto">
          {landSearchResults.map((result, index) => (
            <div
              key={`${result.lat}-${result.lng}-${index}`}
              className="flex items-start gap-2 rounded-[18px] border border-border/60 bg-background/60 px-3 py-2"
            >
              <button type="button" onClick={() => onFocusResult(result)} className="flex-1 min-w-0 text-left">
                <span className="block text-sm font-sans text-foreground truncate">{result.name.split(",")[0]}</span>
                <span className="block text-[11px] text-muted-foreground font-sans break-words">{result.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onAddResult(result)}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] font-sans text-foreground hover:border-accent hover:text-accent"
              >
                Aggiungi
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default VoyageAddressSearchPanel;
