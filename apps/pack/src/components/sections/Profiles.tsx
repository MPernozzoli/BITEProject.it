import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { profiles, type DogProfile } from "@/data/profiles";
import { uiCopy } from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { useReveal } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-3 gap-4 border-t border-cream/10 py-4 first:border-t-0 first:pt-0">
    <div className="label-eyebrow col-span-1 self-start pt-0.5">{label}</div>
    <div className="col-span-2 font-sans text-sm leading-relaxed text-cream/90">{value}</div>
  </div>
);

const ProfilePanel = ({ p }: { p: DogProfile }) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-5">
        <div className="glass-frame rounded-[30px] p-2">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[24px]">
            <img
              src={p.image}
              alt={`${p.name} — ${p.breed}`}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute bottom-4 left-4">
              <span className="glass-chip-bronze inline-flex px-3 py-1.5 text-[10px] font-sans font-semibold uppercase tracking-[0.2em] text-cream">
                {p.name}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-6">
          <div className="label-eyebrow mb-2 text-bronze">{uiCopy.sections.talentCard}</div>
          <h3 className="font-serif text-5xl leading-none tracking-tight text-cream md:text-6xl">
            {p.name}
          </h3>
          <p className="mt-3 font-sans text-muted-foreground">{p.breed}</p>
        </div>
      </div>

      <div className="glass-panel-soft rounded-[28px] p-6 md:p-8 lg:col-span-7">
        <Field label={uiCopy.profileFields.sex} value={p.sex} />
        <Field label={uiCopy.profileFields.born} value={p.born} />
        <Field label={uiCopy.profileFields.weight} value={p.weight} />
        <Field label={uiCopy.profileFields.height} value={p.height} />
        <Field label={uiCopy.profileFields.coat} value={p.coat} />
        <Field label={uiCopy.profileFields.base} value={p.base} />
        <Field label={uiCopy.profileFields.passport} value={p.passport} />
        <Field label={uiCopy.profileFields.vaccinations} value={p.vaccinations} />
        <Field label={uiCopy.profileFields.temperament} value={p.temperament} />

        <div className="mt-8 border-t border-cream/10 pt-8">
          <div className="label-eyebrow mb-4">{uiCopy.sections.onSet}</div>
          <ul className="space-y-3">
            {p.strengths.map((s) => (
              <li key={s} className="flex gap-3 font-sans text-sm leading-relaxed text-cream/88">
                <span className="mt-0.5 shrink-0 text-bronze">—</span>
                {s}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 border-t border-cream/10 pt-8">
          <div className="label-eyebrow mb-4">{uiCopy.sections.commands}</div>
          <div className="flex flex-wrap gap-2">
            {p.commands.map((c) => (
              <span
                key={c}
                className="glass-chip rounded-full px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-cream/85"
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 border-t border-cream/10 pt-8">
          <div className="label-eyebrow mb-4">{uiCopy.sections.environments}</div>
          <div className="flex flex-wrap gap-2">
            {p.environments.map((e) => (
              <span
                key={e}
                className="rounded-full border border-cream/12 bg-cream/[0.06] px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-cream/80"
              >
                {e}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 border-t border-cream/10 pt-8">
          <div className="label-eyebrow mb-3">{uiCopy.sections.handlerNote}</div>
          <p className="font-sans text-sm leading-relaxed text-muted-foreground">{p.handlerNotes}</p>
        </div>
      </div>
    </div>
  );
};

export const Profiles = () => {
  const [tab, setTab] = useState<"godot" | "freyja">("godot");
  return (
    <section id="profiles" className="page-section pt-8 md:pt-10">
      <div className="container-editorial">
        <SectionHeader
          eyebrow={uiCopy.sections.profilesEyebrow}
          title={uiCopy.sections.profilesTitle}
          description={uiCopy.sections.profilesBody}
        />
        <Tabs value={tab} onValueChange={(v) => setTab(v as "godot" | "freyja")} className="mt-12">
          <TabsList className="mb-2 flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl border border-cream/10 bg-cream/[0.04] p-2">
            {profiles.map((p) => (
              <TabsTrigger
                key={p.id}
                value={p.id}
                className={cn(
                  "rounded-full border border-transparent px-5 py-3 font-sans text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition-all data-[state=active]:border-bronze/40 data-[state=active]:bg-bronze/15 data-[state=active]:text-cream data-[state=active]:shadow-none",
                )}
              >
                {p.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {profiles.map((p) => (
            <TabsContent key={p.id} value={p.id} className="mt-0">
              <ProfilePanel p={p} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
};
