import type { Dispatch, SetStateAction } from "react";
import { GripVertical, Eye, EyeOff, Trash2, Edit, ChevronUp, ChevronDown, LocateFixed } from "lucide-react";
import {
  buildWaypointDefaultName,
  formatWaypointCoordinateLabel,
  getLocalizedWaypointName,
  getWaypointEffectiveType,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import type { Language } from "@/lib/language";

export interface WaypointListPanelProps {
  selectedWaypoints: VoyageWaypoint[];
  lang: Language;
  eventLabels: Record<string, string | null>;
  draggedWaypointId: string | null;
  setDraggedWaypointId: Dispatch<SetStateAction<string | null>>;
  dragOverWaypointId: string | null;
  setDragOverWaypointId: Dispatch<SetStateAction<string | null>>;
  editingWaypointNameId: string | null;
  editingWaypointNameValue: string;
  setEditingWaypointNameValue: Dispatch<SetStateAction<string>>;
  savingWaypointNameId: string | null;
  onReorder: (voyageId: string, fromIndex: number, toIndex: number) => void;
  onToggleVisibility: (waypoint: VoyageWaypoint, index: number, total: number) => void;
  onBeginNameEdit: (waypoint: VoyageWaypoint, index: number) => void;
  onCancelNameEdit: () => void;
  onSubmitNameEdit: (waypoint: VoyageWaypoint, index: number) => void;
  onOpenPopup: (waypointId: string) => void;
  onDelete: (voyageId: string, waypointId: string) => void;
  onMove: (waypoint: VoyageWaypoint, direction: "up" | "down") => void;
  onFocusOnMap: (waypointId: string) => void;
  maxHeightClass: string;
}

const WaypointListPanel = ({
  selectedWaypoints,
  lang,
  eventLabels,
  draggedWaypointId,
  setDraggedWaypointId,
  dragOverWaypointId,
  setDragOverWaypointId,
  editingWaypointNameId,
  editingWaypointNameValue,
  setEditingWaypointNameValue,
  savingWaypointNameId,
  onReorder,
  onToggleVisibility,
  onBeginNameEdit,
  onCancelNameEdit,
  onSubmitNameEdit,
  onOpenPopup,
  onDelete,
  onMove,
  onFocusOnMap,
  maxHeightClass,
}: WaypointListPanelProps) => {
  return (
    <>
      <div className={`space-y-0 overflow-y-auto ${maxHeightClass}`}>
        {selectedWaypoints.map((waypoint, index) => {
          const effectiveType = getWaypointEffectiveType(waypoint, index, selectedWaypoints.length);
          const displayName = getLocalizedWaypointName(waypoint, lang, index);
          const visibilityLabel = waypoint.visibility_mode === "manual"
            ? effectiveType === "narrative"
              ? "Manual narrative waypoint"
              : "Manual technical waypoint"
            : effectiveType === "narrative"
              ? "Auto public end waypoint"
              : "Auto technical waypoint";
          const eventLabel = eventLabels[waypoint.id] ?? null;

          return (
            <div
              key={waypoint.id}
              onDragOver={(event) => {
                if (!draggedWaypointId || draggedWaypointId === waypoint.id) return;
                event.preventDefault();
                if (dragOverWaypointId !== waypoint.id) {
                  setDragOverWaypointId(waypoint.id);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedWaypointId || draggedWaypointId === waypoint.id) return;
                const fromIndex = selectedWaypoints.findIndex((item) => item.id === draggedWaypointId);
                const toIndex = selectedWaypoints.findIndex((item) => item.id === waypoint.id);
                setDraggedWaypointId(null);
                setDragOverWaypointId(null);
                onReorder(waypoint.voyage_id, fromIndex, toIndex);
              }}
              onDragLeave={(event) => {
                if (!(event.currentTarget as HTMLDivElement).contains(event.relatedTarget as Node | null)) {
                  setDragOverWaypointId((current) => (current === waypoint.id ? null : current));
                }
              }}
              className={`flex items-center gap-2 py-2 px-2 border-b border-border/50 group text-xs transition-colors ${
                dragOverWaypointId === waypoint.id ? "bg-accent/10" : ""
              } ${draggedWaypointId === waypoint.id ? "opacity-50" : ""}`}
            >
              <button
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", waypoint.id);
                  setDraggedWaypointId(waypoint.id);
                  setDragOverWaypointId(waypoint.id);
                }}
                onDragEnd={() => {
                  setDraggedWaypointId(null);
                  setDragOverWaypointId(null);
                }}
                className="p-0.5 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
                title="Drag to reorder waypoint"
              >
                <GripVertical size={12} />
              </button>
              <span className="text-muted-foreground/40 w-5 shrink-0 font-sans">
                {String(index + 1).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => onToggleVisibility(waypoint, index, selectedWaypoints.length)}
                className="p-0.5 text-muted-foreground hover:text-foreground"
                title={`${visibilityLabel}. Click to toggle quickly.`}
              >
                {effectiveType === "technical" ? (
                  <EyeOff size={10} className="text-muted-foreground shrink-0" />
                ) : (
                  <Eye size={10} className="text-accent shrink-0" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                {editingWaypointNameId === waypoint.id ? (
                  <input
                    type="text"
                    value={editingWaypointNameValue}
                    onChange={(event) => setEditingWaypointNameValue(event.target.value)}
                    onBlur={() => onSubmitNameEdit(waypoint, index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onSubmitNameEdit(waypoint, index);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelNameEdit();
                      }
                    }}
                    autoFocus
                    disabled={savingWaypointNameId === waypoint.id}
                    className="block w-full border border-border bg-background px-2 py-1 font-sans text-xs text-foreground outline-none focus:border-foreground"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => onBeginNameEdit(waypoint, index)}
                    className="font-sans truncate block w-full text-left hover:text-foreground transition-colors"
                    title="Double click to rename"
                  >
                    {displayName || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenPopup(waypoint.id)}
                  className="text-[10px] text-muted-foreground font-sans text-left hover:text-foreground transition-colors"
                >
                  {formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}
                  {eventLabel ? ` · ${eventLabel}` : ""}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onDelete(waypoint.voyage_id, waypoint.id)}
                className="p-1 text-muted-foreground hover:text-destructive"
                title="Delete waypoint"
              >
                <Trash2 size={12} />
              </button>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => onOpenPopup(waypoint.id)}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title="Edit waypoint"
                >
                  <Edit size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(waypoint, "up")}
                  disabled={index === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(waypoint, "down")}
                  disabled={index === selectedWaypoints.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onFocusOnMap(waypoint.id);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title="Center waypoint on map"
                >
                  <LocateFixed size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedWaypoints.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-6">
          The next click on the map will create the first waypoint.
        </p>
      )}
    </>
  );
};

export default WaypointListPanel;
