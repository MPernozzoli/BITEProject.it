import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import {
  buildVoyagePath,
  formatVoyageDateRange,
  getLocalizedVoyageDescription,
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  totalWaypointDistance,
  type GeoArticle,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { useEffect, useMemo } from "react";
import { ArrowRight, MapPinned } from "lucide-react";

const VoyagesPage = () => {
  const { lang } = useI18n();
  const locale = lang === "it" ? "it-IT" : "en-US";
  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();

  const { data: liveVoyages = [], isLoading: isLiveVoyagesLoading } = useQuery<Voyage[]>({
    queryKey: ["public-voyages"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Voyage[];
    },
  });
  const voyages = publicContent?.voyages ?? liveVoyages;
  const isLoading = !publicContent && (isPublicContentLoading || isLiveVoyagesLoading);

  const { data: liveWaypoints = [] } = useQuery<VoyageWaypoint[]>({
    queryKey: ["public-voyage-waypoints"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });
  const waypoints = publicContent?.voyageWaypoints ?? liveWaypoints;

  const { data: liveArticleLinks = [] } = useQuery<Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[]>({
    queryKey: ["public-voyage-article-links"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("voyage_id, voyage_segment_start, voyage_segment_end")
        .eq("status", "published")
        .not("voyage_id", "is", null);
      if (error) throw error;
      return (data || []) as Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[];
    },
  });
  const articleLinks = useMemo(() => {
    if (!publicContent) return liveArticleLinks;

    return publicContent.articles
      .filter((article) => article.voyage_id)
      .map((article) => ({
        voyage_id: article.voyage_id,
        voyage_segment_start: article.voyage_segment_start,
        voyage_segment_end: article.voyage_segment_end,
      }));
  }, [liveArticleLinks, publicContent]);

  const waypointMap = useMemo(() => {
    const map: Record<string, VoyageWaypoint[]> = {};
    waypoints.forEach((waypoint) => {
      if (!map[waypoint.voyage_id]) map[waypoint.voyage_id] = [];
      map[waypoint.voyage_id].push(waypoint);
    });
    return map;
  }, [waypoints]);

  const articleLinkMap = useMemo(() => {
    const map: Record<string, Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[]> = {};
    articleLinks.forEach((article) => {
      if (!article.voyage_id) return;
      if (!map[article.voyage_id]) map[article.voyage_id] = [];
      map[article.voyage_id].push(article);
    });
    return map;
  }, [articleLinks]);

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
          name: getLocalizedVoyageName(voyage, lang),
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
            const publicWaypoints = getPublicVoyageWaypoints(voyageWaypoints, articleLinkMap[voyage.id] || [], voyage.id);
            const departure = publicWaypoints[0];
            const arrival = publicWaypoints[publicWaypoints.length - 1];
            const departureIndex = departure ? voyageWaypoints.findIndex((item) => item.id === departure.id) : -1;
            const arrivalIndex = arrival ? voyageWaypoints.findIndex((item) => item.id === arrival.id) : -1;
            const distance = Math.round(totalWaypointDistance(voyageWaypoints));
            const dateRange = formatVoyageDateRange(voyage, locale);
            const voyageName = getLocalizedVoyageName(voyage, lang);
            const voyageDescription = getLocalizedVoyageDescription(voyage, lang);

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
                    <h2 className="editorial-heading text-2xl md:text-4xl mb-3">{voyageName}</h2>
                    {voyageDescription && (
                      <p className="editorial-body text-muted-foreground leading-relaxed max-w-3xl">
                        {voyageDescription}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-sm text-muted-foreground md:text-right">
                    {dateRange && <p>{dateRange}</p>}
                    {distance > 0 && <p>{distance} NM</p>}
                    <p>{publicWaypoints.length} {lang === "it" ? "waypoint pubblici" : "public waypoints"}</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="glass-panel-soft rounded-[24px] p-4">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                      {lang === "it" ? "Partenza" : "Departure"}
                    </p>
                    <p className="text-sm">
                      {departure
                        ? getLocalizedWaypointName(departure, lang, departureIndex >= 0 ? departureIndex : 0)
                        : (lang === "it" ? "Non definita" : "Not set")}
                    </p>
                  </div>
                  <div className="glass-panel-soft rounded-[24px] p-4">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                      {lang === "it" ? "Arrivo" : "Arrival"}
                    </p>
                    <p className="text-sm">
                      {arrival
                        ? getLocalizedWaypointName(arrival, lang, arrivalIndex >= 0 ? arrivalIndex : publicWaypoints.length - 1)
                        : (lang === "it" ? "In corso" : "Open-ended")}
                    </p>
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
