import { useEffect, useRef, useState } from "react";
import {
  instagramProfile,
  languages,
  metrics as fallbackMetrics,
  publicMetricsMethodology,
  topCountries,
  currentLanguage,
  uiCopy,
} from "@/data/site";
import { SectionHeader } from "@/components/SectionHeader";
import { useReveal } from "@/hooks/use-reveal";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const formatNumber = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toString();
};

const Counter = ({ value, suffix }: { value: number; suffix: string }) => {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const duration = 1600;
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - t, 3);
              setDisplay(value * eased);
              if (t < 1) requestAnimationFrame(tick);
              else setDisplay(value);
            };
            requestAnimationFrame(tick);
          }
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const isFloat = value % 1 !== 0;
  const formatted = isFloat ? display.toFixed(1) : formatNumber(Math.round(display));

  return (
    <span
      ref={ref}
      className="metric-shimmer font-serif text-5xl tabular-nums text-cream md:text-6xl lg:text-7xl"
    >
      {formatted}
      <span className="text-bronze">{suffix}</span>
    </span>
  );
};

const MetricCard = ({
  label,
  value,
  suffix,
  index,
}: {
  label: string;
  value: number;
  suffix: string;
  index: number;
}) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal rounded-[24px] border border-cream/10 bg-cream/[0.04] p-8 lg:p-10"
      style={{ transitionDelay: `${index * 55}ms` }}
    >
      <div className="label-eyebrow mb-6">{label}</div>
      <Counter value={value} suffix={suffix} />
    </div>
  );
};

const BarRow = ({ label, value }: { label: string; value: number }) => (
  <div className="border-t border-cream/10 py-4 first:border-t-0 first:pt-0">
    <div className="mb-2 flex items-baseline justify-between">
      <span className="font-sans text-sm text-cream/90">{label}</span>
      <span className="label-eyebrow text-bronze">{value}%</span>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-cream/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-bronze to-bronze-deep transition-all duration-700 ease-out"
        style={{ width: `${value}%` }}
      />
    </div>
  </div>
);

type MetricItem = {
  label: string;
  value: number;
  suffix: string;
};

type AudienceItem = {
  label: string;
  value: number;
};

type SocialMetricsResponse = {
  metrics?: MetricItem[];
  topCountries?: AudienceItem[];
  audienceBreakdown?: AudienceItem[];
  updatedAt?: string;
  mediaKitUrl?: string;
  source?: string;
};

export const Metrics = () => {
  const [liveMetrics, setLiveMetrics] = useState<MetricItem[] | null>(null);
  const [liveCountries, setLiveCountries] = useState<AudienceItem[] | null>(null);
  const [liveAudienceBreakdown, setLiveAudienceBreakdown] = useState<AudienceItem[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState(publicMetricsMethodology.capturedAt);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const { data, error } = await supabase.functions.invoke<SocialMetricsResponse>(
          instagramProfile.supabaseFunctionName,
          {
            body: {
              slug: instagramProfile.handle,
              mediaKitUrl: instagramProfile.mediaKitUrl,
              profileInfoUrl: instagramProfile.profileInfoUrl,
              language: currentLanguage,
            },
          },
        );

        if (error) throw error;
        if (data?.metrics?.length) setLiveMetrics(data.metrics);
        if (data?.topCountries?.length) setLiveCountries(data.topCountries);
        if (data?.audienceBreakdown?.length) setLiveAudienceBreakdown(data.audienceBreakdown);
        if (data?.updatedAt) setUpdatedAt(data.updatedAt);
      } catch (error) {
        console.warn("Unable to refresh metrics. Using embedded snapshot.", error);
      }
    };

    void loadMetrics();
  }, []);

  const displayedMetrics = liveMetrics ?? fallbackMetrics;
  const displayedCountries = liveCountries ?? topCountries;
  const displayedAudienceBreakdown = liveAudienceBreakdown ?? languages;

  return (
    <section id="metrics" className="page-section pt-8 md:pt-10">
      <div className="container-editorial">
        <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
          <SectionHeader
            eyebrow={uiCopy.sections.metricsEyebrow}
            title={uiCopy.sections.metricsTitle}
            description={uiCopy.sections.metricsBody}
          />

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedMetrics.map((m, i) => (
              <MetricCard key={m.label} {...m} index={i} />
            ))}
          </div>

          <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="glass-panel-soft rounded-[28px] p-6 md:p-8">
              <div className="label-eyebrow mb-3 text-bronze">{uiCopy.sections.audienceCountries}</div>
              <h3 className="mb-2 font-serif text-2xl text-cream md:text-3xl">{uiCopy.sections.audienceCountriesTitle}</h3>
              <div className="mt-6">
                {displayedCountries.map((c) => (
                  <BarRow key={c.label} {...c} />
                ))}
              </div>
            </div>
            <div className="glass-panel-soft rounded-[28px] p-6 md:p-8">
              <div className="label-eyebrow mb-3 text-bronze">{uiCopy.sections.audienceSplit}</div>
              <h3 className="mb-2 font-serif text-2xl text-cream md:text-3xl">{uiCopy.sections.audienceSplitTitle}</h3>
              <div className="mt-6">
                {displayedAudienceBreakdown.map((l) => (
                  <BarRow key={l.label} {...l} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-14">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="label-eyebrow mb-2 text-bronze">{uiCopy.sections.highlights}</div>
                <h3 className="font-serif text-2xl text-cream md:text-3xl">{uiCopy.sections.topPosts}</h3>
              </div>
              <span className="hidden font-sans text-xs text-muted-foreground md:block">
                Updated {new Date(updatedAt).toLocaleDateString("en-GB")}
              </span>
            </div>
            <div className="glass-panel-soft rounded-[28px] p-6 font-sans text-sm leading-relaxed text-muted-foreground md:p-8">
              {uiCopy.sections.metricsNote}
            </div>
            <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="max-w-3xl font-sans text-xs leading-relaxed text-muted-foreground">
                {uiCopy.sections.metricsMethod}
              </p>
              <Button
                asChild
                className="h-12 rounded-full border border-cream/15 bg-cream/[0.08] px-6 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-cream hover:bg-cream/[0.12]"
              >
                <a href={instagramProfile.mediaKitUrl} target="_blank" rel="noopener noreferrer">
                  {uiCopy.actions.mediaKit}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
