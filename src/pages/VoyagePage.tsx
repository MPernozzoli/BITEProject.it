import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  buildVoyagePath,
  formatIsoDate,
  formatVoyageDateRange,
  formatWaypointCoordinateLabel,
  getVoyageIdFromRouteParam,
  totalWaypointDistance,
  type GeoArticle,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { ArrowLeft, MapPinned, Navigation } from "lucide-react";

const VoyagePage = () => {
  const { voyageRef } = useParams();
  const voyageId = getVoyageIdFromRouteParam(voyageRef);
  const { lang } = useI18n();
  const locale = lang === "it" ? "it-IT" : "en-US";

  const { data: voyage, isLoading } = useQuery<Voyage | null>({
    queryKey: ["voyage", voyageId],
    enabled: Boolean(voyageId),
    queryFn: async () => {
      const { data, error } = await supabase.from("voyages" as any).select("*").eq("id", voyageId).maybeSingle();
      if (error) throw error;
      return (data || null) as Voyage | null;
    },
  });

  const { data: waypoints = [] } = useQuery<VoyageWaypoint[]>({
    queryKey: ["voyage-waypoints", voyageId],
    enabled: Boolean(voyageId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .eq("voyage_id", voyageId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as VoyageWaypoint[];
    },
  });

  const { data: articles = [] } = useQuery<GeoArticle[]>({
    queryKey: ["voyage-articles", voyageId],
    enabled: Boolean(voyageId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, location_name")
        .eq("status", "published")
        .eq("voyage_id", voyageId)
        .order("published_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as GeoArticle[];
    },
  });

  const departure = waypoints[0];
  const arrival = waypoints[waypoints.length - 1];
  const totalNm = useMemo(() => Math.round(totalWaypointDistance(waypoints)), [waypoints]);
  const canonicalPath = voyage ? buildVoyagePath(voyage) : voyageId ? `/voyages/${voyageId}` : "/voyages";

  useEffect(() => {
    if (!voyage) return;

    const description = voyage.description?.trim()
      || (lang === "it"
        ? `Rotta ${voyage.name} con partenza da ${departure?.name || "punto iniziale"}, arrivo a ${arrival?.name || "punto finale"} e ${waypoints.length} waypoint pubblici.`
        : `Route ${voyage.name} with departure from ${departure?.name || "starting point"}, arrival at ${arrival?.name || "final point"}, and ${waypoints.length} public waypoints.`);

    applySeo({
      title: `${voyage.name} | Routes | BITE`,
      description,
      pathname: canonicalPath,
      type: "collection",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "Trip",
        name: voyage.name,
        description,
        url: `${window.location.origin}${canonicalPath}`,
        itinerary: waypoints.map((waypoint, index) => ({
          "@type": "Place",
          name: waypoint.name || `Waypoint ${index + 1}`,
          geo: {
            "@type": "GeoCoordinates",
            latitude: waypoint.lat,
            longitude: waypoint.lng,
          },
          arrivalTime: waypoint.date_end || undefined,
          departureTime: waypoint.date_start || undefined,
        })),
        departureTime: departure?.date_start || voyage.start_date || undefined,
        arrivalTime: arrival?.date_end || voyage.end_date || undefined,
        subjectOf: articles.map((article) => ({
          "@type": "Article",
          headline: lang === "it" ? article.title_it || article.title_en : article.title_en,
          url: `${window.location.origin}/logbook/${article.slug}`,
        })),
        provider: { "@id": ORGANIZATION_ID },
        isPartOf: { "@id": WEBSITE_ID },
        inLanguage: lang,
      },
    });
  }, [arrival, articles, canonicalPath, departure, lang, voyage, waypoints]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center pt-20"><p className="text-muted-foreground">Loading route...</p></div>;
  }

  if (!voyage) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Route not found.</p>
          <Link to="/voyages" className="text-accent hover:text-foreground transition-colors text-sm">
            ← Back to Voyages
          </Link>
        </div>
      </div>
    );
  }

  const dateRange = formatVoyageDateRange(voyage, locale);
  const description = voyage.description?.trim() || DEFAULT_DESCRIPTION;

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="page-section pt-24 md:pt-28">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <Link to="/voyages" className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft size={14} /> {lang === "it" ? "Torna alle rotte" : "Back to voyages"}
          </Link>
          <div className="max-w-4xl">
            <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-6">
              {lang === "it" ? "Rotta pubblica" : "Public route"}
            </p>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-6">{voyage.name}</h1>
            <p className="editorial-body text-lg text-muted-foreground leading-relaxed mb-8">{description}</p>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Partenza" : "Departure"}</p>
                <p className="text-sm">{departure?.name || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Arrivo" : "Arrival"}</p>
                <p className="text-sm">{arrival?.name || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Periodo" : "Dates"}</p>
                <p className="text-sm">{dateRange || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Distanza" : "Distance"}</p>
                <p className="text-sm">{totalNm > 0 ? `${totalNm} NM` : "-"}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="glass-panel rounded-[34px] p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Navigation size={18} />
              </div>
              <div>
                <h2 className="editorial-heading text-2xl md:text-3xl">{lang === "it" ? "Waypoint" : "Waypoints"}</h2>
                <p className="text-sm text-muted-foreground">{waypoints.length} {lang === "it" ? "tappe pubbliche" : "public stops"}</p>
              </div>
            </div>
            <div className="space-y-4">
              {waypoints.map((waypoint, index) => (
                <article key={waypoint.id} className="glass-panel-soft rounded-[26px] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-accent mb-2">
                        {index === 0 ? (lang === "it" ? "Partenza" : "Departure") : index === waypoints.length - 1 ? (lang === "it" ? "Arrivo" : "Arrival") : `${lang === "it" ? "Sosta" : "Stop"} ${index + 1}`}
                      </p>
                      <h3 className="editorial-heading text-xl mb-2">{waypoint.name || `${lang === "it" ? "Waypoint" : "Waypoint"} ${index + 1}`}</h3>
                      <p className="text-sm text-muted-foreground">{formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {waypoint.date_start && <p>{lang === "it" ? "Da" : "From"} {formatIsoDate(waypoint.date_start, locale)}</p>}
                      {waypoint.date_end && <p>{lang === "it" ? "A" : "To"} {formatIsoDate(waypoint.date_end, locale)}</p>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[34px] p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <MapPinned size={18} />
              </div>
              <div>
                <h2 className="editorial-heading text-2xl md:text-3xl">{lang === "it" ? "Articoli collegati" : "Related articles"}</h2>
                <p className="text-sm text-muted-foreground">
                  {lang === "it"
                    ? "Contenuti pubblicati riferiti a questa rotta."
                    : "Published content tied to this route."}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {articles.map((article) => (
                <Link key={article.id} to={`/logbook/${article.slug}`} className="block glass-panel-soft rounded-[24px] p-4 hover:border-accent transition-colors">
                  <h3 className="editorial-heading text-lg mb-2">
                    {lang === "it" ? article.title_it || article.title_en : article.title_en}
                  </h3>
                  {(lang === "it" ? article.excerpt_it || article.excerpt_en : article.excerpt_en) && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {lang === "it" ? article.excerpt_it || article.excerpt_en : article.excerpt_en}
                    </p>
                  )}
                </Link>
              ))}
              {articles.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {lang === "it"
                    ? "Nessun articolo è ancora collegato a questa rotta."
                    : "No articles are linked to this route yet."}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default VoyagePage;
