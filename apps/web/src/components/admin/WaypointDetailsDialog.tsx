import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import WaypointEditorPanel, { type WaypointUpdateOptions } from "@/components/admin/WaypointEditorPanel";
import type { VoyageWaypoint, VoyageWaypointMediaItem } from "@/lib/voyage-utils";
import type { Language } from "@/lib/language";

const getErrorMessage = (error: { message?: string | null } | null, fallback: string) =>
  (error?.message && error.message.trim()) || fallback;

const normalizeAdminWaypoint = (row: Record<string, unknown>): VoyageWaypoint => ({
  ...(row as unknown as VoyageWaypoint),
  name: (row.name ?? row.name_it ?? row.name_en ?? "") as string,
  name_it: (row.name_it ?? null) as string | null,
  name_en: (row.name_en ?? null) as string | null,
  waypoint_type: row.waypoint_type === "narrative" ? "narrative" : "technical",
  visibility_mode: row.visibility_mode === "manual" ? "manual" : "auto",
  media: Array.isArray(row.media) ? (row.media as VoyageWaypointMediaItem[]) : [],
});

interface WaypointDetailsDialogProps {
  waypointId: string | null;
  index: number;
  total: number;
  lang: Language;
  voyageType: "water" | "land";
  datesTbd: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const WaypointDetailsDialog = ({
  waypointId,
  index,
  total,
  lang,
  voyageType,
  datesTbd,
  onOpenChange,
  onSaved,
}: WaypointDetailsDialogProps) => {
  const queryClient = useQueryClient();
  const open = Boolean(waypointId);

  const { data: waypoint, isLoading } = useQuery({
    queryKey: ["admin-waypoint-detail", waypointId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .eq("id", waypointId as string)
        .single();
      if (error) throw error;
      return normalizeAdminWaypoint(data as Record<string, unknown>);
    },
  });

  const handleUpdate = useCallback(
    async (changes: Partial<VoyageWaypoint>, options?: WaypointUpdateOptions): Promise<boolean> => {
      if (!waypointId) return false;
      const payload = changes as unknown as TablesUpdate<"voyage_waypoints">;
      const { error } = await supabase.from("voyage_waypoints").update(payload).eq("id", waypointId);
      if (error) {
        toast.error(getErrorMessage(error, "Impossibile aggiornare la tappa"));
        return false;
      }
      if (options?.successMessage) toast.success(options.successMessage);
      await queryClient.invalidateQueries({ queryKey: ["admin-waypoint-detail", waypointId] });
      onSaved?.();
      return true;
    },
    [onSaved, queryClient, waypointId]
  );

  const handleUploadMedia = useCallback(async (files: File[]): Promise<VoyageWaypointMediaItem[]> => {
    if (!waypointId || !files.length) return [];
    const uploaded: VoyageWaypointMediaItem[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `voyage-waypoints/${waypointId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("logbook-media").upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (error) {
        toast.error(getErrorMessage(error, "Impossibile caricare il media"));
        continue;
      }
      const { data } = supabase.storage.from("logbook-media").getPublicUrl(path);
      uploaded.push({
        kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file",
        mime_type: file.type || null,
        name: file.name,
        path,
        url: data.publicUrl,
      });
    }
    return uploaded;
  }, [waypointId]);

  const handleDeleteMedia = useCallback(async (item: VoyageWaypointMediaItem) => {
    if (!item.path) return;
    const { error } = await supabase.storage.from("logbook-media").remove([item.path]);
    if (error) console.error("[WaypointDetailsDialog] delete media failed", error);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dettagli tappa</DialogTitle>
        </DialogHeader>
        {isLoading || !waypoint ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <WaypointEditorPanel
            waypoint={waypoint}
            index={index}
            total={total}
            lang={lang}
            voyageType={voyageType}
            datesTbd={datesTbd}
            arrivalNote={null}
            departureNote={null}
            arrivalPlaceholder=""
            departurePlaceholder=""
            legEstimateLabel={null}
            onUpdate={handleUpdate}
            onDelete={() => toast.message("Per eliminare una tappa usa l'editor rotta del viaggio.")}
            onRelocate={() => toast.message("Per spostare una tappa sulla mappa usa l'editor rotta del viaggio.")}
            onUploadMedia={handleUploadMedia}
            onDeleteMedia={handleDeleteMedia}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default WaypointDetailsDialog;
