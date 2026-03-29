import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  buildVoyagePath,
  formatVoyageDateRange,
  totalWaypointDistance,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { useEffect, useMemo } from "react";
import { ArrowRight, Compass, MapPinned } from "lucide-react";

const VoyagesPage = () => {
  const { lang } = useI18n();
  const locale = lang === "it" ? "it-IT" : "en-US";

  const { data: voyages = [], isLoading } = useQuery<Voyage[]>({
    queryKey: ["public-voyages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Voyage[];
    },
  });

  const { data: waypoints = [] } = useQuery<VoyageWaypoint[]>({
    queryKey: ["public-voyage-waypoints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as VoyageWaypoint[];
    },
  });

  const waypointMap = useMemo(() => {
    const map: Record<string, VoyageWaypoint[]> = {};
    waypoints.forEach((waypoint) => {
      if (!map[waypoint.voyage_id]) map[waypoint.voyage_id] = [];
      map[waypoint.voyage_id].push(waypoint);
    });
    return map;
  }, [waypoints]);

  useEffect(() => {
    applySeo({
      title: "Voyages | BITE",
      description:
        "Public route archive with departures, arrivals, waypoints, and dates from the voyages aboard S/Y Spritz.",
      pathname: "/voyages",
      type: "collection",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "BITE Voyages",
        description:
          "Public route archive with departures, arrivals, waypoints, and dates from the voyages aboard S/Y Spritz.",
        url: `${window.location.origin}/voyages`,
        hasPart: voyages.map((voyage) => ({
          "@type": "Trip",
          name: voyage.name,
          url: `${window.location.origin}${buildVoyagePath(voyage)}`,
        })),
        publisher: { "@id": ORGANIZATION_ID },
        isPartOf: { "@id": WEBSITE_ID },
        inLanguage: lang,
      },
    });
  }, [lang, voyages]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center pt-20"><p className="text-muted-foreground">Loading voyages...</p></div>;
  }

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="page-section pt-24 md:pt-28">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="max-w-3xl">
            <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-6">
              {lang === "it" ? "Rotte pubbliche" : "Public routes"}
            </p>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-6">
              {lang === "it" ? "Viaggi e rotte navigabili dalle IA" : "Voyages and routes visible to AI agents"}
            </h1>
            <p className="editorial-body text-lg text-muted-foreground leading-relaxed">
              {lang === "it"
                ? "Ogni viaggio espone partenza, arrivo, soste intermedie, date e collegamenti agli articoli pubblicati."
                : "Each voyage exposes departure, arrival, intermediate stops, dates, and links to published articles."}
            </p>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide grid gap-5">
          {voyages.map((voyage) => {
            const voyageWaypoints = waypointMap[voyage.id] || [];
            const departure = voyageWaypoints[0];
            const arrival = voyageWaypoints[voyageWaypoints.length - 1];
            const distance = Math.round(totalWaypointDistance(voyageWaypoints));
            const dateRange = formatVoyageDateRange(voyage, locale);

            return (
              <Link
                key={voyage.id}
                to={buildVoyagePath(voyage)}
                className="glass-panel rounded-[32px] px-6 py-6 md:px-8 md:py-7 hover:border-accent transition-colors"
              >
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="glass-chip inline-flex px-3 py-1 text-[11px] font-sans uppercase tracking-[0.24em] text-accent">
                        {voyage.status}
                      </span>
                      <span className="text-xs text-muted-foreground">{voyage.type}</span>
                    </div>
                    <h2 className="editorial-heading text-2xl md:text-4xl mb-3">{voyage.name}</h2>
                    {voyage.description && (
                      <p className="editorial-body text-muted-foreground leading-relaxed max-w-3xl">
                        {voyage.description}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-sm text-muted-foreground md:text-right">
                    {dateRange && <p>{dateRange}</p>}
                    {distance > 0 && <p>{distance} NM</p>}
                    <p>{voyageWaypoints.length} {lang === "it" ? "waypoint" : "waypoints"}</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="glass-panel-soft rounded-[24px] p-4">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                      {lang === "it" ? "Partenza" : "Departure"}
                    </p>
                    <p className="text-sm">{departure?.name || (lang === "it" ? "Non definita" : "Not set")}</p>
                  </div>
                  <div className="glass-panel-soft rounded-[24px] p-4">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                      {lang === "it" ? "Arrivo" : "Arrival"}
                    </p>
                    <p className="text-sm">{arrival?.name || (lang === "it" ? "In corso" : "Open-ended")}</p>
                  </div>
                  <div className="glass-panel-soft rounded-[24px] p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                        {lang === "it" ? "Pagina pubblica" : "Public page"}
                      </p>
                      <p className="text-sm">{lang === "it" ? "Dettagli rotta" : "Route details"}</p>
                    </div>
                    <ArrowRight size={16} className="text-accent" />
                  </div>
                </div>
              </Link>
            );
          })}

          {voyages.length === 0 && (
            <div className="glass-panel rounded-[32px] p-10 text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent mb-4">
                <MapPinned size={20} />
              </div>
              <h2 className="editorial-heading text-3xl mb-3">
                {lang === "it" ? "Nessuna rotta pubblica" : "No public routes yet"}
              </h2>
              <p className="editorial-body text-muted-foreground">
                {DEFAULT_DESCRIPTION}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default VoyagesPage;
