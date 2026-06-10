import { ReactNode } from "react";

interface SensorCardProps {
  name: string;
  description: string;
  unit: string;
  icon: ReactNode;
  limitations?: string;
}

const SensorCard = ({ name, description, unit, icon, limitations }: SensorCardProps) => (
  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-teal/10 flex items-center justify-center text-teal">
        {icon}
      </div>
      <div>
        <h3 className="font-serif text-lg font-semibold text-foreground">{name}</h3>
        <span className="text-xs font-sans text-muted-foreground">{unit}</span>
      </div>
    </div>
    <p className="text-sm font-sans text-muted-foreground leading-relaxed">{description}</p>
    {limitations && (
      <div className="pt-3 border-t glass-divider">
        <p className="text-xs font-sans text-muted-foreground/70 italic">Limitations: {limitations}</p>
      </div>
    )}
  </div>
);

export default SensorCard;
