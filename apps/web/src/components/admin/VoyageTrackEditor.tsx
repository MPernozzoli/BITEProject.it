import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Merge, RotateCcw, Scissors, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import VoyageTrackMap, { type TrackMapPin, type TrackMapSegment } from "@/components/admin/VoyageTrackMap";
import {
  computeRangeMetrics,
  detectStops,
  cleanTrack,
  nearestPointIndex,
  simplifyRange,
  type RangeMetrics,
} from "@/lib/voyage-track-analysis";
import { parseGpx, type ParsedGpx } from "@/lib/voyage-track-gpx";
import {
  buildMatchChain,
  labelStop,
  matchTrackToChain,
  segmentEndGaps,
  type ChainLegInput,
  type ChainWaypointInput,
} from "@/lib/voyage-track-matching";
import {
  addSegment,
  assignLeg,
  buildSegmentRows,
  duplicateLegIndices,
  mergeWithNext,
  removeSegment,
  segmentsFromProposal,
  segmentsFromSaved,
  setSegmentBounds,
  splitSegment,
  uncoveredRanges,
  type EditorSegment,
} from "@/lib/voyage-track-editor";
import { formatTrackDuration, geometryRuns } from "@/lib/voyage-track-summary";
import { colorForLeg, formatRomeTime } from "@/lib/voyage-track-format";

const nm = (value: number | null | undefined, digits = 1) => (value == null ? "—" : `${value.toFixed(digits)} mn`);
const kn = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(1)} kn`);

const hoursDiffLabel = (actualMs: number | null, programmedMs: number | null) => {
  if (actualMs === null || programmedMs === null) return null;
  const minutes = Math.round((actualMs - programmedMs) / 60_000);
  if (Math.abs(minutes) < 10) return "allineato alla programmazione";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${formatTrackDuration(Math.abs(minutes) * 60, "it")} rispetto all'orario registrato`;
};

const CONFIDENCE_LABEL: Record<EditorSegment["confidence"], { label: string; className: string }> = {
  high: { label: "Automatico · sicuro", className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  medium: { label: "Automatico · da verificare", className: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
  low: { label: "Automatico · incerto", className: "bg-red-500/12 text-red-700 dark:text-red-300" },
  manual: { label: "Manuale", className: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
};

export interface TrackEditorTrackRow {
  id: string;
  voyage_id: string;
  file_name: string;
  status: string;
}

export interface TrackEditorSavedSegment {
  track_id: string;
  leg_id: string | null;
  from_waypoint_id: string | null;
  to_waypoint_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  start_point_index: number | null;
  end_point_index: number | null;
  match_confidence: string;
}

interface VoyageTrackEditorProps {
  track: TrackEditorTrackRow;
  fileText: string;
  waypoints: ChainWaypointInput[];
  legs: (ChainLegInput & { actual_departure_at?: string | null })[];
  planned: [number, number][];
  /** Every saved segment of the voyage: this track's (to restore) and the others' (to warn about overlaps). */
  savedSegments: TrackEditorSavedSegment[];
  trackNames: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}

const SegmentBoundsSlider = ({
  value,
  max,
  onCommit,
}: {
  value: [number, number];
  max: number;
  onCommit: (value: [number, number]) => void;
}) => {
  const [draft, setDraft] = useState<[number, number]>(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Slider
      min={0}
      max={max}
      step={1}
      minStepsBetweenThumbs={1}
      value={draft}
      onValueChange={(next) => setDraft([next[0], next[1]])}
      onValueCommit={(next) => onCommit([next[0], next[1]])}
      className="py-2"
    />
  );
};

const VoyageTrackEditor = ({ track, fileText, waypoints, legs, planned, savedSegments, trackNames, onClose, onSaved }: VoyageTrackEditorProps) => {
  const analysis = useMemo(() => {
    let parsed: ParsedGpx;
    try {
      parsed = parseGpx(fileText);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "GPX non leggibile" } as const;
    }
    const clean = cleanTrack(parsed);
    const stops = detectStops(clean.points);
    const chain = buildMatchChain(waypoints, legs);
    return { parsed, clean, stops, chain } as const;
  }, [fileText, waypoints, legs]);

  const ownSaved = useMemo(() => savedSegments.filter((s) => s.track_id === track.id), [savedSegments, track.id]);

  const proposal = useCallback(() => {
    if ("error" in analysis) return [];
    return segmentsFromProposal(matchTrackToChain(analysis.clean.points, analysis.stops, analysis.chain).segments);
  }, [analysis]);

  const [segments, setSegments] = useState<EditorSegment[]>(() => {
    if ("error" in analysis) return [];
    return ownSaved.length ? segmentsFromSaved(ownSaved, analysis.clean, analysis.chain) : proposal();
  });
  const [selectedUid, setSelectedUid] = useState<string | null>(segments[0]?.uid ?? null);
  const [cutMode, setCutMode] = useState(false);
  const [saving, setSaving] = useState<"draft" | "confirmed" | null>(null);

  const pointCount = "error" in analysis ? 0 : analysis.clean.points.length;

  const metricsByUid = useMemo(() => {
    const map = new Map<string, RangeMetrics>();
    if ("error" in analysis) return map;
    for (const s of segments) map.set(s.uid, computeRangeMetrics(analysis.clean.points, analysis.stops, s.startIdx, s.endIdx));
    return map;
  }, [analysis, segments]);

  const mapSegments: TrackMapSegment[] = useMemo(() => {
    if ("error" in analysis) return [];
    return segments.map((s) => ({
      uid: s.uid,
      color: colorForLeg(s.legIndex),
      runs: geometryRuns([simplifyRange(analysis.clean.points, analysis.stops, s.startIdx, s.endIdx, 900)]),
    }));
  }, [analysis, segments]);

  const uncovered = useMemo(() => uncoveredRanges(segments, pointCount), [segments, pointCount]);
  const uncoveredRuns = useMemo(() => {
    if ("error" in analysis) return [];
    return uncovered.flatMap((range) => geometryRuns([simplifyRange(analysis.clean.points, analysis.stops, range.startIdx, range.endIdx, 300)]));
  }, [analysis, uncovered]);

  const pins: TrackMapPin[] = useMemo(() => {
    if ("error" in analysis) return [];
    const boundaryIds = new Set(analysis.chain.boundaries.flatMap((b) => b.positions.map((p) => p.waypointId)));
    return [
      ...analysis.chain.landmarks.map((l) => ({ id: l.waypointId, name: l.name, lat: l.lat, lng: l.lng, kind: boundaryIds.has(l.waypointId) ? ("boundary" as const) : ("landmark" as const) })),
      ...analysis.stops.map((s, i) => ({
        id: `stop-${i}`,
        name: `Sosta ${formatTrackDuration(s.durationSec, "it")} · ${formatRomeTime(s.startAt)}`,
        lat: s.lat,
        lng: s.lng,
        kind: "stop" as const,
      })),
    ];
  }, [analysis]);

  const selected = segments.find((s) => s.uid === selectedUid) ?? null;
  const handles = useMemo(() => {
    if (!selected || "error" in analysis) return null;
    const a = analysis.clean.points[selected.startIdx];
    const b = analysis.clean.points[selected.endIdx];
    return { start: [a.lng, a.lat] as [number, number], end: [b.lng, b.lat] as [number, number] };
  }, [selected, analysis]);

  const duplicates = useMemo(() => duplicateLegIndices(segments), [segments]);

  /** Legs already covered by *other* confirmed tracks of the voyage. */
  const coveredElsewhere = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of savedSegments) {
      if (s.track_id === track.id) continue;
      const key = s.leg_id ?? `${s.from_waypoint_id}>${s.to_waypoint_id}`;
      map.set(key, [...(map.get(key) ?? []), trackNames[s.track_id] ?? "altro tracciato"]);
    }
    return map;
  }, [savedSegments, track.id, trackNames]);

  const handleMapClick = (lat: number, lng: number) => {
    if (!selected || "error" in analysis) return;
    const idx = nearestPointIndex(analysis.clean.points, { lat, lng }, selected.startIdx + 1, selected.endIdx - 1);
    if (idx > selected.startIdx && idx < selected.endIdx) {
      setSegments((current) => splitSegment(current, selected.uid, idx, analysis.chain.legs.length));
      setCutMode(false);
    }
  };

  const handleDrag = (which: "start" | "end", lat: number, lng: number) => {
    if (!selected || "error" in analysis) return;
    const sorted = [...segments].sort((a, b) => a.startIdx - b.startIdx);
    const i = sorted.findIndex((s) => s.uid === selected.uid);
    const lower = i > 0 ? sorted[i - 1].endIdx : 0;
    const upper = i < sorted.length - 1 ? sorted[i + 1].startIdx : pointCount - 1;
    const idx =
      which === "start"
        ? nearestPointIndex(analysis.clean.points, { lat, lng }, lower, selected.endIdx - 1)
        : nearestPointIndex(analysis.clean.points, { lat, lng }, selected.startIdx + 1, upper);
    setSegments((current) =>
      setSegmentBounds(current, selected.uid, which === "start" ? idx : selected.startIdx, which === "end" ? idx : selected.endIdx, pointCount)
    );
  };

  const save = async (status: "draft" | "confirmed") => {
    if ("error" in analysis) return;
    setSaving(status);
    try {
      const rows = buildSegmentRows({
        track: analysis.clean,
        stops: analysis.stops,
        chain: analysis.chain,
        segments,
        trackId: track.id,
        voyageId: track.voyage_id,
      });
      // Insert the new cut before removing the old one: a failed insert must not leave the track empty.
      const { data: inserted, error: insertError } = await supabase.from("voyage_track_segments").insert(rows).select("id");
      if (insertError) throw insertError;
      const keep = (inserted ?? []).map((r) => r.id);
      let del = supabase.from("voyage_track_segments").delete().eq("track_id", track.id);
      if (keep.length) del = del.not("id", "in", `(${keep.join(",")})`);
      const { error: deleteError } = await del;
      if (deleteError) throw deleteError;
      const { error: updateError } = await supabase
        .from("voyage_tracks")
        .update({ status, confirmed_at: status === "confirmed" ? new Date().toISOString() : null })
        .eq("id", track.id);
      if (updateError) throw updateError;
      toast.success(status === "confirmed" ? "Tracciato confermato: ora alimenta biglietti e pagina viaggio." : "Bozza salvata.");
      onSaved();
    } catch (error) {
      console.error("[VoyageTrackEditor] save failed", error);
      toast.error(error instanceof Error ? error.message : "Salvataggio non riuscito");
    } finally {
      setSaving(null);
    }
  };

  if ("error" in analysis) {
    return (
      <div className="glass-panel rounded-[28px] p-6">
        <p className="text-sm text-red-600">Impossibile leggere il file: {analysis.error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>
          Chiudi
        </Button>
      </div>
    );
  }

  const { parsed, clean, stops, chain } = analysis;
  const t0 = clean.points[0]?.t ?? null;
  const t1 = clean.points[clean.points.length - 1]?.t ?? null;
  const span = t0 !== null && t1 !== null && t1 > t0 ? t1 - t0 : null;
  /** Timeline position: by time when the file has it, by point index otherwise. */
  const position = (idx: number) => {
    const t = clean.points[idx]?.t;
    if (span && t0 !== null && t != null) return ((t - t0) / span) * 100;
    return (idx / Math.max(1, pointCount - 1)) * 100;
  };
  const sortedSegments = [...segments].sort((a, b) => a.startIdx - b.startIdx);

  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-[28px] p-5 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-1">Riconciliazione tracciato</p>
            <h2 className="editorial-heading text-2xl">{track.file_name}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {parsed.creator ? `${parsed.creator} · ` : ""}
              {clean.points.length.toLocaleString("it-IT")} punti · {formatRomeTime(t0)} → {formatRomeTime(t1)} (ora italiana)
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1">
            <X size={14} /> Chiudi
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {[
            ["Orari", parsed.fields.time],
            [
              clean.speedSource === "recorded" ? `Velocità registrata (${clean.recordedSpeedUnit})` : clean.speedSource === "derived" ? "Velocità calcolata da posizione/tempo" : "Nessuna velocità",
              clean.speedSource !== "none",
            ],
            ["Rotta (COG)", parsed.fields.course],
            ["Quota", parsed.fields.elevation],
            ["Qualità fix (HDOP/sat)", parsed.fields.hdop || parsed.fields.sat],
          ].map(([label, on]) => (
            <span key={String(label)} className={`glass-chip px-3 py-1 ${on ? "text-foreground" : "text-muted-foreground/60 line-through"}`}>
              {label}
            </span>
          ))}
          {parsed.fields.extras.map((key) => (
            <span key={key} className="glass-chip px-3 py-1 text-foreground">
              Extra: {key}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Scartati: {clean.quality.droppedSpikes} salti GPS, {clean.quality.droppedDuplicates} duplicati</span>
          <span>
            Interruzioni di registrazione: {clean.quality.breaks}
            {clean.quality.breakSeconds ? ` (${formatTrackDuration(clean.quality.breakSeconds, "it")})` : ""}
          </span>
          <span>Soste rilevate: {stops.length}</span>
        </div>

        {parsed.timezone === "assumed-utc" && (
          <p className="flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle size={14} /> Gli orari del file non dichiarano il fuso: sono stati letti come UTC (standard GPX). Se gli orari
            sembrano sfalsati di 1–2 ore, il plotter li ha scritti in ora locale.
          </p>
        )}
        {!parsed.fields.time && (
          <p className="flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle size={14} /> Il file non ha orari: si possono ricavare solo percorso e miglia, non tempi, soste o velocità.
          </p>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="glass-panel rounded-[28px] overflow-hidden">
          <div className="h-[420px] md:h-[560px]">
            <VoyageTrackMap
              planned={planned}
              segments={mapSegments}
              uncovered={uncoveredRuns}
              pins={pins}
              selectedUid={selectedUid}
              handles={handles}
              cutMode={cutMode}
              onSelect={setSelectedUid}
              onMapClick={handleMapClick}
              onHandleDrag={handleDrag}
              fitKey={track.id}
            />
          </div>
          <div className="px-5 py-4 space-y-2">
            <div className="relative h-7 rounded-full bg-muted/60 overflow-hidden" aria-label="Timeline del tracciato">
              {stops.map((s, i) => (
                <div
                  key={`stop-${i}`}
                  className="absolute inset-y-0 bg-foreground/15"
                  style={{ left: `${position(s.startIdx)}%`, width: `${Math.max(0.3, position(s.endIdx) - position(s.startIdx))}%` }}
                  title={`Sosta ${formatTrackDuration(s.durationSec, "it")}`}
                />
              ))}
              {sortedSegments.map((s) => (
                <button
                  type="button"
                  key={s.uid}
                  onClick={() => setSelectedUid(s.uid)}
                  className={`absolute top-1 bottom-1 rounded-full transition-opacity ${s.uid === selectedUid ? "opacity-100 ring-2 ring-foreground/60" : "opacity-75 hover:opacity-100"}`}
                  style={{ left: `${position(s.startIdx)}%`, width: `${Math.max(0.5, position(s.endIdx) - position(s.startIdx))}%`, background: colorForLeg(s.legIndex) }}
                  title={s.legIndex !== null ? chain.legs[s.legIndex].label : "Non assegnato"}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Linea tratteggiata: rotta pianificata · colori: tratte · grigio: parti non assegnate · quadratini scuri: soste rilevate. Trascina
              i cerchi verde/rosso per spostare inizio e fine del segmento selezionato.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                const next = proposal();
                setSegments(next);
                setSelectedUid(next[0]?.uid ?? null);
              }}
            >
              <RotateCcw size={14} /> Rifai proposta automatica
            </Button>
          </div>

          {sortedSegments.length === 0 && (
            <p className="glass-panel-soft rounded-[22px] p-4 text-sm text-muted-foreground">
              Nessun segmento: aggiungine uno dalle parti non assegnate qui sotto.
            </p>
          )}

          {sortedSegments.map((segment, order) => {
            const metrics = metricsByUid.get(segment.uid);
            const leg = segment.legIndex !== null ? chain.legs[segment.legIndex] : null;
            const legInput = leg?.legId ? legs.find((l) => l.id === leg.legId) : null;
            const gaps = segmentEndGaps(clean.points, chain, segment);
            const fromB = leg ? chain.boundaries[leg.fromBoundary] : null;
            const toB = leg ? chain.boundaries[leg.fromBoundary + 1] : null;
            const depDiff = hoursDiffLabel(metrics?.startAt ?? null, fromB?.departureHint ?? null);
            const arrDiff = hoursDiffLabel(metrics?.endAt ?? null, toB?.arrivalHint ?? null);
            const elsewhere = leg ? coveredElsewhere.get(leg.legId ?? `${leg.fromWaypointId}>${leg.toWaypointId}`) : undefined;
            const isSelected = segment.uid === selectedUid;
            const confidence = CONFIDENCE_LABEL[segment.confidence];
            return (
              <article
                key={segment.uid}
                onClick={() => setSelectedUid(segment.uid)}
                className={`glass-panel-soft rounded-[22px] p-4 space-y-3 cursor-pointer border transition-colors ${isSelected ? "border-foreground/30" : "border-transparent"}`}
              >
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: colorForLeg(segment.legIndex) }} />
                  <select
                    value={segment.legIndex ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSegments((current) => assignLeg(current, segment.uid, e.target.value === "" ? null : Number(e.target.value)))}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">— Non assegnato —</option>
                    {chain.legs.map((l, i) => {
                      const input = l.legId ? legs.find((x) => x.id === l.legId) : null;
                      return (
                        <option key={`${l.fromWaypointId}-${l.toWaypointId}`} value={i}>
                          {i + 1}. {l.label}
                          {input && !input.actual_departure_at ? " (non ancora partita)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${confidence.className}`}>{confidence.label}</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  #{order + 1} · {formatRomeTime(metrics?.startAt)} → {formatRomeTime(metrics?.endAt)} · {formatTrackDuration(metrics?.elapsedSec, "it")}
                </p>

                {isSelected && (
                  <SegmentBoundsSlider
                    value={[segment.startIdx, segment.endIdx]}
                    max={pointCount - 1}
                    onCommit={([a, b]) => setSegments((current) => setSegmentBounds(current, segment.uid, a, b, pointCount))}
                  />
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Miglia registrate</dt>
                    <dd className="font-medium">
                      {nm(metrics?.distanceNm)}
                      {leg?.plannedNm ? <span className="text-muted-foreground font-normal"> / {nm(leg.plannedNm)} prev.</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">In movimento</dt>
                    <dd className="font-medium">{formatTrackDuration(metrics?.movingSec, "it")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Media / max</dt>
                    <dd className="font-medium">
                      {kn(metrics?.avgSogKn)} / {kn(metrics?.maxSogKn)}
                    </dd>
                  </div>
                  {leg && (
                    <div>
                      <dt className="text-muted-foreground">Inizio dalla tappa</dt>
                      <dd className={`font-medium ${(gaps.startGapNm ?? 0) > 1.5 ? "text-amber-700 dark:text-amber-300" : ""}`}>{nm(gaps.startGapNm)}</dd>
                    </div>
                  )}
                  {leg && (
                    <div>
                      <dt className="text-muted-foreground">Fine dalla tappa</dt>
                      <dd className={`font-medium ${(gaps.endGapNm ?? 0) > 1.5 ? "text-amber-700 dark:text-amber-300" : ""}`}>{nm(gaps.endGapNm)}</dd>
                    </div>
                  )}
                  {metrics?.bridgedNm ? (
                    <div>
                      <dt className="text-muted-foreground">Colmati su interruzioni</dt>
                      <dd className="font-medium">{nm(metrics.bridgedNm)}</dd>
                    </div>
                  ) : null}
                  {Object.entries(metrics?.extras ?? {}).map(([key, stat]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="font-medium">
                        {stat.min.toFixed(1)} – {stat.max.toFixed(1)} (media {stat.avg.toFixed(1)})
                      </dd>
                    </div>
                  ))}
                </dl>

                {metrics && metrics.stops.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {metrics.stops.map((stop, i) => {
                      const landmark = labelStop(stop, chain);
                      return (
                        <li key={i} className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-[2px] bg-foreground/60" />
                          {landmark ? landmark.name : <span className="text-amber-700 dark:text-amber-300">Sosta non prevista</span>} ·{" "}
                          {formatTrackDuration(stop.durationSec, "it")} dal {formatRomeTime(stop.startAt)}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {(depDiff || arrDiff) && (
                  <p className="text-xs text-muted-foreground">
                    {depDiff && <>Partenza: {depDiff}. </>}
                    {arrDiff && <>Arrivo: {arrDiff}.</>} Il tracciato non modifica la programmazione.
                  </p>
                )}
                {segment.legIndex !== null && duplicates.has(segment.legIndex) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Questa tratta compare in più segmenti di questo file: verranno sommati.</p>
                )}
                {elsewhere && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Tratta già coperta anche da: {[...new Set(elsewhere)].join(", ")}. I segmenti si sommano: controlla che non si sovrappongano.
                  </p>
                )}
                {legInput && !legInput.actual_departure_at && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">La programmazione non registra ancora la partenza di questa tratta.</p>
                )}

                {isSelected && (
                  <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant={cutMode ? "default" : "outline"} className="gap-1" onClick={() => setCutMode((v) => !v)}>
                      <Scissors size={14} /> {cutMode ? "Clicca sulla traccia per tagliare…" : "Dividi"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={order === sortedSegments.length - 1}
                      onClick={() => setSegments((current) => mergeWithNext(current, segment.uid))}
                    >
                      <Merge size={14} /> Unisci al successivo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-red-600"
                      onClick={() => {
                        setSegments((current) => removeSegment(current, segment.uid));
                        setSelectedUid(null);
                      }}
                    >
                      <Trash2 size={14} /> Escludi
                    </Button>
                  </div>
                )}
              </article>
            );
          })}

          {uncovered.length > 0 && (
            <div className="glass-panel-soft rounded-[22px] p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Parti non assegnate</p>
              <p className="text-xs text-muted-foreground">Di solito tempo in porto prima/dopo la registrazione. Se è navigazione, aggiungila.</p>
              {uncovered.map((range) => {
                const m = computeRangeMetrics(clean.points, stops, range.startIdx, range.endIdx);
                return (
                  <div key={`${range.startIdx}-${range.endIdx}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      {formatRomeTime(m.startAt)} → {formatRomeTime(m.endAt)} · {nm(m.distanceNm)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = addSegment(segments, range.startIdx, range.endIdx, null);
                        setSegments(next);
                        setSelectedUid(next.find((s) => s.startIdx === range.startIdx)?.uid ?? null);
                      }}
                    >
                      Aggiungi come segmento
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="glass-panel rounded-[22px] p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              «Conferma» pubblica le miglia e la rotta reale su biglietti e pagina viaggio. Il tracciato resta documentale: orari, prenotazioni e
              notifiche non cambiano.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={saving !== null} onClick={() => void save("draft")} className="gap-1">
                {saving === "draft" ? <Loader2 size={14} className="animate-spin" /> : null} Salva bozza
              </Button>
              <Button
                disabled={saving !== null || segments.some((s) => s.legIndex === null) || segments.length === 0}
                onClick={() => void save("confirmed")}
                className="gap-1"
              >
                {saving === "confirmed" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Conferma
              </Button>
            </div>
            {segments.some((s) => s.legIndex === null) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">Per confermare assegna una tratta a ogni segmento (o escludilo).</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default VoyageTrackEditor;
