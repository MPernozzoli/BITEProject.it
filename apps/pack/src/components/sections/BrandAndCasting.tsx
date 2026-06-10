import { SectionHeader } from "@/components/SectionHeader";
import { brandSubsections, castingSubsections, uiCopy } from "@/data/site";
import { useReveal } from "@/hooks/use-reveal";

interface Sub {
  title: string;
  body: string;
}

const SubGrid = ({ items }: { items: Sub[] }) => (
  <div className="mt-12 grid gap-4 sm:grid-cols-2">
    {items.map((s, i) => (
      <SubCard key={s.title} {...s} index={i} />
    ))}
  </div>
);

const SubCard = ({ title, body, index }: Sub & { index: number }) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal rounded-[24px] border border-cream/10 bg-cream/[0.04] p-8 transition-all duration-500 hover:border-bronze/25 lg:p-10"
      style={{ transitionDelay: `${index * 70}ms` }}
    >
      <div className="font-serif text-2xl text-bronze/95">0{index + 1}</div>
      <h4 className="mb-3 mt-4 font-serif text-2xl text-cream">{title}</h4>
      <p className="font-sans text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
};

export const BrandKit = () => (
  <section id="brands" className="page-section pt-8 md:pt-10">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow={uiCopy.sections.brandEyebrow}
          title={uiCopy.sections.brandTitle}
          description={uiCopy.sections.brandBody}
        />
        <SubGrid items={brandSubsections} />
      </div>
    </div>
  </section>
);

export const CastingProfile = () => (
  <section id="casting" className="page-section pt-4 md:pt-6">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow={uiCopy.sections.castingEyebrow}
          title={uiCopy.sections.castingTitle}
          description={uiCopy.sections.castingBody}
        />
        <SubGrid items={castingSubsections} />
      </div>
    </div>
  </section>
);
