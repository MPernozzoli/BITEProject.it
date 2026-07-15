import { Calendar, MapPin, Download } from "lucide-react";

interface DatasetCardProps {
  title: string;
  date: string;
  location: string;
  variables: string[];
  observations: number;
  status?: "available" | "processing" | "planned";
}

const statusStyles = {
  available: "data-badge--active",
  processing: "data-badge text-data-amber",
  planned: "data-badge text-muted-foreground",
};

const statusLabels = {
  available: "Available",
  processing: "Processing",
  planned: "Planned",
};

const DatasetCard = ({ title, date, location, variables, observations, status = "available" }: DatasetCardProps) => (
  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:shadow-lg transition-shadow duration-300">
    <div className="flex items-start justify-between gap-3">
      <h3 className="font-serif text-lg font-semibold text-foreground leading-snug">{title}</h3>
      <span className={`shrink-0 ${statusStyles[status]}`}>
        {statusLabels[status]}
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground font-sans">
      <span className="inline-flex items-center gap-1.5">
        <Calendar size={14} className="text-muted-foreground" />
        {date}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <MapPin size={14} className="text-muted-foreground" />
        {location}
      </span>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {variables.map((v) => (
        <span key={v} className="data-badge text-foreground/70">{v}</span>
      ))}
    </div>
    <div className="flex items-center justify-between pt-2 border-t glass-divider">
      <span className="text-xs text-muted-foreground font-sans">{observations.toLocaleString()} observations</span>
      {status === "available" && (
        <button className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-teal hover:text-teal-muted transition-colors">
          <Download size={13} />
          Download
        </button>
      )}
    </div>
  </div>
);

export default DatasetCard;
