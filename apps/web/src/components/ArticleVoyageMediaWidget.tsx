import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Clapperboard, Expand, ExternalLink, File, MapPin } from "lucide-react";

import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Language } from "@/lib/i18n";
import type { VoyageWaypointMediaItem } from "@/lib/voyage-utils";

import { storageImageResponsiveProps } from "@/lib/storage-image";
type ArticleVoyageMediaItem = {
  id: string;
  waypointId: string;
  waypointName: string;
  waypointDescription: string | null;
  waypointCoordinates: string;
  waypointDate: string | null;
  media: VoyageWaypointMediaItem;
};

type ArticleVoyageMediaWidgetProps = {
  items: ArticleVoyageMediaItem[];
  lang: Language;
};

const getWidgetTitle = (items: ArticleVoyageMediaItem[], lang: Language) => {
  const kinds = new Set(items.map((item) => item.media.kind));

  if (kinds.size === 1 && kinds.has("image")) {
    return lang === "it" ? "Foto dal viaggio" : "Photos from the voyage";
  }

  if (kinds.size === 1 && kinds.has("video")) {
    return lang === "it" ? "Video dal viaggio" : "Videos from the voyage";
  }

  if (kinds.size === 2 && kinds.has("image") && kinds.has("video")) {
    return lang === "it" ? "Foto e video dal viaggio" : "Photos and videos from the voyage";
  }

  return lang === "it" ? "Media dal viaggio" : "Media from the voyage";
};

const getMediaLabel = (kind: VoyageWaypointMediaItem["kind"], lang: Language) => {
  if (kind === "image") return lang === "it" ? "Foto" : "Photo";
  if (kind === "video") return lang === "it" ? "Video" : "Video";
  return lang === "it" ? "Media" : "Media";
};

const renderCompactMedia = (item: ArticleVoyageMediaItem, lang: Language) => {
  if (item.media.kind === "image") {
    return (
      <img
        {...storageImageResponsiveProps(
          item.media.url,
          [360, 720, 1080],
          "(min-width: 768px) 22rem, 88vw"
        )}
        alt={item.media.name || item.waypointName}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    );
  }

  if (item.media.kind === "video") {
    return (
      <video
        src={item.media.url}
        playsInline
        preload="metadata"
        muted
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-6 text-center">
      <File className="h-8 w-8 text-accent" />
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          {item.media.name || (lang === "it" ? "Allegato della tappa" : "Stop attachment")}
        </p>
        <a
          href={item.media.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-accent transition-colors hover:text-foreground"
        >
          {lang === "it" ? "Apri media" : "Open media"}
        </a>
      </div>
    </div>
  );
};

const renderExpandedMedia = (item: ArticleVoyageMediaItem, lang: Language) => {
  if (item.media.kind === "image") {
    return (
      <img
        {...storageImageResponsiveProps(
          item.media.url,
          [720, 1120, 1600],
          "(min-width: 1120px) 1120px, 96vw"
        )}
        alt={item.media.name || item.waypointName}
        className="max-h-[68vh] w-full object-contain"
      />
    );
  }

  if (item.media.kind === "video") {
    return (
      <video
        src={item.media.url}
        controls
        playsInline
        autoPlay
        className="max-h-[68vh] w-full object-contain"
      />
    );
  }

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center">
      <File className="h-10 w-10 text-accent" />
      <p className="text-base font-medium">
        {item.media.name || (lang === "it" ? "Allegato della tappa" : "Stop attachment")}
      </p>
      <a
        href={item.media.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-sm text-accent transition-colors hover:text-white"
      >
        <ExternalLink size={16} />
        {lang === "it" ? "Apri allegato" : "Open attachment"}
      </a>
    </div>
  );
};

const ArticleVoyageMediaWidget = ({ items, lang }: ArticleVoyageMediaWidgetProps) => {
  const [api, setApi] = useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!api) return;

    const syncSelection = () => setActiveIndex(api.selectedScrollSnap());
    syncSelection();
    api.on("select", syncSelection);
    api.on("reInit", syncSelection);

    return () => {
      api.off("select", syncSelection);
      api.off("reInit", syncSelection);
    };
  }, [api]);

  useEffect(() => {
    if (expandedIndex == null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (items.length < 2) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setExpandedIndex((current) => (current == null ? current : (current - 1 + items.length) % items.length));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setExpandedIndex((current) => (current == null ? current : (current + 1) % items.length));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedIndex, items.length]);

  const title = useMemo(() => getWidgetTitle(items, lang), [items, lang]);
  const waypointCount = useMemo(() => new Set(items.map((item) => item.waypointId)).size, [items]);
  const expandedItem = expandedIndex == null ? null : items[expandedIndex];

  if (!items.length) return null;

  return (
    <>
    <section>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-accent mb-2">
            {lang === "it" ? "Widget viaggio" : "Voyage widget"}
          </p>
          <h2 className="editorial-heading text-2xl md:text-3xl">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {lang === "it"
              ? `${items.length} media da ${waypointCount} waypoint toccati da questa tratta.`
              : `${items.length} media items from ${waypointCount} waypoints touched by this leg.`}
          </p>
        </div>
        {items.length > 1 && (
          <span className="glass-chip shrink-0 px-3 py-1.5 text-xs font-sans text-muted-foreground">
            {activeIndex + 1} / {items.length}
          </span>
        )}
      </div>

        <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: items.length > 1 }}
        className="relative"
      >
        <CarouselContent className="-ml-0">
          {items.map((item, index) => (
            <CarouselItem key={item.id} className="pl-0">
              <article className="overflow-hidden rounded-[28px] border border-border/60 bg-background/40">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(index)}
                  className="group relative block w-full text-left"
                >
                  <div className="relative min-h-[220px] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(214,131,76,0.18),rgba(14,20,28,0.96))]">
                    {renderCompactMedia(item, lang)}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent px-4 pb-4 pt-16">
                      <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-white">
                        <Expand size={12} />
                        {lang === "it" ? "Apri grande" : "Open large"}
                      </span>
                    </div>
                  </div>
                </button>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-accent">
                        {item.media.kind === "image" ? <Camera size={12} /> : item.media.kind === "video" ? <Clapperboard size={12} /> : <File size={12} />}
                        {getMediaLabel(item.media.kind, lang)}
                      </span>
                      <h3 className="editorial-heading mt-3 text-lg leading-tight">{item.waypointName}</h3>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full border border-border/60 bg-background/70"
                      onClick={() => setExpandedIndex(index)}
                      aria-label={lang === "it" ? "Espandi media" : "Expand media"}
                    >
                      <Expand size={16} />
                    </Button>
                  </div>
                  {item.waypointDescription && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.waypointDescription}
                    </p>
                  )}
                  <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                    <div>
                      <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground/80">
                        {lang === "it" ? "Coordinate" : "Coordinates"}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-2">
                        <MapPin size={14} className="text-accent" />
                        <span>{item.waypointCoordinates}</span>
                      </p>
                    </div>
                    {item.waypointDate && (
                      <div>
                        <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground/80">
                          {lang === "it" ? "Data" : "Date"}
                        </p>
                        <p className="mt-1">{item.waypointDate}</p>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </CarouselItem>
          ))}
        </CarouselContent>

        {items.length > 1 && (
          <>
            <CarouselPrevious
              variant="secondary"
              className="left-4 top-[110px] translate-y-0 border border-glass-edge/15 bg-black/55 text-white hover:bg-black/70 hover:text-white"
            />
            <CarouselNext
              variant="secondary"
              className="right-4 top-[110px] translate-y-0 border border-glass-edge/15 bg-black/55 text-white hover:bg-black/70 hover:text-white"
            />
          </>
        )}
      </Carousel>
    </section>

    <Dialog open={expandedIndex != null} onOpenChange={(open) => !open && setExpandedIndex(null)}>
      {expandedItem && (
        <DialogContent className="max-w-[min(96vw,1120px)] overflow-hidden border border-glass-edge/10 bg-[rgba(10,14,20,0.96)] p-0 text-white shadow-2xl">
          <div className="grid max-h-[90vh] grid-rows-[minmax(0,1fr)_auto]">
            <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden bg-black">
              <div className="max-h-[68vh] w-full">
                {renderExpandedMedia(expandedItem, lang)}
              </div>

              {items.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute left-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border border-glass-edge/15 bg-black/60 text-white hover:bg-black/80"
                    onClick={() => setExpandedIndex((current) => (current == null ? current : (current - 1 + items.length) % items.length))}
                  >
                    <ChevronLeft size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border border-glass-edge/15 bg-black/60 text-white hover:bg-black/80"
                    onClick={() => setExpandedIndex((current) => (current == null ? current : (current + 1) % items.length))}
                  >
                    <ChevronRight size={18} />
                  </Button>
                </>
              )}
            </div>

            <div className="border-t border-glass-edge/10 bg-[rgba(10,14,20,0.98)] p-5 md:p-6">
              <DialogTitle className="editorial-heading text-2xl text-white">
                {expandedItem.waypointName}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {lang === "it" ? "Media della tappa espansa" : "Expanded stop media"}
              </DialogDescription>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-sans uppercase tracking-[0.2em] text-white/70">
                <span className="glass-chip px-3 py-1.5 text-white">{getMediaLabel(expandedItem.media.kind, lang)}</span>
                <span className="glass-chip px-3 py-1.5 text-white">{expandedIndex! + 1} / {items.length}</span>
              </div>
              {expandedItem.waypointDescription && (
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/78">
                  {expandedItem.waypointDescription}
                </p>
              )}
              <div className="mt-5 grid gap-4 text-sm text-white/78 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-white/50">
                    {lang === "it" ? "Coordinate" : "Coordinates"}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-2">
                    <MapPin size={14} className="text-accent" />
                    {expandedItem.waypointCoordinates}
                  </p>
                </div>
                {expandedItem.waypointDate && (
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-white/50">
                      {lang === "it" ? "Data" : "Date"}
                    </p>
                    <p className="mt-1">{expandedItem.waypointDate}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
    </>
  );
};

export default ArticleVoyageMediaWidget;
