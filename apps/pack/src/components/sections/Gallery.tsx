import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { galleryItems, isItalian } from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

const categoryLabel = (category: string) => {
  if (!isItalian) return category;
  const labels: Record<string, string> = {
    All: "Tutte",
    Portraits: "Ritratti",
    Studio: "Studio",
    Lifestyle: "Lifestyle",
    Outdoor: "Outdoor",
    Boat: "Barca",
    Water: "Acqua",
    Duo: "Duo",
    City: "Citta",
    Seasonal: "Stagionali",
    Events: "Eventi",
  };
  return labels[category] ?? category;
};

export const Gallery = () => {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const goPrev = useCallback(() => {
    if (lightbox === null || galleryItems.length === 0) return;
    setLightbox((i) => (i === null ? null : (i - 1 + galleryItems.length) % galleryItems.length));
  }, [lightbox]);

  const goNext = useCallback(() => {
    if (lightbox === null || galleryItems.length === 0) return;
    setLightbox((i) => (i === null ? null : (i + 1) % galleryItems.length));
  }, [lightbox]);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, goPrev, goNext]);

  return (
    <section id="gallery" className="page-section pt-6 md:pt-8">
      <div className="container-editorial">
        <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
          <SectionHeader
            eyebrow={isItalian ? "Galleria" : "Gallery"}
            title={isItalian ? "Uno stills file vivo, non una raccolta patinata." : "A running stills file, not a greatest-hits reel."}
            description={
              isItalian
                ? "Ritratti, barca, città, acqua. Scorri il carosello e apri ogni frame pulito quando ti serve vederlo meglio."
                : "Portraits, boat days, city nights. Scroll the carousel and tap any frame when you need a cleaner view."
            }
          />

          <Carousel
            opts={{ align: "start", loop: true }}
            className="mt-12"
            aria-label={isItalian ? "Carosello galleria" : "Gallery carousel"}
          >
            <CarouselContent className="-ml-4">
              {galleryItems.map((item, i) => (
                <CarouselItem key={`${item.src}-${i}`} className="pl-4 sm:basis-1/2 lg:basis-1/3">
                  <button
                    type="button"
                    onClick={() => setLightbox(i)}
                    className="group block h-full w-full cursor-zoom-in text-left"
                  >
                    <div className="glass-frame h-full rounded-[24px] p-1.5 transition-shadow duration-500 group-hover:shadow-[0_0_0_1px_rgba(214,184,156,0.28)]">
                      <div className="relative aspect-[4/5] overflow-hidden rounded-[18px]">
                        <img
                          src={item.src}
                          alt={item.alt}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/70 via-background/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                        <div className="absolute bottom-4 left-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-cream">
                            {categoryLabel(item.category)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </CarouselItem>
              ))}
            </CarouselContent>
            <div className="mt-6 flex items-center justify-end gap-3">
              <CarouselPrevious
                className="static h-11 w-11 translate-y-0 border-cream/12 bg-cream/[0.06] text-cream hover:bg-cream/10 disabled:opacity-35"
                aria-label={isItalian ? "Scorri indietro" : "Previous images"}
              />
              <CarouselNext
                className="static h-11 w-11 translate-y-0 border-cream/12 bg-cream/[0.06] text-cream hover:bg-cream/10 disabled:opacity-35"
                aria-label={isItalian ? "Scorri avanti" : "Next images"}
              />
            </div>
          </Carousel>
        </div>
      </div>

      {lightbox !== null && galleryItems[lightbox] && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-2xl animate-in fade-in duration-200 md:p-10"
          role="dialog"
          aria-modal="true"
          aria-label={isItalian ? "Anteprima immagine" : "Image preview"}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="glass-chip absolute right-4 top-4 z-[110] inline-flex h-11 w-11 items-center justify-center rounded-full text-cream transition-colors hover:bg-cream/10 md:right-8 md:top-8"
            aria-label={isItalian ? "Chiudi" : "Close"}
          >
            <X size={22} />
          </button>
          {galleryItems.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="glass-chip absolute left-2 top-1/2 z-[110] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-cream md:left-6"
                aria-label={isItalian ? "Immagine precedente" : "Previous image"}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="glass-chip absolute right-2 top-1/2 z-[110] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-cream md:right-6"
                aria-label={isItalian ? "Immagine successiva" : "Next image"}
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
          <div
            className="glass-frame max-h-[min(88vh,900px)] max-w-5xl rounded-[28px] p-2 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={galleryItems[lightbox].src}
              alt={galleryItems[lightbox].alt}
              className="max-h-[min(82vh,860px)] w-auto max-w-full rounded-[22px] object-contain"
            />
            <p className="mt-3 text-center font-sans text-xs text-muted-foreground">
              {lightbox + 1} / {galleryItems.length} · {categoryLabel(galleryItems[lightbox].category)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
