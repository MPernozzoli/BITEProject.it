import { useReveal } from "@/hooks/use-reveal";
import { overviewCards, uiCopy } from "@/data/site";

export const Overview = () => {
  return (
    <section id="overview" className="page-section">
      <div className="container-editorial">
        <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
          <div className="mb-12 grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <span className="glass-chip-bronze mb-5 inline-flex items-center gap-2 px-4 py-2 text-[10px] font-sans font-medium uppercase tracking-[0.26em] text-cream">
                <span className="h-1.5 w-1.5 rounded-full bg-charcoal/70" />
                {uiCopy.sections.overviewEyebrow}
              </span>
              <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-cream md:text-5xl">
                {uiCopy.sections.overviewTitle}
              </h2>
            </div>
            <div className="flex items-end lg:col-span-6 lg:col-start-7">
              <p className="font-sans text-base leading-relaxed text-muted-foreground md:text-lg">
                {uiCopy.sections.overviewBody}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {overviewCards.map((card, i) => (
              <OverviewCard key={card.label} {...card} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const OverviewCard = ({
  label,
  title,
  body,
  index,
}: {
  label: string;
  title: string;
  body: string;
  index: number;
}) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal group rounded-[28px] border border-cream/10 bg-cream/[0.03] p-8 transition-all duration-500 hover:-translate-y-1 hover:border-bronze/30 hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] lg:p-10"
      style={{ transitionDelay: `${index * 70}ms` }}
    >
      <div className="font-serif text-3xl text-bronze/90 md:text-4xl">{label}</div>
      <div className="label-eyebrow mb-4 mt-6 text-bronze">{uiCopy.sections.cardLabel}</div>
      <h3 className="mb-3 font-serif text-2xl leading-tight text-cream">{title}</h3>
      <p className="font-sans text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
};
