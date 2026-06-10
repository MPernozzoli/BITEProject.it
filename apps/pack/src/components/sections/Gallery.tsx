import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { galleryItems, galleryCategories, isItalian } from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";

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
  const [filter, setFilter] = useState<(typeof galleryCategories)[number]>("All");
  const [lightbox, setLightbox] = useState<number | null>(null);

  const filtered = galleryItems.filter((g) => filter === "All" || g.category === filter);

  const goPrev = useCallback(() => {
    if (lightbox === null || filtered.length === 0) return;
    setLightbox((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length));
  }, [lightbox, filtered.length]);

  const goNext = useCallback(() => {
    if (lightbox === null || filtered.length === 0) return;
    setLightbox((i) => (i === null ? null : (i + 1) % filtered.length));
  }, [lightbox, filtered.length]);

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
                ? "Ritratti, barca, città, acqua. Apri ogni frame pulito; i filtri servono solo a togliere quello che non ti serve ora."
                : "Portraits, boat days, city nights. Tap any frame to view it clean; filters only hide what you do not need on this pass."
            }
          />

          <div className="mt-10 mb-10 flex flex-wrap gap-2">
            {galleryCategories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={cn(
                  "rounded-full border px-4 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] transition-all duration-300",
                  filter === c
                    ? "glass-chip-bronze border-bronze/50 text-charcoal"
                    : "border-cream/12 bg-cream/[0.05] text-muted-foreground hover:border-bronze/30 hover:text-cream",
                )}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>

          <div className="columns-1 gap-3 [column-fill:_balance] sm:columns-2 lg:columns-3 md:gap-4">
            {filtered.map((item, i) => (
              <button
                key={`${item.src}-${i}`}
                type="button"
                onClick={() => setLightbox(i)}
                className="group relative mb-3 block w-full cursor-zoom-in break-inside-avoid overflow-hidden md:mb-4"
              >
                <div className="glass-frame rounded-[24px] p-1.5 transition-shadow duration-500 group-hover:shadow-[0_0_0_1px_rgba(214,184,156,0.28)]">
                  <div className="overflow-hidden rounded-[18px]">
                    <img
                      src={item.src}
                      alt={item.alt}
                      className="h-auto w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-background/0 transition-colors duration-500 group-hover:bg-background/15" />
                <div className="absolute bottom-4 left-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <span className="glass-chip inline-flex px-2.5 py-1 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-cream">
                    {item.category}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {lightbox !== null && filtered[lightbox] && (
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
          {filtered.length > 1 && (
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
              src={filtered[lightbox].src}
              alt={filtered[lightbox].alt}
              className="max-h-[min(82vh,860px)] w-auto max-w-full rounded-[22px] object-contain"
            />
            <p className="mt-3 text-center font-sans text-xs text-muted-foreground">
              {lightbox + 1} / {filtered.length} · {categoryLabel(filtered[lightbox].category)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
