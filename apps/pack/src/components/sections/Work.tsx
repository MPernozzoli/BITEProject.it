import { partnerships } from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { useReveal } from "@/hooks/use-reveal";
import { isItalian } from "@/data/site";

const ProjectCard = ({
  brand,
  type,
  deliverables,
  outcome,
  image,
  index,
}: (typeof partnerships)[number] & { index: number }) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal group" style={{ transitionDelay: `${index * 90}ms` }}>
      <div className="glass-frame mb-6 rounded-[30px] p-2 transition-shadow duration-500 group-hover:shadow-[0_0_0_1px_rgba(214,184,156,0.3)]">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[24px]">
          <img
            src={image}
            alt={type}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-out group-hover:scale-[1.04]"
            loading="lazy"
          />
        </div>
      </div>
      <div className="label-eyebrow mb-2 text-bronze">{brand}</div>
      <h3 className="mb-3 font-serif text-2xl leading-tight text-cream">{type}</h3>
      <div className="space-y-2 border-t border-cream/10 pt-4 font-sans text-sm">
        <p className="text-muted-foreground">
          <span className="label-eyebrow mr-2 text-cream/50">{isItalian ? "Deliverable" : "Deliverables"} —</span>
          {deliverables}
        </p>
        <p className="text-muted-foreground">
          <span className="label-eyebrow mr-2 text-cream/50">{isItalian ? "Risultato" : "Outcome"} —</span>
          {outcome}
        </p>
      </div>
    </div>
  );
};

export const Work = () => (
  <section id="work" className="page-section pt-6 md:pt-8">
    <div className="container-editorial">
      <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
        <SectionHeader
          eyebrow={isItalian ? "Progetti" : "Work"}
          title={isItalian ? "Collaborazioni, set e idee aperte." : "Recent lanes and open concepts."}
          description={
            isItalian
              ? "Una selezione di lavori possibili e trattamenti già chiari, scritti per far capire subito come Godot e Freyja possono entrare in un brief."
              : "A mix of shipped collaborations and treatments still on the table, written so buyers can see how the dogs move through a brief without guessing."
          }
        />
        <div className="mt-14 grid gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-3">
          {partnerships.map((p, i) => (
            <ProjectCard key={i} {...p} index={i} />
          ))}
        </div>
      </div>
    </div>
  </section>
);
