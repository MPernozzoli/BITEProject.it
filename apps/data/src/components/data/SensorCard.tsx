import { ReactNode } from "react";

interface SensorCardProps {
  name: string;
  description: string;
  unit: string;
  icon: ReactNode;
  accuracy?: string | null;
  limitations?: string | null;
}

const SensorCard = ({ name, description, unit, icon, accuracy, limitations }: SensorCardProps) => (
  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-teal/10 flex items-center justify-center text-teal">
          {icon}
        </div>
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">{name}</h3>
          <span className="text-xs font-sans text-muted-foreground">{unit}</span>
        </div>
      </div>
      {accuracy && (
        <span className="glass-chip shrink-0 px-2.5 py-1 text-[10px] font-sans text-muted-foreground whitespace-nowrap">
          {accuracy}
        </span>
      )}
    </div>

    {description && (
      <p className="text-sm font-sans text-muted-foreground leading-relaxed">{description}</p>
    )}

    <div className="mt-auto pt-3 border-t glass-divider">
      {limitations ? (
        <p className="text-xs font-sans text-muted-foreground/70 italic">Limitations: {limitations}</p>
      ) : (
        // Saying nothing here would read as "no known limitations" — which is never true of a
        // field instrument, so the gap is stated instead.
        <p className="text-xs font-sans text-muted-foreground/50 italic">
          Limitations not yet documented.
        </p>
      )}
    </div>
  </div>
);

export default SensorCard;
