import type { Dispatch, RefObject, SetStateAction } from "react";
import type maplibregl from "maplibre-gl";
import { MapPin, Navigation, Search as SearchIcon } from "lucide-react";
import { getWaypointOptionLabel, type Voyage, type VoyageWaypoint } from "@/lib/voyage-utils";

export type ArticleAssociationMode = "point" | "segment" | "full";

export interface ArticleGeoAssociationPanelProps {
  locationName: string;
  setLocationName: Dispatch<SetStateAction<string>>;
  latitude: number | null;
  setLatitude: Dispatch<SetStateAction<number | null>>;
  longitude: number | null;
  setLongitude: Dispatch<SetStateAction<number | null>>;
  geoSearchQuery: string;
  setGeoSearchQuery: Dispatch<SetStateAction<string>>;
  geoSearching: boolean;
  handleGeoSearch: () => void;
  /** Contenitore in cui la pagina monta l'istanza MapLibre (effect di bootstrap lato pagina). */
  geoMapRef: RefObject<HTMLDivElement>;
  geoMarkerRef: RefObject<maplibregl.Marker | null>;
  allVoyages: Voyage[];
  selectedVoyageId: string | null;
  setSelectedVoyageId: Dispatch<SetStateAction<string | null>>;
  voyageWaypoints: VoyageWaypoint[];
  associationMode: ArticleAssociationMode;
  setAssociationMode: Dispatch<SetStateAction<ArticleAssociationMode>>;
  handleAssociationModeChange: (nextMode: ArticleAssociationMode) => void;
  voyageSegStart: number | null;
  setVoyageSegStart: Dispatch<SetStateAction<number | null>>;
  voyageSegEnd: number | null;
  setVoyageSegEnd: Dispatch<SetStateAction<number | null>>;
  handleSegmentStartChange: (value: string) => void;
  handleSegmentEndChange: (value: string) => void;
  selectPointWaypoint: (index: number | null) => void;
}

const ArticleGeoAssociationPanel = ({
  locationName,
  setLocationName,
  latitude,
  setLatitude,
  longitude,
  setLongitude,
  geoSearchQuery,
  setGeoSearchQuery,
  geoSearching,
  handleGeoSearch,
  geoMapRef,
  geoMarkerRef,
  allVoyages,
  selectedVoyageId,
  setSelectedVoyageId,
  voyageWaypoints,
  associationMode,
  setAssociationMode,
  handleAssociationModeChange,
  voyageSegStart,
  setVoyageSegStart,
  voyageSegEnd,
  setVoyageSegEnd,
  handleSegmentStartChange,
  handleSegmentEndChange,
  selectPointWaypoint,
}: ArticleGeoAssociationPanelProps) => {
  const voyageWaypointOptions = voyageWaypoints.map((waypoint, index) => ({
  value: String(index),
  label: getWaypointOptionLabel(waypoint, index, voyageWaypoints.length),
  }));
  const segmentEndWaypointOptions =
  voyageSegStart == null
  ? []
  : voyageWaypointOptions.slice(voyageSegStart + 1);
  const selectedPointWaypointLabel =
  associationMode === "point" && voyageSegStart != null
  ? voyageWaypointOptions[voyageSegStart]?.label || null
  : null;
  const selectedSegmentSummary =
  associationMode === "segment" && voyageSegStart != null && voyageSegEnd != null
  ? `${voyageWaypointOptions[voyageSegStart]?.label || `WP ${voyageSegStart + 1}`} → ${voyageWaypointOptions[voyageSegEnd]?.label || `WP ${voyageSegEnd + 1}`}`
  : null;

  return (
      <div>
        <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
          <MapPin size={12} className="inline mr-1" /> Location & Voyage
        </label>

        {/* Geo search */}
        <div className="flex gap-1.5 mb-2">
          <input
            type="text"
            value={geoSearchQuery}
            onChange={(e) => setGeoSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleGeoSearch())}
            placeholder="Search place..."
            className="flex-1 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors"
          />
          <button onClick={handleGeoSearch} disabled={geoSearching} className="border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <SearchIcon size={12} />
          </button>
        </div>

        {/* Mini map */}
        <div ref={geoMapRef} className="w-full aspect-[4/3] border border-border mb-2" />

        {/* Location name */}
        <input
          type="text"
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          placeholder="Location name (e.g. Porto di Bari)"
          className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors mb-2"
        />

        {/* Coordinates display */}
        {latitude && longitude && (
          <p className="text-[10px] font-sans text-muted-foreground mb-2">
            📍 {latitude.toFixed(4)}, {longitude.toFixed(4)}
            <button onClick={() => { setLatitude(null); setLongitude(null); geoMarkerRef.current?.remove(); }} className="ml-2 text-destructive hover:underline">Clear</button>
          </p>
        )}

        {/* Voyage selector */}
        <div className="mt-3">
          <label className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
            <Navigation size={10} className="inline mr-1" /> Voyage
          </label>
          <select
            value={selectedVoyageId || ""}
            onChange={(e) => {
              const nextVoyageId = e.target.value || null;
              setSelectedVoyageId(nextVoyageId);
              setVoyageSegStart(null);
              setVoyageSegEnd(null);
              setAssociationMode(nextVoyageId ? "full" : "point");
            }}
            className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors"
          >
            <option value="">No voyage</option>
            {allVoyages.map((v) => (
              <option key={v.id} value={v.id}>{v.type === "water" ? "🚢" : "🚐"} {v.name}</option>
            ))}
          </select>
        </div>

        {/* Association mode */}
        {selectedVoyageId && (
          <div className="mt-2 space-y-1.5">
            <label className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground block">Association</label>
            <div className="flex gap-1">
              <button
                onClick={() => handleAssociationModeChange("full")}
                className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "full" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                Full voyage
              </button>
              <button
                onClick={() => handleAssociationModeChange("point")}
                className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "point" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                Point
              </button>
              <button
                onClick={() => handleAssociationModeChange("segment")}
                className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "segment" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                Segment
              </button>
            </div>

            {!voyageWaypoints.length ? (
              <p className="text-[10px] text-muted-foreground">
                This voyage has no waypoints yet.
              </p>
            ) : null}

            {associationMode === "full" && voyageWaypoints.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                The full traced voyage is associated with this article.
              </p>
            )}

            {associationMode === "point" && voyageWaypoints.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Click a waypoint on the minimap or choose it below.
                </p>
                <div>
                  <label className="text-[10px] font-sans text-muted-foreground block">Waypoint</label>
                  <select
                    value={voyageSegStart != null ? String(voyageSegStart) : ""}
                    onChange={(e) => selectPointWaypoint(e.target.value ? Number(e.target.value) : null)}
                    className="w-full bg-transparent border border-border px-2 py-1 text-xs font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="">Choose a waypoint</option>
                    {voyageWaypointOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                {selectedPointWaypointLabel && (
                  <p className="text-[10px] text-muted-foreground">
                    Selected: {selectedPointWaypointLabel}
                  </p>
                )}
              </div>
            )}

            {associationMode === "segment" && voyageWaypoints.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Click two waypoints on the minimap or choose them below.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="text-[10px] font-sans text-muted-foreground block">From</label>
                    <select
                      value={voyageSegStart != null ? String(voyageSegStart) : ""}
                      onChange={(e) => handleSegmentStartChange(e.target.value)}
                      className="w-full bg-transparent border border-border px-2 py-1 text-xs font-sans focus:outline-none focus:border-accent"
                    >
                      <option value="">Choose start waypoint</option>
                      {voyageWaypointOptions.map((option) => (
                        <option key={`start-${option.value}`} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-sans text-muted-foreground block">To</label>
                    <select
                      value={voyageSegEnd != null ? String(voyageSegEnd) : ""}
                      onChange={(e) => handleSegmentEndChange(e.target.value)}
                      disabled={voyageSegStart == null || !segmentEndWaypointOptions.length}
                      className="w-full bg-transparent border border-border px-2 py-1 text-xs font-sans focus:outline-none focus:border-accent"
                    >
                      <option value="">
                        {voyageSegStart == null
                          ? "Choose start first"
                          : segmentEndWaypointOptions.length
                            ? "Choose end waypoint"
                            : "No later waypoint available"}
                      </option>
                      {segmentEndWaypointOptions.map((option) => (
                        <option key={`end-${option.value}`} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {selectedSegmentSummary && (
                  <p className="text-[10px] text-muted-foreground">
                    Selected: {selectedSegmentSummary}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
  );
};

export default ArticleGeoAssociationPanel;
