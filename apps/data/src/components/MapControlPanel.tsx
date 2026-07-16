import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import type { ObservationParameter } from "@/hooks/use-observations";
import type { Voyage } from "@/hooks/use-voyages";
import type { ValueScale } from "@/lib/observation-scale";
import { buildVoyageUrl } from "@/lib/voyage-link";
import { formatValue } from "@/lib/observation-scale";

/** The "all data types" pseudo-option sits at index 0 of the carousel. */
const ALL = "all";

interface MapControlPanelProps {
  isLoading: boolean;
  pointCount: number;
  totalCount: number;

  parameters: ObservationParameter[];
  parameterCode: string;
  onSelectParameter: (code: string) => void;
  scale: ValueScale | null;

  years: string[];
  activeYear: string | null;
  isAllYears: boolean;
  onAllYears: () => void;
  onSelectYear: (year: string) => void;

  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;

  voyages: Voyage[];
  voyageColors: Map<string, string>;
}

const MapControlPanel = ({
  isLoading,
  pointCount,
  totalCount,
  parameters,
  parameterCode,
  onSelectParameter,
  scale,
  years,
  activeYear,
  isAllYears,
  onAllYears,
  onSelectYear,
  from,
  to,
  onFrom,
  onTo,
  voyages,
  voyageColors,
}: MapControlPanelProps) => {
  const [open, setOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // The carousel walks "all" plus every parameter, in catalog order.
  const options = useMemo(
    () => [{ code: ALL, label: "All data types", unit: "" }, ...parameters.map((p) => ({
      code: p.code,
      label: p.label_en,
      unit: p.unit,
    }))],
    [parameters],
  );
  const index = Math.max(0, options.findIndex((o) => o.code === parameterCode));
  const selectedParameter = parameters.find((p) => p.code === parameterCode) ?? null;

  const step = useCallback(
    (delta: number) => {
      if (options.length === 0) return;
      const next = (index + delta + options.length) % options.length;
      onSelectParameter(options[next].code);
    },
    [index, options, onSelectParameter],
  );

  // Arrow keys walk the data types the same way they page through logbook articles — but
  // not while typing into the date inputs, and not while the map has focus (MapLibre pans
  // the camera with the arrows, and stealing that would feel broken).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target;
      if (target instanceof Element) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (target.closest(".maplibregl-map")) return;
      }
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/60 bg-background/75 px-4 py-2.5 text-xs font-sans font-medium text-foreground shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-colors hover:text-teal"
      >
        <SlidersHorizontal size={14} />
        Filters &amp; layers
      </button>
    );
  }

  const current = options[index];

  return (
    <div className="absolute inset-x-3 top-4 bottom-4 z-20 flex flex-col overflow-hidden rounded-[28px] border border-white/55 bg-background/72 shadow-[0_30px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl animate-slide-in-right sm:inset-x-auto sm:right-4 sm:w-[380px] xl:w-[400px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/45 bg-background/55 px-5 py-4 backdrop-blur-xl">
        <div className="min-w-0">
          <h1 className="editorial-heading text-lg text-foreground leading-tight">
            Field observations
          </h1>
          <p className="mt-0.5 text-xs font-sans text-muted-foreground">
            {isLoading
              ? "Loading observations…"
              : `${pointCount.toLocaleString()} of ${totalCount.toLocaleString()} sampling points`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/60 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Collapse panel"
        >
          <X size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ touchAction: "pan-y" }}>
        {/* Data type carousel */}
        <section className="rounded-[22px] border border-white/55 bg-white/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
          <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
            Data type
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/70 text-muted-foreground transition-colors hover:text-teal"
              aria-label="Previous data type"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate font-serif text-base font-semibold text-foreground">
                {current.label}
              </p>
              <p className="text-[11px] font-sans text-muted-foreground">
                {current.unit ? current.unit : `${parameters.length} variables`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => step(1)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/70 text-muted-foreground transition-colors hover:text-teal"
              aria-label="Next data type"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Position dots — the same "where am I in the set" cue the article pager uses. */}
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {options.map((o, i) => (
              <button
                key={o.code}
                type="button"
                onClick={() => onSelectParameter(o.code)}
                title={o.label}
                aria-label={o.label}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-teal" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                }`}
              />
            ))}
          </div>

          {/* Colour scale for the selected numeric parameter */}
          {scale && selectedParameter ? (
            <div className="mt-4 border-t border-white/50 pt-3">
              <div
                className="h-2.5 w-full rounded-full"
                style={{ background: `linear-gradient(to right, ${scale.stops.join(", ")})` }}
              />
              <div className="mt-1 flex justify-between text-[10px] font-sans text-muted-foreground">
                <span>{formatValue(scale.min, selectedParameter)}</span>
                <span>{selectedParameter.unit}</span>
                <span>{formatValue(scale.max, selectedParameter)}</span>
              </div>
              {selectedParameter.accuracy && (
                <p className="mt-2 text-[10px] font-sans text-muted-foreground/70">
                  Accuracy {selectedParameter.accuracy}
                </p>
              )}
            </div>
          ) : selectedParameter && selectedParameter.value_type === "categorical" ? (
            <p className="mt-3 border-t border-white/50 pt-3 text-[10px] font-sans text-muted-foreground/70">
              Categorical — points keep their voyage colour; values are in the tooltip.
            </p>
          ) : null}
        </section>

        {/* Voyages. When a value scale is on, the points are coloured by magnitude, not by
            voyage — so the swatch here would falsely claim "blue points = this voyage". It
            goes neutral in that case, and the dot only carries voyage identity when the map
            does too. */}
        <section className="mt-4 rounded-[22px] border border-white/55 bg-white/50 p-4">
          <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
            Voyages
          </p>
          <div className="space-y-1.5">
            {voyages.map((v) => (
              <a
                key={v.id}
                href={buildVoyageUrl(v)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2"
                title={`Read ${v.name_en || v.name} on biteproject.it`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white"
                  style={{ backgroundColor: scale ? "hsl(var(--muted-foreground) / 0.4)" : voyageColors.get(v.id) }}
                />
                <span className="truncate text-[12px] font-sans text-muted-foreground transition-colors group-hover:text-foreground">
                  {v.name_en || v.name}
                </span>
                <ExternalLink
                  size={10}
                  className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
                />
              </a>
            ))}
          </div>
        </section>

        {/* Time — primary filter */}
        <section className="mt-4 rounded-[22px] border border-white/55 bg-white/50 p-4">
          <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
            Time
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAllYears}
              className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${
                isAllYears ? "data-badge--active" : "data-badge text-muted-foreground hover:text-foreground"
              }`}
            >
              All years
            </button>
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => onSelectYear(year)}
                className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${
                  activeYear === year
                    ? "data-badge--active"
                    : "data-badge text-muted-foreground hover:text-foreground"
                }`}
              >
                {year}
              </button>
            ))}
          </div>

          {/* Advanced: exact date window, folded away by default */}
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-sans text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={advancedOpen}
          >
            <ChevronDown
              size={13}
              className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
            Custom range
          </button>
          {advancedOpen && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] font-sans text-muted-foreground">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => onFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-teal/30"
                />
              </label>
              <label className="text-[10px] font-sans text-muted-foreground">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => onTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-teal/30"
                />
              </label>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default MapControlPanel;
