import { Calendar, Navigation, Thermometer } from "lucide-react";

interface MissionCardProps {
  title: string;
  dateRange: string;
  area: string;
  distance?: string;
  sensors: string[];
  observations: number;
  status: "completed" | "active" | "planned";
}

const statusColors = {
  completed: "bg-data-green",
  active: "bg-data-blue",
  planned: "bg-muted-foreground/40",
};

const MissionCard = ({ title, dateRange, area, distance, sensors, observations, status }: MissionCardProps) => (
  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:shadow-lg transition-shadow duration-300 group">
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />
      <span className="text-xs font-sans uppercase tracking-[0.15em] text-muted-foreground font-medium">{status}</span>
    </div>
    <h3 className="font-serif text-xl font-semibold text-foreground">{title}</h3>
    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground font-sans">
      <span className="inline-flex items-center gap-1.5">
        <Calendar size={14} />
        {dateRange}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Navigation size={14} />
        {area}
      </span>
      {distance && (
        <span className="inline-flex items-center gap-1.5">
          {distance}
        </span>
      )}
    </div>
    <div className="flex flex-wrap gap-1.5">
      {sensors.map((s) => (
        <span key={s} className="data-badge text-foreground/70">
          <Thermometer size={11} />
          {s}
        </span>
      ))}
    </div>
    <div className="pt-2 border-t glass-divider flex items-center justify-between">
      <span className="text-xs text-muted-foreground font-sans">{observations.toLocaleString()} data points</span>
      <span className="text-xs font-sans font-medium text-teal group-hover:underline cursor-pointer">View mission →</span>
    </div>
  </div>
);

export default MissionCard;
