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
        <div className="label-eyebrow mb-4 text-bronze/90">{eyebrow}</div>
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
