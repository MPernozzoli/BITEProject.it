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
  normalizeWaypointMedia,
  totalCoordinateDistanceKm,
  totalWaypointDistance,
  type GeoArticle,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import { applySeo, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { useEffect, useMemo } from "react";
import { ArrowRight, Compass, Mountain, Ship } from "lucide-react";

const getVoyageStatusLabel = (status: Voyage["status"], lang: "it" | "en") => {
  if (lang === "it") {
    if (status === "planned") return "In programma";
    if (status === "active") return "In corso";
    return "Completato";
  }
  if (status === "planned") return "Upcoming";
  if (status === "active") return "Underway";
  return "Completed";
};

const getVoyageStatusPillClassName = (status: Voyage["status"]) => {
  if (status === "planned") return "border border-dashed border-slate-300/80 bg-slate-50/65 text-slate-600";
  if (status === "active") return "border border-sky-300/75 bg-sky-50/75 text-sky-800";
  return "border border-emerald-300/70 bg-emerald-50/70 text-emerald-800";
};

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
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Voyage[];
    },
  });
  const voyages = publicContent?.voyages ?? liveVoyages;
  const isLoading = !publicContent && (isPublicContentLoading || isLiveVoyagesLoading);

  const { data: liveWaypoints = [] } = useQuery<VoyageWaypoint[]>({
    queryKey: ["public-voyage-waypoints"],
    enabled: !publicContent && !isPublicContentLoading && liveVoyages.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .in("voyage_id", liveVoyages.map((voyage) => voyage.id))
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });
  const waypoints = publicContent?.voyageWaypoints ?? liveWaypoints;

  const { data: liveArticleLinks = [] } = useQuery<
    Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end" | "voyage_waypoint_start_id" | "voyage_waypoint_end_id">[]
  >({
    queryKey: ["public-voyage-article-links"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("voyage_id, voyage_segment_start, voyage_segment_end, voyage_waypoint_start_id, voyage_waypoint_end_id")
        .eq("status", "published")
        .not("voyage_id", "is", null);
      if (error) throw error;
      return (data || []) as Pick<
        GeoArticle,
        "voyage_id" | "voyage_segment_start" | "voyage_segment_end" | "voyage_waypoint_start_id" | "voyage_waypoint_end_id"
      >[];
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
        voyage_waypoint_start_id: article.voyage_waypoint_start_id,
        voyage_waypoint_end_id: article.voyage_waypoint_end_id,
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
    const map: Record<
      string,
      Pick<
        GeoArticle,
        | "voyage_id"
        | "voyage_segment_start"
        | "voyage_segment_end"
        | "voyage_waypoint_start_id"
        | "voyage_waypoint_end_id"
      >[]
    > = {};
    articleLinks.forEach((article) => {
      if (!article.voyage_id) return;
      if (!map[article.voyage_id]) map[article.voyage_id] = [];
      map[article.voyage_id].push(article);
    });
    return map;
  }, [articleLinks]);

  useEffect(() => {
    const description = lang === "it"
      ? "Tutte le rotte navigate da Spritz: partenze, arrivi, tappe e i racconti di ogni viaggio, in mare e in camper."
      : "Every route Spritz has sailed or driven: departures, arrivals, stops, and the stories behind each journey.";

    applySeo({
      title: lang === "it" ? "Le nostre rotte | BITE" : "Our routes | BITE",
      description,
      pathname: "/voyages",
      type: "collection",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "BITE Voyages",
        description,
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
              {lang === "it" ? "Le nostre rotte" : "Our routes"}
            </p>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-6">
              {lang === "it" ? "Ogni rotta racconta un pezzo di viaggio" : "Every route tells a piece of the journey"}
            </h1>
            <p className="editorial-body text-lg text-muted-foreground leading-relaxed">
              {lang === "it"
                ? "Dalla prima traversata in Grecia fino all'Atlantico: qui trovi tutte le rotte di Spritz, con partenze, arrivi, tappe e i racconti di ogni viaggio."
                : "From our first crossing in Greece to the Atlantic: every route Spritz has sailed, with departures, arrivals, stops, and the stories behind each journey."}
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
            const routeDistance = voyage.type === "land"
              ? (() => {
                  const coordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
                  const distanceKm = Array.isArray(coordinates) && coordinates.length >= 2 ? totalCoordinateDistanceKm(coordinates) : 0;
                  return distanceKm > 0 ? { value: Math.round(distanceKm), unit: "KM" as const } : null;
                })()
              : (() => {
                  const distanceNm = Math.round(totalWaypointDistance(voyageWaypoints));
                  return distanceNm > 0 ? { value: distanceNm, unit: "NM" as const } : null;
                })();
            const dateRange = formatVoyageDateRange(voyage, locale);
            const voyageName = getLocalizedVoyageName(voyage, lang);
            const voyageDescription = getLocalizedVoyageDescription(voyage, lang);
            const isWater = voyage.type === "water";
            const TypeIcon = isWater ? Ship : Mountain;
            const coverImage = (() => {
              const articleCover = (publicContent?.articles ?? [])
                .find((article) => article.voyage_id === voyage.id && article.cover_image)?.cover_image;
              if (articleCover) return articleCover;
              for (const waypoint of voyageWaypoints) {
                const image = normalizeWaypointMedia(waypoint.media).find((item) => item.kind === "image");
                if (image) return image.url;
              }
              return null;
            })();

            return (
              <Link
                key={voyage.id}
                to={buildVoyagePath(voyage)}
                className="group glass-panel rounded-[32px] px-6 py-6 md:px-8 md:py-7 hover:border-accent transition-colors"
              >
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  {coverImage && (
                    <div className="h-40 w-full shrink-0 overflow-hidden rounded-[24px] bg-muted md:h-32 md:w-44">
                      <img
                        src={coverImage}
                        alt={voyageName}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-sans uppercase tracking-[0.2em] ${getVoyageStatusPillClassName(voyage.status)}`}>
                        {getVoyageStatusLabel(voyage.status, lang)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <TypeIcon size={13} className={isWater ? "text-sky-600" : "text-orange-600"} />
                        {isWater ? (lang === "it" ? "Via mare" : "By sea") : (lang === "it" ? "Via terra" : "By land")}
                      </span>
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
                    {routeDistance && <p>{routeDistance.value} {routeDistance.unit}</p>}
                    <p>{publicWaypoints.length} {lang === "it" ? "tappe" : "stops"}</p>
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
                        : (lang === "it" ? "Da definire" : "To be announced")}
                    </p>
                  </div>
                  <div className="glass-panel-soft rounded-[24px] p-4">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                      {lang === "it" ? "Arrivo" : "Arrival"}
                    </p>
                    <p className="text-sm">
                      {arrival
                        ? getLocalizedWaypointName(arrival, lang, arrivalIndex >= 0 ? arrivalIndex : publicWaypoints.length - 1)
                        : (lang === "it" ? "Ancora in viaggio" : "Still going")}
                    </p>
                  </div>
                  <div className="glass-panel-soft rounded-[24px] p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                        {lang === "it" ? "Racconto completo" : "Full story"}
                      </p>
                      <p className="text-sm">{lang === "it" ? "Scopri il viaggio" : "See the journey"}</p>
                    </div>
                    <ArrowRight size={16} className="text-accent transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}

          {voyages.length === 0 && (
            <div className="glass-panel rounded-[32px] p-10 text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent mb-4">
                <Compass size={20} />
              </div>
              <h2 className="editorial-heading text-3xl mb-3">
                {lang === "it" ? "Nessuna rotta ancora pubblicata" : "No routes published yet"}
              </h2>
              <p className="editorial-body text-muted-foreground">
                {lang === "it"
                  ? "Torna presto per scoprire i prossimi viaggi di Spritz."
                  : "Check back soon to discover Spritz's next journeys."}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default VoyagesPage;
