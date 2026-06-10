import { isItalian, services, whyPoints, pressKitItems } from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { useReveal } from "@/hooks/use-reveal";
import { Download, ArrowUpRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const ServiceCard = ({ title, body, index }: { title: string; body: string; index: number }) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal rounded-[24px] border border-cream/10 bg-cream/[0.04] p-8 transition-all duration-500 hover:-translate-y-0.5 hover:border-bronze/25 lg:p-9"
      style={{ transitionDelay: `${index * 45}ms` }}
    >
      <div className="font-serif text-2xl text-bronze/90">{String(index + 1).padStart(2, "0")}</div>
      <h3 className="mb-3 mt-4 font-serif text-xl leading-tight text-cream">{title}</h3>
      <p className="font-sans text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
};

export const Services = () => (
  <section className="page-section pt-6 md:pt-8">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow="Deliverables"
          title={isItalian ? "Cosa si puo commissionare." : "What can be commissioned."}
          description={
            isItalian
              ? "I formati si combinano o si separano in base al brief, sempre con un handler in call sheet e pause previste davvero."
              : "Formats stack or split depending on the brief — always with one handler on the call sheet and breaks written in ink, not implied."
          }
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {services.map((s, i) => (
            <ServiceCard key={s.title} {...s} index={i} />
          ))}
        </div>
      </div>
    </div>
  </section>
);

const WhyItem = ({ title, body, index }: { title: string; body: string; index: number }) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal" style={{ transitionDelay: `${index * 65}ms` }}>
      <div className="font-serif text-3xl text-bronze md:text-4xl">0{index + 1}</div>
      <h3 className="mb-3 mt-4 font-serif text-2xl leading-tight text-cream">{title}</h3>
      <p className="font-sans text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
};

export const Why = () => (
  <section className="page-section pt-4 md:pt-6">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow={isItalian ? "Perche loro" : "Why them"}
          title={isItalian ? "Perche proprio questo pack." : "Why this pack, specifically."}
          description={
            isItalian
              ? "Non perche internet abbia bisogno di altri cani. Perche questi due vivono gia molte delle storie che i brand provano a ricostruire."
              : "Not because the internet needs more dogs — because these two already live the stories brands keep trying to rent."
          }
        />
        <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-16">
          {whyPoints.map((p, i) => (
            <WhyItem key={p.title} {...p} index={i} />
          ))}
        </div>
      </div>
    </div>
  </section>
);

const PressCard = ({
  title,
  body,
  action,
  index,
}: {
  title: string;
  body: string;
  action: string;
  index: number;
}) => {
  const ref = useReveal<HTMLDivElement>();
  const handleClick = () =>
    toast({
      title: isItalian ? "Richiesta registrata" : "Request logged",
      description: isItalian
        ? "Ti rispondiamo via email con il file giusto."
        : "Someone from the pack will follow up by email with the right file.",
    });
  return (
    <div
      ref={ref}
      className="reveal flex flex-col rounded-[24px] border border-cream/12 bg-cream/[0.05] p-8 transition-all duration-500 hover:border-bronze/30"
      style={{ transitionDelay: `${index * 70}ms` }}
    >
      <div className="glass-chip-bronze mb-5 inline-flex h-11 w-11 items-center justify-center rounded-full p-0">
        <Download size={18} className="text-charcoal" />
      </div>
      <h3 className="mb-2 font-serif text-2xl text-cream">{title}</h3>
      <p className="mb-6 flex-1 font-sans text-sm leading-relaxed text-muted-foreground">{body}</p>
      <button
        type="button"
        onClick={handleClick}
        className="group flex items-center justify-between gap-4 border-t border-cream/10 pt-4 font-sans text-[12px] font-semibold uppercase tracking-[0.2em] text-cream transition-colors hover:text-bronze"
      >
        {action}
        <ArrowUpRight
          size={16}
          className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        />
      </button>
    </div>
  );
};

export const PressKit = () => (
  <section className="page-section pt-4 md:pt-6">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow="Download"
          title={isItalian ? "File per brand, agenti ed editor." : "Files for buyers, agents, and editors."}
          description={
            isItalian
              ? "Nessun download automatico: ogni asset viene inviato dopo un controllo umano, cosi arriva la versione utile alla persona giusta."
              : "Nothing auto-downloads here — each asset is sent after a quick human check so the right version lands with the right team."
          }
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 md:gap-5">
          {pressKitItems.map((p, i) => (
            <PressCard key={p.title} {...p} index={i} />
          ))}
        </div>
      </div>
    </div>
  </section>
);
