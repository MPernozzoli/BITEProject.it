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
  <section className="border-t border-border pt-8">
    <h2 className="editorial-heading text-2xl md:text-3xl mb-5">{title}</h2>
    <div className="space-y-4 text-base leading-8 text-muted-foreground font-sans">
      {children}
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
    <div>
      <section className="pt-32 pb-16 md:pt-40 md:pb-20 px-6 md:px-12 bg-salt-warm border-b border-border">
        <div className="page-section-narrow">
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-6">
            {eyebrow}
          </p>
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-5">
            {title}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-3xl">
            {intro}
          </p>
          <p className="mt-6 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
            {lastUpdated}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 py-16 md:py-20">
        <div className="page-section-narrow space-y-10">{children}</div>
      </section>
    </div>
  );
};

export default LegalPageShell;
