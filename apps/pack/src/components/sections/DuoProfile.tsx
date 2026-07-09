import { useReveal } from "@/hooks/use-reveal";
import { duoPhotos } from "@/data/photos";
import { isItalian, uiCopy } from "@/data/site";

const tags = isItalian
  ? ["Stills campagna", "Outdoor e barca", "Family travel", "Pet goods premium", "Editoriale", "Narrativa lunga"]
  : ["Campaign stills", "Outdoor & boat", "Family travel", "Premium pet goods", "Editorial", "Long-form narrative"];

export const DuoProfile = () => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="page-section pt-6 md:pt-8">
      <div className="container-editorial">
        <div
          ref={ref}
          className="reveal grid items-stretch gap-10 lg:grid-cols-12 lg:gap-16"
        >
          <div className="order-2 lg:order-1 lg:col-span-6">
            <div className="glass-panel-soft flex h-full flex-col justify-center rounded-[32px] p-8 md:p-10">
              <div className="label-eyebrow mb-4 text-bronze/90">{uiCopy.sections.duoEyebrow}</div>
              <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-cream md:text-5xl lg:text-6xl">
                {uiCopy.sections.duoTitle}
              </h2>
              <p className="mt-6 font-sans text-base leading-relaxed text-muted-foreground md:text-lg">
                {uiCopy.sections.duoBody}
              </p>

              <div className="label-eyebrow mb-4 mt-10 text-bronze">{uiCopy.sections.duoBestFor}</div>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="glass-chip rounded-full px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-cream/85"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2 lg:col-span-6">
            <div className="glass-frame h-full rounded-[34px] p-2">
              <div className="relative h-full min-h-[420px] overflow-hidden rounded-[28px] md:min-h-[560px]">
                <img
                  src={duoPhotos.studioWide}
                  alt="Godot and Freyja, full-length studio portrait"
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
