import { useRef, useState } from "react";
import { format } from "date-fns";
import { Anchor, Check, Download, MapPin, Ship } from "lucide-react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { ParticipantVoyageTicket } from "@/lib/voyage-tickets";
import { formatTrackDuration } from "@/lib/voyage-track-summary";
import TrackRouteSketch from "@/components/voyage/TrackRouteSketch";

interface VoyageTicketCardProps {
  ticket: ParticipantVoyageTicket;
  participantName?: string;
}

const VoyageTicketCard = ({ ticket, participantName }: VoyageTicketCardProps) => {
  const { lang } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const dateLabel = ticket.startDate
    ? format(new Date(ticket.startDate), lang === "it" ? "d MMM yyyy" : "MMM d, yyyy")
    : null;

  const milesLabel = lang === "it" ? "mn" : "nm";
  const reachedStops = ticket.stops.filter((s) => s.reached).length;
  const track = ticket.track;
  const knLabel = lang === "it" ? "nodi" : "kn";
  const milesTitle =
    ticket.milesSource === "track"
      ? lang === "it"
        ? "Miglia percorse"
        : "Miles sailed"
      : lang === "it"
        ? "Miglia effettive"
        : "Actual miles";
  /** Honest about what the number is: measured, partly estimated, or planned proxy. */
  const milesNote =
    ticket.milesSource === "track"
      ? track?.partial
        ? lang === "it"
          ? "dal tracciato GPS, estremi stimati"
          : "from the GPS track, ends estimated"
        : lang === "it"
          ? "misurate dal tracciato GPS"
          : "measured on the GPS track"
      : ticket.milesSource === "mixed"
        ? lang === "it"
          ? "in parte dal tracciato GPS"
          : "partly from the GPS track"
        : null;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "transparent",
      });
      const link = document.createElement("a");
      link.download = `biglietto-${ticket.voyageSlug}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        ref={cardRef}
        className="relative overflow-hidden rounded-[28px] border border-glass-edge/55 bg-[linear-gradient(150deg,rgba(255,255,255,0.92),rgba(247,245,239,0.86))] dark:bg-[linear-gradient(150deg,rgba(26,37,55,0.92),rgba(21,31,47,0.86))] shadow-[0_20px_50px_rgba(15,23,42,0.10)]"
      >
        <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-accent/12 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-[1fr_auto] gap-4 p-6 md:p-7 pb-5">
          <div className="min-w-0">
            <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-1.5">
              {lang === "it" ? "Biglietto ricordo" : "Voyage ticket"}
            </p>
            <h3 className="editorial-heading text-xl md:text-2xl leading-tight truncate">{ticket.voyageName}</h3>
            {(participantName || dateLabel) && (
              <p className="text-sm font-sans text-muted-foreground mt-1">
                {participantName}
                {participantName && dateLabel ? ` · ${dateLabel}` : dateLabel}
              </p>
            )}
          </div>
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-glass-edge/70 bg-background/75 shrink-0">
            {ticket.voyageType === "water" ? (
              <Anchor size={17} className="text-accent" />
            ) : (
              <Ship size={17} className="text-accent" />
            )}
          </div>
        </div>

        <div className="relative flex items-center px-2">
          <div className="h-3 w-3 rounded-full bg-background border border-glass-edge/60 -ml-1.5" />
          <div className="flex-1 border-t border-dashed border-glass-edge/60" />
          <div className="h-3 w-3 rounded-full bg-background border border-glass-edge/60 -mr-1.5" />
        </div>

        <div className="relative p-6 md:p-7 pt-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[18px] border border-border/80 bg-glass/70 p-4">
              <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground mb-1.5">{milesTitle}</p>
              <p className="editorial-heading text-2xl leading-none">
                {Math.round(ticket.actualNauticalMiles)}
                <span className="text-sm text-muted-foreground font-sans ml-1">{milesLabel}</span>
              </p>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {lang === "it" ? "su" : "of"} {Math.round(ticket.plannedNauticalMiles)} {milesLabel}{" "}
                {lang === "it" ? "previste" : "planned"}
              </p>
              {milesNote && <p className="text-[10px] font-sans text-muted-foreground/80 mt-0.5">{milesNote}</p>}
            </div>
            <div className="rounded-[18px] border border-border/80 bg-glass/70 p-4">
              <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                {lang === "it" ? "Tappe raggiunte" : "Stops reached"}
              </p>
              <p className="editorial-heading text-2xl leading-none">
                {reachedStops}
                <span className="text-sm text-muted-foreground font-sans ml-1">/ {ticket.stops.length}</span>
              </p>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {ticket.isFullyTravelled
                  ? lang === "it"
                    ? "Viaggio completato"
                    : "Voyage completed"
                  : lang === "it"
                    ? "In corso"
                    : "In progress"}
              </p>
            </div>
          </div>

          {track && (
            <div className="rounded-[18px] border border-border/80 bg-glass/70 p-4 space-y-3">
              {track.actualRuns.length > 0 && (
                <TrackRouteSketch
                  planned={track.plannedRoute}
                  actual={track.actualRuns}
                  className="w-full h-auto text-foreground"
                  title={lang === "it" ? "Rotta prevista (tratteggio) e rotta reale" : "Planned route (dashed) and actual route"}
                />
              )}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    {lang === "it" ? "In navigazione" : "Under way"}
                  </p>
                  <p className="editorial-heading text-lg leading-tight mt-1">{formatTrackDuration(track.movingSeconds, lang)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    {lang === "it" ? "Media / max" : "Avg / max"}
                  </p>
                  <p className="editorial-heading text-lg leading-tight mt-1">
                    {track.avgSogKn?.toFixed(1) ?? "—"} / {track.maxSogKn?.toFixed(1) ?? "—"}
                    <span className="text-xs text-muted-foreground font-sans ml-1">{knLabel}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    {lang === "it" ? "Soste fuori programma" : "Unplanned stops"}
                  </p>
                  <p className="editorial-heading text-lg leading-tight mt-1">{track.unplannedStops}</p>
                </div>
              </div>
              {track.trackedLegs < ticket.totalLegs && (
                <p className="text-[11px] font-sans text-muted-foreground text-center">
                  {lang === "it"
                    ? `Tracciato GPS disponibile per ${track.trackedLegs} tratte su ${ticket.totalLegs}.`
                    : `GPS track available for ${track.trackedLegs} of ${ticket.totalLegs} legs.`}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {ticket.stops.map((stop, index) => (
              <div key={stop.waypointId} className="flex items-center gap-3">
                <div
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 ${
                    stop.reached
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-glass-edge/60 bg-background/60 text-muted-foreground/50"
                  }`}
                >
                  {stop.reached ? <Check size={12} /> : <MapPin size={11} />}
                </div>
                <span
                  className={`text-sm font-sans truncate ${
                    stop.reached ? "text-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {stop.name}
                </span>
                {index < ticket.stops.length - 1 && (
                  <div className="flex-1 border-t border-dotted border-glass-edge/50 min-w-[12px]" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading} className="gap-2">
        <Download size={14} />
        {downloading
          ? lang === "it"
            ? "Preparazione…"
            : "Preparing…"
          : lang === "it"
            ? "Scarica biglietto"
            : "Download ticket"}
      </Button>
    </div>
  );
};

export default VoyageTicketCard;
