import { Search, SlidersHorizontal } from "lucide-react";

interface FilterBarProps {
  filters?: { label: string; active?: boolean }[];
  onFilterClick?: (label: string) => void;
  placeholder?: string;
}

const FilterBar = ({ filters = [], onFilterClick, placeholder = "Search datasets..." }: FilterBarProps) => (
  <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center gap-4">
    <div className="relative flex-1 w-full">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 bg-transparent border border-border rounded-xl text-sm font-sans text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-teal/30 focus:border-teal/40 transition-all"
      />
    </div>
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-xs font-sans text-muted-foreground">
        <SlidersHorizontal size={14} />
        Filter:
      </span>
      {filters.map((f) => (
        <button
          key={f.label}
          onClick={() => onFilterClick?.(f.label)}
          className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${
            f.active
              ? "data-badge--active"
              : "data-badge text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  </div>
);

export default FilterBar;
