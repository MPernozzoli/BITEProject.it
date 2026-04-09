import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function getDateOnlyValue(value?: string | null) {
  if (!value) return null;
  return value.slice(0, 10);
}

export function isDateWithinRange(value: string | null, from: string, to: string) {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export type AdminCollapsibleListFiltersProps = {
  title: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  visibleCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  minimalRow: ReactNode;
  advancedRow: ReactNode;
};

export function AdminCollapsibleListFilters({
  title,
  expanded,
  onToggleExpanded,
  visibleCount,
  totalCount,
  hasActiveFilters,
  onResetFilters,
  advancedOpen,
  onToggleAdvanced,
  minimalRow,
  advancedRow,
}: AdminCollapsibleListFiltersProps) {
  return (
    <div className="rounded-[16px] border border-border/70 bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans hover:bg-muted/30 transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="shrink-0 text-muted-foreground" size={16} aria-hidden />
        ) : (
          <ChevronRight className="shrink-0 text-muted-foreground" size={16} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="ml-2 text-[11px] text-muted-foreground">
            {visibleCount}/{totalCount} visibili
            {hasActiveFilters ? " · filtri attivi" : ""}
          </span>
        </div>
        {hasActiveFilters ? (
          <span
            role="presentation"
            className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider text-foreground"
          >
            Attivi
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-border/60 px-3 pb-2.5 pt-1 space-y-2">
          <div className="flex flex-wrap items-end gap-x-2 gap-y-2">{minimalRow}</div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleAdvanced}
              className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
            >
              {advancedOpen ? "Nascondi avanzate" : "Avanzate"}
            </button>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
              >
                Reset filtri
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleExpanded}
              className="ml-auto text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
            >
              Chiudi
            </button>
          </div>

          {advancedOpen ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/40">{advancedRow}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const selectClass =
  "w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent";
const labelClass =
  "text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block";
const dateInputClass =
  "w-full min-w-0 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent";

export const adminFilterSelectClass = selectClass;
export const adminFilterLabelClass = labelClass;
export const adminFilterDateInputClass = dateInputClass;
