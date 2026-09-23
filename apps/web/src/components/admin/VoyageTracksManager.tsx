import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, FileUp, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import VoyageTrackEditor, { colorForLeg, formatRomeTime, type TrackEditorSavedSegment } from "@/components/admin/VoyageTrackEditor";
import { parseGpx } from "@/lib/voyage-track-gpx";
import { cleanTrack, computeRangeMetrics, detectStops, simplifyRange } from "@/lib/voyage-track-analysis";
import { buildMatchChain, type ChainLegInput, type ChainWaypointInput } from "@/lib/voyage-track-matching";
import {
  PARTIAL_COVERAGE_GAP_NM,
  formatTrackDuration,
  summarizeTrackSegments,
  type TrackSegmentRow,
} from "@/lib/voyage-track-summary";
import { getVoyageMapLineStringCoordinates, type Voyage, type VoyageWaypoint } from "@/lib/voyage-utils";
import type { Json } from "@/integrations/supabase/types";

interface VoyageOption {
  id: string;
  name: string;
  status: string;
  type: "water" | "land";
  start_date: string | null;
  cached_geometry: Voyage["cached_geometry"];
}

interface TrackRow {
  id: string;
  voyage_id: string;
  file_name: string;
  file_sha256: string;
  storage_path: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  point_count: number;
  capabilities: Json;
  stats: Json;
  created_at: string;
}

type LegRow = ChainLegInput & { actual_departure_at: string | null; actual_arrival_at: string | null };

const BUCKET = "voyage-tracks";

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  draft: { label: "Bozza", className: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
  confirmed: { label: "Confermato", className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  archived: { label: "Archiviato", className: "bg-muted text-muted-foreground" },
};

const VoyageTracksManager = () => {
  const [voyages, setVoyages] = useState<VoyageOption[]>([]);
  const [voyageId, setVoyageId] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<(ChainWaypointInput & VoyageWaypoint)[]>([]);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [segments, setSegments] = useState<(TrackSegmentRow & TrackEditorSavedSegment)[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<{ track: TrackRow; fileText: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("voyages")
        .select("id,name,status,type,start_date,cached_geometry")
        .order("start_date", { ascending: false, nullsFirst: false });
      if (error) {
        toast.error(error.message);
        return;
      }
      const list = (data ?? []) as unknown as VoyageOption[];
      setVoyages(list);
      setVoyageId((current) => current ?? list.find((v) => v.status === "active")?.id ?? list[0]?.id ?? null);
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    const [w, l, t, s] = await Promise.all([
      supabase.from("voyage_waypoints").select("*").eq("voyage_id", id).order("sort_order"),
      supabase.from("voyage_bookable_legs").select("id,from_waypoint_id,to_waypoint_id,sort_order,planned_nautical_miles,actual_departure_at,actual_arrival_at").eq("voyage_id", id).order("sort_order"),
      supabase.from("voyage_tracks").select("id,voyage_id,file_name,file_sha256,storage_path,status,started_at,ended_at,point_count,capabilities,stats,created_at").eq("voyage_id", id).order("started_at"),
      supabase.from("voyage_track_segments").select("*").eq("voyage_id", id).order("started_at"),
    ]);
    const firstError = [w, l, t, s].find((r) => r.error)?.error;
    if (firstError) toast.error(firstError.message);
    setWaypoints((w.data ?? []) as unknown as (ChainWaypointInput & VoyageWaypoint)[]);
    setLegs((l.data ?? []) as unknown as LegRow[]);
    setTracks((t.data ?? []) as TrackRow[]);
    setSegments((s.data ?? []) as unknown as (TrackSegmentRow & TrackEditorSavedSegment)[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (voyageId) {
      setOpen(null);
      void load(voyageId);
    }
  }, [voyageId, load]);

  const voyage = voyages.find((v) => v.id === voyageId) ?? null;
  const planned = useMemo(
    () => (voyage && waypoints.length > 1 ? getVoyageMapLineStringCoordinates(voyage as unknown as Voyage, waypoints) : []),
    [voyage, waypoints]
  );
  const chain = useMemo(() => buildMatchChain(waypoints, legs), [waypoints, legs]);
  const trackNames = useMemo(() => Object.fromEntries(tracks.map((t) => [t.id, t.file_name])), [tracks]);
  const confirmedIds = useMemo(() => new Set(tracks.filter((t) => t.status === "confirmed").map((t) => t.id)), [tracks]);
  /** Coverage counts only confirmed tracks: exactly what tickets and the voyage page will show. */
  const coverage = useMemo(() => summarizeTrackSegments(segments.filter((s) => confirmedIds.has(s.track_id))), [segments, confirmedIds]);
  const segmentsForEditor = useMemo(
    () => segments.filter((s) => s.track_id === open?.track.id || confirmedIds.has(s.track_id)),
    [segments, confirmedIds, open]
  );

  const openTrack = async (track: TrackRow) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(track.storage_path);
    if (error || !data) {
      toast.error(error?.message ?? "File originale non trovato");
      return;
    }
    setOpen({ track, fileText: await data.text() });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !voyageId) return;
    setUploading(true);
    let lastCreated: { track: TrackRow; fileText: string } | null = null;
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const sha = await sha256Hex(text);
        const existing = tracks.find((t) => t.file_sha256 === sha);
        if (existing) {
          toast.info(`${file.name}: già caricato, lo apro.`);
          lastCreated = { track: existing, fileText: text };
          continue;
        }
        const parsed = parseGpx(text);
        const clean = cleanTrack(parsed);
        const stops = detectStops(clean.points);
        const whole = computeRangeMetrics(clean.points, stops, 0, clean.points.length - 1);
        const path = `${voyageId}/${sha}.gpx`;
        const upload = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: "application/gpx+xml" });
        if (upload.error) throw upload.error;
        const { data, error } = await supabase
          .from("voyage_tracks")
          .insert({
            voyage_id: voyageId,
            storage_path: path,
            file_name: file.name,
            file_sha256: sha,
            file_size_bytes: file.size,
            source_creator: parsed.creator,
            source_name: parsed.name,
            started_at: whole.startAt !== null ? new Date(whole.startAt).toISOString() : null,
            ended_at: whole.endAt !== null ? new Date(whole.endAt).toISOString() : null,
            point_count: clean.points.length,
            capabilities: {
              ...parsed.fields,
              timezone: parsed.timezone,
              source: parsed.source,
              speedSource: clean.speedSource,
              speedUnit: clean.recordedSpeedUnit,
            } as unknown as Json,
            quality: clean.quality as unknown as Json,
            stats: {
              distanceNm: Number(whole.distanceNm.toFixed(2)),
              movingSec: whole.movingSec,
              elapsedSec: whole.elapsedSec,
              maxSogKn: whole.maxSogKn,
              stops: stops.length,
            } as unknown as Json,
            geometry: simplifyRange(clean.points, stops, 0, clean.points.length - 1, 400) as unknown as Json,
          })
          .select("id,voyage_id,file_name,file_sha256,storage_path,status,started_at,ended_at,point_count,capabilities,stats,created_at")
          .single();
        if (error) throw error;
        lastCreated = { track: data as TrackRow, fileText: text };
        toast.success(`${file.name}: ${clean.points.length.toLocaleString("it-IT")} punti, ${whole.distanceNm.toFixed(1)} mn.`);
      } catch (error) {
        console.error("[VoyageTracksManager] import failed", error);
        toast.error(`${file.name}: ${error instanceof Error ? error.message : "import non riuscito"}`);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    await load(voyageId);
    if (lastCreated) setOpen(lastCreated);
  };

  const setStatus = async (track: TrackRow, status: "archived" | "draft") => {
    const { error } = await supabase.from("voyage_tracks").update({ status, confirmed_at: null }).eq("id", track.id);
    if (error) toast.error(error.message);
    if (voyageId) await load(voyageId);
  };

  const deleteTrack = async (track: TrackRow) => {
    const { error } = await supabase.from("voyage_tracks").delete().eq("id", track.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.storage.from(BUCKET).remove([track.storage_path]);
    toast.success("Tracciato eliminato.");
    if (open?.track.id === track.id) setOpen(null);
    if (voyageId) await load(voyageId);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[28px] p-5 md:p-6 flex flex-wrap items-end gap-4">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-xs text-muted-foreground">
          Viaggio
          <select
            value={voyageId ?? ""}
            onChange={(e) => setVoyageId(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {voyages.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.start_date ? `· ${v.start_date}` : ""} {v.status === "active" ? "· in corso" : ""}
              </option>
            ))}
          </select>
        </label>
        <input ref={inputRef} type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
        <Button onClick={() => inputRef.current?.click()} disabled={!voyageId || uploading} className="gap-2">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Carica GPX
        </Button>
      </section>

      {open && voyageId ? (
        <VoyageTrackEditor
          key={open.track.id}
          track={open.track}
          fileText={open.fileText}
          waypoints={waypoints}
          legs={legs}
          planned={planned}
          savedSegments={segmentsForEditor}
          trackNames={trackNames}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void load(voyageId);
          }}
        />
      ) : (
        <>
          <section className="glass-panel rounded-[28px] p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="editorial-heading text-2xl">Tracciati caricati</h2>
              {loading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
            </div>
            {tracks.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">
                Nessun tracciato per questo viaggio. Carica uno o più GPX: il sistema propone da solo quali tratte coprono, tu confermi o correggi.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {tracks.map((track) => {
                const stats = (track.stats ?? {}) as { distanceNm?: number; movingSec?: number; stops?: number };
                const trackSegments = segments.filter((s) => s.track_id === track.id);
                const status = STATUS_LABEL[track.status] ?? STATUS_LABEL.draft;
                return (
                  <article key={track.id} className="glass-panel-soft rounded-[22px] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{track.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRomeTime(track.started_at ? Date.parse(track.started_at) : null)} → {formatRomeTime(track.ended_at ? Date.parse(track.ended_at) : null)}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {track.point_count.toLocaleString("it-IT")} punti · {stats.distanceNm?.toFixed(1) ?? "—"} mn · {formatTrackDuration(stats.movingSec ?? null, "it")} in movimento ·{" "}
                      {stats.stops ?? 0} soste
                    </p>
                    {trackSegments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {trackSegments.map((s) => {
                          const legIndex = chain.legs.findIndex((l) => (s.leg_id ? l.legId === s.leg_id : l.fromWaypointId === s.from_waypoint_id && l.toWaypointId === s.to_waypoint_id));
                          return (
                            <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-[11px]">
                              <span className="h-2 w-2 rounded-full" style={{ background: colorForLeg(legIndex >= 0 ? legIndex : null) }} />
                              {legIndex >= 0 ? chain.legs[legIndex].label : "Non assegnato"}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => void openTrack(track)}>
                        <Pencil size={14} /> {track.status === "confirmed" ? "Rivedi" : "Riconcilia"}
                      </Button>
                      {track.status === "archived" ? (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => void setStatus(track, "draft")}>
                          <RotateCcw size={14} /> Ripristina
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => void setStatus(track, "archived")}>
                          <Archive size={14} /> Archivia
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="gap-1 text-red-600" onClick={() => setPendingDelete(track)}>
                        <Trash2 size={14} /> Elimina
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {chain.legs.length > 0 && (
            <section className="glass-panel rounded-[28px] p-5 md:p-6 space-y-4">
              <div>
                <h2 className="editorial-heading text-2xl">Copertura per tratta</h2>
                <p className="text-sm text-muted-foreground">Solo tracciati confermati: è quello che vedono biglietti e pagina viaggio.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Tratta</th>
                      <th className="py-2 pr-3">Previste</th>
                      <th className="py-2 pr-3">Registrate</th>
                      <th className="py-2 pr-3">In movimento</th>
                      <th className="py-2 pr-3">Media / max</th>
                      <th className="py-2">Copertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.legs.map((leg, i) => {
                      const summary = coverage.get(leg.legId ?? `${leg.fromWaypointId}>${leg.toWaypointId}`);
                      return (
                        <tr key={`${leg.fromWaypointId}-${leg.toWaypointId}`} className="border-t border-border/60">
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForLeg(i) }} />
                              {leg.label}
                            </span>
                          </td>
                          <td className="py-2 pr-3">{leg.plannedNm ? `${leg.plannedNm.toFixed(1)} mn` : "—"}</td>
                          <td className="py-2 pr-3">{summary ? `${summary.recordedNm.toFixed(1)} mn` : "—"}</td>
                          <td className="py-2 pr-3">{summary ? formatTrackDuration(summary.movingSec, "it") : "—"}</td>
                          <td className="py-2 pr-3">
                            {summary?.avgSogKn ? `${summary.avgSogKn.toFixed(1)} / ${summary.maxSogKn?.toFixed(1) ?? "—"} kn` : "—"}
                          </td>
                          <td className="py-2">
                            {!summary ? (
                              <span className="text-muted-foreground">nessun tracciato</span>
                            ) : summary.coverage === "full" ? (
                              <span className="text-emerald-700 dark:text-emerald-300">completa{summary.segmentCount > 1 ? ` (${summary.segmentCount} parti)` : ""}</span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300">
                                parziale (mancano {((summary.startGapNm > PARTIAL_COVERAGE_GAP_NM ? summary.startGapNm : 0) + (summary.endGapNm > PARTIAL_COVERAGE_GAP_NM ? summary.endGapNm : 0)).toFixed(1)} mn agli estremi)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => !next && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il tracciato?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.file_name}: file originale e segmenti riconciliati vengono cancellati. Biglietti e pagina viaggio smettono di usarlo.
              Se vuoi solo toglierlo dal pubblico, usa «Archivia».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) void deleteTrack(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VoyageTracksManager;
