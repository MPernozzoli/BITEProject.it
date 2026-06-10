import { useReveal } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}

export const SectionHeader = ({ eyebrow, title, description, align = "left", className }: Props) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        "reveal max-w-3xl",
        align === "center" && "mx-auto text-center",
        align === "center" && "flex flex-col items-center",
        className,
      )}
    >
      {eyebrow && (
        <div className="mb-5">
          <span className="glass-chip-bronze inline-flex items-center gap-2 px-4 py-2 text-[10px] font-sans font-medium uppercase tracking-[0.26em] text-cream">
            <span className="h-1.5 w-1.5 rounded-full bg-charcoal/70" />
            {eyebrow}
          </span>
        </div>
      )}
      <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-cream md:text-5xl lg:text-6xl">
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "mt-6 max-w-2xl font-sans text-base leading-relaxed text-muted-foreground md:text-lg",
            align === "center" && "mx-auto",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
};
