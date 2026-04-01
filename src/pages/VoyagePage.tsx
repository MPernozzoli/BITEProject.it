import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import {
  buildVoyagePath,
  formatWaypointMoment,
  formatVoyageDateRange,
  formatWaypointCoordinateLabel,
  getAssociatedArticleForWaypoint,
  getLocalizedVoyageDescription,
  getLocalizedVoyageName,
  getLocalizedWaypointDescription,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  getVoyageIdFromRouteParam,
  normalizeWaypointMedia,
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
  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();

  const snapshotVoyage = useMemo(
    () => publicContent?.voyages.find((entry) => entry.id === voyageId) ?? null,
    [publicContent, voyageId]
  );
  const snapshotWaypoints = useMemo(
    () => publicContent?.voyageWaypoints.filter((entry) => entry.voyage_id === voyageId) ?? null,
    [publicContent, voyageId]
  );
  const snapshotArticles = useMemo(
    () => publicContent?.articles.filter((entry) => entry.voyage_id === voyageId) ?? null,
    [publicContent, voyageId]
  );

  const { data: liveVoyage, isLoading: isLiveVoyageLoading } = useQuery<Voyage | null>({
    queryKey: ["voyage", voyageId],
    enabled: Boolean(voyageId) && !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase.from("voyages").select("*").eq("id", voyageId).eq("is_published", true).maybeSingle();
      if (error) throw error;
      return (data || null) as Voyage | null;
    },
  });
  const voyage = snapshotVoyage ?? liveVoyage;
  const isLoading = !publicContent && (isPublicContentLoading || isLiveVoyageLoading);

  const { data: liveWaypoints = [] } = useQuery<VoyageWaypoint[]>({
    queryKey: ["voyage-waypoints", voyageId],
    enabled: Boolean(voyage?.id) && !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .eq("voyage_id", voyage!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });
  const waypoints = snapshotWaypoints ?? liveWaypoints;

  const { data: liveArticles = [] } = useQuery<GeoArticle[]>({
    queryKey: ["voyage-articles", voyageId],
    enabled: Boolean(voyage?.id) && !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, location_name")
        .eq("status", "published")
        .eq("voyage_id", voyage!.id)
        .order("published_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as GeoArticle[];
    },
  });
  const articles = snapshotArticles ?? liveArticles;

  const publicWaypoints = useMemo(
    () => getPublicVoyageWaypoints(waypoints, articles, voyageId),
    [articles, voyageId, waypoints]
  );
  const publicWaypointEntries = useMemo(
    () =>
      publicWaypoints.map((waypoint, publicIndex) => {
        const matchedIndex = waypoints.findIndex((item) => item.id === waypoint.id);
        const originalIndex = matchedIndex >= 0 ? matchedIndex : publicIndex;
        return {
          waypoint,
          originalIndex,
          article: getAssociatedArticleForWaypoint(articles, voyageId, originalIndex),
        };
      }),
    [articles, publicWaypoints, voyageId, waypoints]
  );
  const departureEntry = publicWaypointEntries[0];
  const arrivalEntry = publicWaypointEntries[publicWaypointEntries.length - 1];
  const departure = departureEntry?.waypoint;
  const arrival = arrivalEntry?.waypoint;
  const totalNm = useMemo(() => Math.round(totalWaypointDistance(waypoints)), [waypoints]);
  const canonicalPath = voyage ? buildVoyagePath(voyage) : voyageId ? `/voyages/${voyageId}` : "/voyages";
  const departureLabel = departureEntry
    ? getLocalizedWaypointName(departureEntry.waypoint, lang, departureEntry.originalIndex)
    : null;
  const arrivalLabel = arrivalEntry
    ? getLocalizedWaypointName(arrivalEntry.waypoint, lang, arrivalEntry.originalIndex)
    : null;
  const voyageName = voyage ? getLocalizedVoyageName(voyage, lang) : null;
  const voyageDescription = voyage ? getLocalizedVoyageDescription(voyage, lang) : null;

  useEffect(() => {
    if (!voyage) return;

    const description = voyageDescription
      || (lang === "it"
        ? `Rotta ${voyageName || "senza nome"} con partenza da ${departureLabel || "punto iniziale"}, arrivo a ${arrivalLabel || "punto finale"} e ${publicWaypoints.length} waypoint pubblici.`
        : `Route ${voyageName || "untitled route"} with departure from ${departureLabel || "starting point"}, arrival at ${arrivalLabel || "final point"}, and ${publicWaypoints.length} public waypoints.`);

    applySeo({
      title: `${voyageName || voyage.name} | Routes | BITE`,
      description,
      pathname: canonicalPath,
      type: "collection",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "Trip",
        name: voyageName || voyage.name,
        description,
        url: `${window.location.origin}${canonicalPath}`,
        itinerary: publicWaypointEntries.map(({ waypoint, originalIndex }) => ({
          "@type": "Place",
          name: getLocalizedWaypointName(waypoint, lang, originalIndex),
          geo: {
            "@type": "GeoCoordinates",
            latitude: waypoint.lat,
            longitude: waypoint.lng,
          },
          arrivalTime: waypoint.event_date ? [waypoint.event_date, waypoint.event_time].filter(Boolean).join("T") : waypoint.date_end || undefined,
          departureTime: waypoint.event_date ? [waypoint.event_date, waypoint.event_time].filter(Boolean).join("T") : waypoint.date_start || undefined,
        })),
        departureTime: departure?.event_date || departure?.date_start || voyage.start_date || undefined,
        arrivalTime: arrival?.event_date || arrival?.date_end || voyage.end_date || undefined,
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
  }, [arrival, arrivalLabel, articles, canonicalPath, departure, departureLabel, lang, publicWaypointEntries, publicWaypoints.length, voyage, voyageDescription, voyageName]);

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
  const description = voyageDescription || DEFAULT_DESCRIPTION;

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
            <h1 className="editorial-heading text-4xl md:text-6xl mb-6">{voyageName || voyage.name}</h1>
            <p className="editorial-body text-lg text-muted-foreground leading-relaxed mb-8">{description}</p>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Partenza" : "Departure"}</p>
                <p className="text-sm">{departureLabel || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{lang === "it" ? "Arrivo" : "Arrival"}</p>
                <p className="text-sm">{arrivalLabel || "-"}</p>
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
                <p className="text-sm text-muted-foreground">{publicWaypoints.length} {lang === "it" ? "tappe pubbliche" : "public stops"}</p>
              </div>
            </div>
            <div className="space-y-4">
              {publicWaypointEntries.map(({ waypoint, originalIndex, article }, index) => {
                const waypointName = getLocalizedWaypointName(waypoint, lang, originalIndex);
                const waypointDescription = getLocalizedWaypointDescription(waypoint, lang);
                const mediaItems = normalizeWaypointMedia(waypoint.media);
                const articleTitle = article
                  ? lang === "it"
                    ? article.title_it || article.title_en
                    : article.title_en
                  : null;
                const waypointMoment = formatWaypointMoment(waypoint, locale);

                return (
                  <article key={waypoint.id} className="glass-panel-soft rounded-[26px] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-accent mb-2">
                          {index === 0 ? (lang === "it" ? "Partenza" : "Departure") : index === publicWaypointEntries.length - 1 ? (lang === "it" ? "Arrivo" : "Arrival") : `${lang === "it" ? "Sosta" : "Stop"} ${index + 1}`}
                        </p>
                        <h3 className="editorial-heading text-xl mb-2">{waypointName}</h3>
                        <p className="text-sm text-muted-foreground">{formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground max-w-[220px]">
                        {waypointMoment && <p>{waypointMoment}</p>}
                        {article && (
                          <Link to={`/logbook/${article.slug}`} className="inline-flex mt-2 text-accent hover:text-foreground transition-colors">
                            {lang === "it" ? "Articolo collegato" : "Related article"}: {articleTitle}
                          </Link>
                        )}
                      </div>
                    </div>
                    {waypointDescription && (
                      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                        {waypointDescription}
                      </p>
                    )}
                    {mediaItems.length > 0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {mediaItems.map((mediaItem, mediaIndex) => (
                          <div key={`${waypoint.id}-${mediaIndex}`} className="overflow-hidden rounded-[20px] border border-border/60 bg-background/40">
                            {mediaItem.kind === "image" ? (
                              <img
                                src={mediaItem.url}
                                alt={mediaItem.name || waypointName}
                                className="h-44 w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : mediaItem.kind === "video" ? (
                              <video
                                src={mediaItem.url}
                                controls
                                playsInline
                                preload="metadata"
                                className="h-44 w-full object-cover"
                              />
                            ) : (
                              <a
                                href={mediaItem.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-44 items-center justify-center px-4 text-center text-sm text-accent hover:text-foreground transition-colors"
                              >
                                {mediaItem.name || (lang === "it" ? "Apri allegato" : "Open attachment")}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {publicWaypoints.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {lang === "it"
                    ? "Nessun waypoint pubblico ancora disponibile per questa rotta."
                    : "No public waypoints are available for this route yet."}
                </p>
              )}
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
