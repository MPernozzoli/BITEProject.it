import { ReactNode } from "react";

interface LegalPageShellProps {
  eyebrow: string;
  title: string;
  intro: string;
  lastUpdated: string;
  children: ReactNode;
}

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

export const LegalSection = ({ title, children }: LegalSectionProps) => (
  <section className="glass-panel-soft rounded-[30px] px-6 py-8 md:px-8 md:py-10">
    <div className="flex items-start gap-5 md:gap-8">
      <span className="glass-chip inline-flex h-9 min-w-9 shrink-0 items-center justify-center px-3 text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-accent/80" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="editorial-heading text-2xl md:text-3xl mb-5">{title}</h2>
        <div className="space-y-4 text-base leading-8 text-muted-foreground font-sans [&_ul]:space-y-3 [&_ul]:pl-5 [&_ul]:list-disc">
          {children}
        </div>
      </div>
    </div>
  </section>
);

const LegalPageShell = ({
  eyebrow,
  title,
  intro,
  lastUpdated,
  children,
}: LegalPageShellProps) => {
  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="pt-28 pb-0 md:pt-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
            <span className="h-2 w-2 rounded-full bg-accent" />
            {eyebrow}
          </div>
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-6">
            {title}
          </h1>
          <p className="editorial-body text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl">
            {intro}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 pt-0">
        <div className="page-section-narrow glass-panel rounded-[34px] px-6 py-8 md:px-10 md:py-10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b glass-divider pb-5">
            <div className="glass-chip inline-flex px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
              {title}
            </div>
            <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
              {lastUpdated}
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {children}
          </div>
        </div>
      </section>
    </div>
  );
};

export default LegalPageShell;
