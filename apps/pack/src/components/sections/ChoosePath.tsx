import { ArrowUpRight } from "lucide-react";
import { useReveal } from "@/hooks/use-reveal";
import { duoPhotos } from "@/data/photos";
import { isItalian } from "@/data/site";

export const ChoosePath = () => {
  const ref1 = useReveal<HTMLAnchorElement>();
  const ref2 = useReveal<HTMLAnchorElement>();

  return (
    <section className="page-section pt-8 md:pt-10">
      <div className="container-editorial">
        <div className="mb-14 text-center">
          <span className="glass-chip-bronze mb-5 inline-flex items-center gap-2 px-4 py-2 text-[10px] font-sans font-medium uppercase tracking-[0.26em] text-cream">
            <span className="h-1.5 w-1.5 rounded-full bg-charcoal/70" />
            {isItalian ? "Da qui" : "Start here"}
          </span>
          <h2 className="mx-auto max-w-4xl font-serif text-4xl leading-[1.05] tracking-tight text-cream md:text-5xl lg:text-6xl">
            {isItalian ? "Da quale lato vuoi partire?" : "Where would you like to begin?"}
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
          <a
            ref={ref1}
            href="#brands"
            className="reveal group block overflow-hidden rounded-[34px]"
          >
            <div className="glass-frame rounded-[34px] p-2 transition-shadow duration-500 group-hover:shadow-[0_0_0_1px_rgba(214,184,156,0.35),0_28px_70px_-24px_rgba(139,94,60,0.35)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] md:aspect-[5/6]">
                <img
                  src={duoPhotos.sunsetBoat}
                  alt="Godot and Freyja on deck at dusk"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-out group-hover:scale-[1.04]"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-10 lg:p-12">
                  <div className="label-eyebrow mb-3 text-bronze">{isItalian ? "Brand" : "Brands"}</div>
                  <h3 className="mb-3 font-serif text-3xl leading-tight text-cream md:text-4xl lg:text-5xl">
                    {isItalian
                      ? "Partnership pensate per immagini credibili, non per caption rumorose."
                      : "Partnerships built for quiet frames, not loud captions."}
                  </h3>
                  <p className="mb-6 max-w-md font-sans text-sm leading-relaxed text-cream/70">
                    {isItalian
                      ? "Reel, caroselli, ambassador arc: prodotti con lo stesso handler che sa quando ciascun cane sta davvero lavorando bene."
                      : "Reels, carousels, ambassador arcs — delivered with the same handler who knows how each dog reads fatigue."}
                  </p>
                  <span className="inline-flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.2em] text-cream">
                    {isItalian ? "Apri area brand" : "Open the brand lane"}
                    <ArrowUpRight
                      size={16}
                      className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </span>
                </div>
              </div>
            </div>
          </a>

          <a
            ref={ref2}
            href="#casting"
            className="reveal group block overflow-hidden rounded-[34px]"
            style={{ transitionDelay: "100ms" }}
          >
            <div className="glass-frame rounded-[34px] p-2 transition-shadow duration-500 group-hover:shadow-[0_0_0_1px_rgba(214,184,156,0.35),0_28px_70px_-24px_rgba(139,94,60,0.35)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] md:aspect-[5/6]">
                <img
                  src={duoPhotos.studioTight}
                  alt="Godot and Freyja studio portrait"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-out group-hover:scale-[1.04]"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-10 lg:p-12">
                  <div className="label-eyebrow mb-3 text-bronze">Casting</div>
                  <h3 className="mb-3 font-serif text-3xl leading-tight text-cream md:text-4xl lg:text-5xl">
                    {isItalian ? "Per call sheet che non possono permettersi caos." : "For call sheets that cannot afford chaos."}
                  </h3>
                  <p className="mb-6 max-w-md font-sans text-sm leading-relaxed text-cream/70">
                    {isItalian
                      ? "Note di temperamento, documenti di viaggio e piccole routine che tengono prevedibili due cani grandi quando il tempo corre."
                      : "Temperament notes, travel paperwork, and the small rituals that keep large dogs predictable when the clock is running."}
                  </p>
                  <span className="inline-flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.2em] text-cream">
                    {isItalian ? "Apri area casting" : "Open the casting lane"}
                    <ArrowUpRight
                      size={16}
                      className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </span>
                </div>
              </div>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
};
