import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import {
  bilingualSlugOrFilter,
  buildVoyagePath,
  formatWaypointMoment,
  formatVoyageDateRange,
  formatWaypointCoordinateLabel,
  formatIsoDate,
  formatWaypointStopDuration,
  getAssociatedArticleForWaypoint,
  getLegacyVoyageIdFromRouteParam,
  getLocalizedVoyageDescription,
  getLocalizedVoyageName,
  getLocalizedWaypointDescription,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  normalizeWaypointActivities,
  slugForLang,
  normalizeWaypointAirports,
  normalizeWaypointMedia,
  normalizeWaypointPoi,
  totalCoordinateDistanceKm,
  totalWaypointDistance,
  type GeoArticle,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import { applySeo, withLang, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { formatBookingWindow, isVoyageBookableNow, type BookableLegAvailability } from "@/lib/booking-utils";
import {
  perPersonDepositEur,
  legDepositEur,
  contributionFixedMinimumEur,
  formatDepositEur,
  getContributionExplanation,
  roundUpToNextEuro,
} from "@/lib/booking-deposit";
import ContributionEstimateNote from "@/components/booking/ContributionEstimateNote";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import { buildPhotoPointUrl, type LogbookPhotoPoint } from "@/lib/logbook-photo-points";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import VoyageRouteHeroMap from "@/components/voyage/VoyageRouteHeroMap";
import {
  Activity,
  ArrowLeft,
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  Clock,
  ChevronRight,
  Images,
  Landmark,
  MapPin,
  MapPinned,
  Mountain,
  Navigation,
  Plane,
  Route,
  Ship,
  TicketCheck,
  Users,
  X,
} from "lucide-react";

type ReferencedLeg = {
  id: string;
  planned_nautical_miles: number;
  sort_order: number;
  from?: { name: string | null; name_it: string | null; name_en: string | null } | null;
  to?: { name: string | null; name_it: string | null; name_en: string | null } | null;
};

const referencedLegWaypointName = (
  waypoint: ReferencedLeg["from"] | ReferencedLeg["to"] | undefined,
  lang: "it" | "en",
  fallback: string
) => {
  if (!waypoint) return fallback;
  if (lang === "it") return waypoint.name_it || waypoint.name_en || waypoint.name || fallback;
  return waypoint.name_en || waypoint.name_it || waypoint.name || fallback;
};

type SupabaseRpcResponse<T> = { data: T | null; error: { message?: string } | null };
type SupabaseRpcClient = {
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<SupabaseRpcResponse<T>>;
};
const bookingRpcClient = supabase as unknown as SupabaseRpcClient;

const VoyagePage = () => {
  const { voyageRef } = useParams();
  const location = useLocation();
  const legacyVoyageId = useMemo(() => getLegacyVoyageIdFromRouteParam(voyageRef), [voyageRef]);
  const referencedLegId = useMemo(() => new URLSearchParams(location.search).get("leg"), [location.search]);
  const { lang } = useI18n();
  const locale = lang === "it" ? "it-IT" : "en-US";
  /** Le finestre di tratta usano lo stesso locale del resto del booking (giorno–giorno mese h HH:MM). */
  const bookingWindowLocale = lang === "it" ? "it-IT" : "en-GB";
  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const snapshotVoyage = useMemo(() => {
    if (!publicContent || !voyageRef) return null;
    const bySlug = publicContent.voyages.find(
      (entry) => entry.slug === voyageRef || entry.slug_it === voyageRef || entry.slug_en === voyageRef
    );
    if (bySlug) return bySlug;
    return legacyVoyageId ? publicContent.voyages.find((entry) => entry.id === legacyVoyageId) ?? null : null;
  }, [publicContent, voyageRef, legacyVoyageId]);

  const { data: liveVoyage, isLoading: isLiveVoyageLoading } = useQuery<Voyage | null>({
    queryKey: ["voyage", voyageRef],
    enabled: Boolean(voyageRef) && !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const safeRef = (voyageRef ?? "").trim();
      if (!safeRef) return null;
      const { data, error } = await supabase
        .from("voyages")
        .select("*")
        .or(bilingualSlugOrFilter(safeRef))
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Voyage;
      if (!legacyVoyageId) return null;
      const { data: legacyData, error: legacyError } = await supabase
        .from("voyages")
        .select("*")
        .eq("id", legacyVoyageId)
        .eq("is_published", true)
        .maybeSingle();
      if (legacyError) throw legacyError;
      return (legacyData || null) as Voyage | null;
    },
  });
  const voyage = snapshotVoyage ?? liveVoyage;
  const voyageId = voyage?.id ?? null;
  const isLoading = !publicContent && (isPublicContentLoading || isLiveVoyageLoading);

  const snapshotWaypoints = useMemo(
    () => publicContent?.voyageWaypoints.filter((entry) => entry.voyage_id === voyageId) ?? null,
    [publicContent, voyageId]
  );
  const snapshotArticles = useMemo(
    () => publicContent?.articles.filter((entry) => entry.voyage_id === voyageId) ?? null,
    [publicContent, voyageId]
  );

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
        .select(
          "id, title_en, title_it, slug, cover_image, cover_focal_x, cover_focal_y, cover_zoom, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, voyage_waypoint_start_id, voyage_waypoint_end_id, location_name"
        )
        .eq("status", "published")
        .eq("voyage_id", voyage!.id)
        .order("published_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as GeoArticle[];
    },
  });
  const articles = snapshotArticles ?? liveArticles;

  const { data: photoPoints = [] } = useQuery<LogbookPhotoPoint[]>({
    queryKey: ["voyage-photo-points", voyage?.id],
    enabled: Boolean(voyage?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_photo_points" as never)
        .select("id, voyage_id, taken_at, title_it, title_en, storage_path, is_published, sort_order")
        .eq("voyage_id", voyage!.id)
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LogbookPhotoPoint[];
    },
  });

  const { data: referencedLeg = null } = useQuery<ReferencedLeg | null>({
    queryKey: ["voyage-referenced-leg", referencedLegId, voyageId],
    enabled: Boolean(referencedLegId && voyageId),
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("voyage_bookable_legs")
        .select("id,planned_nautical_miles,sort_order,from:voyage_waypoints!voyage_bookable_legs_from_waypoint_id_fkey(name,name_it,name_en),to:voyage_waypoints!voyage_bookable_legs_to_waypoint_id_fkey(name,name_it,name_en)") as any)
        .eq("id", referencedLegId)
        .eq("voyage_id", voyageId)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as ReferencedLeg | null;
    },
  });

  const { data: bookingLegs = [] } = useQuery<BookableLegAvailability[]>({
    queryKey: ["voyage-leg-availability", voyage?.id],
    enabled: Boolean(voyage?.id) && Boolean(voyage?.booking_enabled),
    queryFn: async () => {
      const { data, error } = await bookingRpcClient.rpc<BookableLegAvailability[]>("get_public_voyage_leg_availability", {
        _voyage_ids: [voyage!.id],
      });
      if (error) {
        console.warn("[VoyagePage] get_public_voyage_leg_availability unavailable", error);
        return [];
      }
      return ((data || []) as BookableLegAvailability[]).sort((a, b) => a.sort_order - b.sort_order);
    },
    staleTime: 1000 * 30,
  });

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
          article: getAssociatedArticleForWaypoint(articles, voyageId, originalIndex, waypoints),
        };
      }),
    [articles, publicWaypoints, voyageId, waypoints]
  );
  const departureEntry = publicWaypointEntries[0];
  const arrivalEntry = publicWaypointEntries[publicWaypointEntries.length - 1];
  const departure = departureEntry?.waypoint;
  const arrival = arrivalEntry?.waypoint;
  const routeDistance = useMemo(() => {
    if (!voyage || waypoints.length < 2) return null;
    if (voyage.type === "land") {
      const coordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
      const distanceKm = Array.isArray(coordinates) && coordinates.length >= 2 ? totalCoordinateDistanceKm(coordinates) : 0;
      return distanceKm > 0 ? { value: Math.round(distanceKm), unit: "KM" as const } : null;
    }
    return { value: Math.round(totalWaypointDistance(waypoints)), unit: "NM" as const };
  }, [voyage, waypoints]);
  const canonicalPath = voyage ? buildVoyagePath(voyage, lang) : "/voyages";
  const departureLabel = departureEntry
    ? getLocalizedWaypointName(departureEntry.waypoint, lang, departureEntry.originalIndex)
    : null;
  const arrivalLabel = arrivalEntry
    ? getLocalizedWaypointName(arrivalEntry.waypoint, lang, arrivalEntry.originalIndex)
    : null;
  const voyageName = voyage ? getLocalizedVoyageName(voyage, lang) : null;
  const voyageDescription = voyage ? getLocalizedVoyageDescription(voyage, lang) : null;

  const heroImage = useMemo(() => {
    const articleCover = articles.find((entry) => entry.cover_image)?.cover_image;
    if (articleCover) return articleCover;
    for (const waypoint of waypoints) {
      const image = normalizeWaypointMedia(waypoint.media).find((item) => item.kind === "image");
      if (image) return image.url;
    }
    return null;
  }, [articles, waypoints]);

  const heroRouteCoordinates = useMemo(() => {
    const geometryCoordinates = (voyage?.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
    if (Array.isArray(geometryCoordinates) && geometryCoordinates.length >= 2) return geometryCoordinates;
    const waypointCoordinates = waypoints
      .filter((waypoint) => Number.isFinite(waypoint.lat) && Number.isFinite(waypoint.lng))
      .map((waypoint): [number, number] => [waypoint.lng, waypoint.lat]);
    return waypointCoordinates.length >= 2 ? waypointCoordinates : null;
  }, [voyage, waypoints]);

  const galleryItems = useMemo(() => {
    const items: { url: string; alt: string }[] = [];
    const seen = new Set<string>();
    publicWaypointEntries.forEach(({ waypoint, originalIndex }) => {
      normalizeWaypointMedia(waypoint.media).forEach((media) => {
        if (media.kind === "image" && !seen.has(media.url)) {
          seen.add(media.url);
          items.push({ url: media.url, alt: media.name || getLocalizedWaypointName(waypoint, lang, originalIndex) });
        }
      });
    });
    articles.forEach((article) => {
      if (article.cover_image && !seen.has(article.cover_image)) {
        seen.add(article.cover_image);
        items.push({
          url: article.cover_image,
          alt: (lang === "it" ? article.title_it || article.title_en : article.title_en) || "",
        });
      }
    });
    photoPoints.forEach((point) => {
      const url = buildPhotoPointUrl(point.storage_path);
      if (!seen.has(url)) {
        seen.add(url);
        items.push({ url, alt: (lang === "it" ? point.title_it || point.title_en : point.title_en) || "" });
      }
    });
    return items;
  }, [publicWaypointEntries, articles, photoPoints, lang]);

  const waypointById = useMemo(() => {
    const map: Record<string, VoyageWaypoint> = {};
    waypoints.forEach((waypoint) => {
      map[waypoint.id] = waypoint;
    });
    return map;
  }, [waypoints]);
  const waypointIndexById = useMemo(() => {
    const map: Record<string, number> = {};
    waypoints.forEach((waypoint, index) => {
      map[waypoint.id] = index;
    });
    return map;
  }, [waypoints]);
  /**
   * Le finestre di una tappa vivono sulle tratte adiacenti: la tratta entrante
   * finisce lì (finestra di arrivo), quella uscente parte da lì (finestra di
   * partenza). Le tratte arrivano già ordinate per sort_order, quindi in caso di
   * waypoint toccato più volte vince la prima.
   */
  const stopLegsByWaypointId = useMemo(() => {
    const map: Record<string, { inbound?: BookableLegAvailability; outbound?: BookableLegAvailability }> = {};
    bookingLegs.forEach((leg) => {
      const arrival = (map[leg.to_waypoint_id] ??= {});
      if (!arrival.inbound) arrival.inbound = leg;
      const departure = (map[leg.from_waypoint_id] ??= {});
      if (!departure.outbound) departure.outbound = leg;
    });
    return map;
  }, [bookingLegs]);

  const legWaypointLabel = (waypointId: string, fallback: string) => {
    const waypoint = waypointById[waypointId];
    if (!waypoint) return fallback;
    return getLocalizedWaypointName(waypoint, lang, waypointIndexById[waypoint.id] ?? 0);
  };

  const voyageIsBookable = voyage ? isVoyageBookableNow(voyage) : false;
  const bookableLegs = useMemo(() => bookingLegs.filter((leg) => leg.is_bookable), [bookingLegs]);
  const hasAvailableLegs = bookingLegs.some((leg) => leg.available);
  const contributionOpts = useMemo(
    () => ({ contributionPerNmEur: voyage?.booking_contribution_per_nm_eur }),
    [voyage?.booking_contribution_per_nm_eur]
  );
  const minLegPriceEur = useMemo(() => {
    if (bookableLegs.length === 0) return null;
    return Math.min(...bookableLegs.map((leg) => perPersonDepositEur([leg], contributionOpts)));
  }, [bookableLegs, contributionOpts]);
  const fullVoyagePriceEur = useMemo(() => {
    if (bookableLegs.length === 0) return null;
    return perPersonDepositEur(bookableLegs, contributionOpts);
  }, [bookableLegs, contributionOpts]);
  const contributionExplanation = useMemo(
    () => getContributionExplanation(bookableLegs, { ...contributionOpts, lang }),
    [bookableLegs, contributionOpts, lang]
  );

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
      image: heroImage || undefined,
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
  }, [arrival, arrivalLabel, articles, canonicalPath, departure, departureLabel, heroImage, lang, publicWaypointEntries, publicWaypoints.length, voyage, voyageDescription, voyageName]);

  const hasScrolledToHashRef = useRef(false);
  useEffect(() => {
    if (isLoading || hasScrolledToHashRef.current || !location.hash) return;
    hasScrolledToHashRef.current = true;

    const headerOffset = 96;
    const align = () => {
      const el = document.getElementById(location.hash.slice(1));
      if (!el) return;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - headerOffset);
    };

    // The sections below the hero (legs, booking panel, linked articles) mount as
    // their own queries resolve, so the target keeps moving for a beat after the
    // voyage itself is ready. Realign a few times, and stop as soon as the reader
    // takes over the scroll.
    align();
    const timers = [150, 400, 900].map((delay) => window.setTimeout(align, delay));
    const stop = () => timers.forEach((timer) => window.clearTimeout(timer));
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchmove", stop, { once: true, passive: true });

    return () => {
      stop();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
    };
  }, [isLoading, location.hash]);

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

  // Legacy `/voyages/<uuid>--<slug>` links and wrong-language slugs land here
  // via the id/legacy fallback above; redirect to the canonical slug URL.
  const canonicalSlug = slugForLang(voyage, lang);
  if (canonicalSlug && voyageRef !== canonicalSlug) {
    return <Navigate to={`${withLang(lang, canonicalPath)}${location.search}${location.hash}`} replace />;
  }

  const dateRange = formatVoyageDateRange(voyage, locale);
  const TypeIcon = voyage.type === "water" ? Ship : Mountain;

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      {/* Hero */}
      <section className="relative">
        <div className={`relative h-[38vh] md:h-[48vh] overflow-hidden ${heroRouteCoordinates || heroImage ? "" : "bg-gradient-to-br from-primary via-primary/85 to-accent/60"}`}>
          {heroRouteCoordinates ? (
            <VoyageRouteHeroMap coordinates={heroRouteCoordinates} className="absolute inset-0" />
          ) : heroImage ? (
            <img src={heroImage} alt={voyageName || voyage.name} className="img-cover" loading="eager" decoding="async" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-24 md:px-8 md:pt-28">
            <Link
              to="/voyages"
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/25 px-4 py-2 text-sm text-white backdrop-blur-md transition-colors hover:bg-black/40"
            >
              <ArrowLeft size={14} /> {lang === "it" ? "Torna alle rotte" : "Back to voyages"}
            </Link>
            {voyageIsBookable && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-500/25 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-md">
                <TicketCheck size={13} />
                {lang === "it" ? "Adesioni aperte" : "Open to join"}
              </span>
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 px-4 pb-10 md:px-8 md:pb-14">
            <div className="page-section-wide mx-auto">
              <p className="glass-chip-dark inline-flex items-center gap-2 px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/90 mb-5">
                <TypeIcon size={13} /> {lang === "it" ? "Rotta pubblica" : "Public route"}
              </p>
              <h1 className="editorial-heading text-4xl md:text-6xl text-white max-w-4xl">{voyageName || voyage.name}</h1>
            </div>
          </div>
        </div>

        {/* Overlapping info card */}
        <div className="page-section-wide relative z-10 -mt-10 px-4 md:-mt-14 md:px-8">
          <div className="glass-panel rounded-[32px] p-6 md:p-8">
            {voyageDescription && (() => {
              const paragraphs = voyageDescription.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
              const [lede, ...rest] = paragraphs;
              return (
                <div className="mb-6 border-l-2 border-accent/30 pl-5">
                  <p className="editorial-body text-[15px] md:text-base text-muted-foreground leading-relaxed">{lede}</p>
                  {rest.length > 0 && (
                    <>
                      {isDescriptionExpanded &&
                        rest.map((paragraph, index) => (
                          <p key={index} className="editorial-body text-[15px] md:text-base text-muted-foreground leading-relaxed mt-3">
                            {paragraph}
                          </p>
                        ))}
                      <button
                        type="button"
                        onClick={() => setIsDescriptionExpanded((expanded) => !expanded)}
                        className="mt-3 inline-flex items-center gap-1 text-[11px] font-sans uppercase tracking-[0.2em] text-accent transition-colors hover:text-accent/80"
                      >
                        {isDescriptionExpanded
                          ? (lang === "it" ? "Mostra meno" : "Show less")
                          : (lang === "it" ? "Leggi il racconto completo" : "Read the full story")}
                        <ChevronDown size={12} className={isDescriptionExpanded ? "rotate-180 transition-transform" : "transition-transform"} />
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                  <Navigation size={12} /> {lang === "it" ? "Partenza" : "Departure"}
                </p>
                <p className="text-sm">{departureLabel || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                  <MapPinned size={12} /> {lang === "it" ? "Arrivo" : "Arrival"}
                </p>
                <p className="text-sm">{arrivalLabel || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                  <CalendarCheck size={12} /> {lang === "it" ? "Periodo" : "Dates"}
                </p>
                <p className="text-sm">{dateRange || "-"}</p>
              </div>
              <div className="glass-panel-soft rounded-[24px] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                  <Route size={12} /> {lang === "it" ? "Distanza" : "Distance"}
                </p>
                <p className="text-sm">{routeDistance ? `${routeDistance.value} ${routeDistance.unit}` : "-"}</p>
              </div>
            </div>
            {referencedLeg && (
              <div className="glass-panel-soft mt-6 rounded-[24px] border-accent/35 p-4">
                <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.24em] text-accent">
                  <Route size={14} />
                  {lang === "it" ? "Tratta referenziata" : "Referenced leg"}
                </p>
                <p className="text-sm text-foreground">
                  {referencedLegWaypointName(referencedLeg.from, lang, lang === "it" ? "Partenza" : "Departure")} → {referencedLegWaypointName(referencedLeg.to, lang, lang === "it" ? "Arrivo" : "Arrival")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {Number(referencedLeg.planned_nautical_miles || 0).toFixed(1)} NM · #{referencedLeg.sort_order + 1}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Booking / participation panel. #partecipa is what /contact links to. */}
      {voyage.booking_enabled && (
        <section id="partecipa" className="page-section pt-0 scroll-mt-24">
          <div className="page-section-wide">
            <div className="glass-panel rounded-[34px] border-emerald-200/60 bg-gradient-to-br from-emerald-50/85 to-white/60 p-6 md:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <TicketCheck size={20} />
                  </span>
                  <div>
                    <h2 className="editorial-heading text-2xl md:text-3xl text-emerald-950">
                      {lang === "it" ? "Partecipa a questo viaggio" : "Join this voyage"}
                    </h2>
                    <p className="mt-1 text-sm text-emerald-900/75 max-w-xl">
                      {bookableLegs.length === 0
                        ? (lang === "it"
                          ? "Le tratte non sono ancora state pubblicate: torna presto per scoprire come imbarcarti."
                          : "Legs haven't been published yet — check back soon to see how to come aboard.")
                        : hasAvailableLegs
                          ? (lang === "it"
                            ? "Scegli una o più tratte e richiedi il tuo posto a bordo."
                            : "Pick one or more legs and request your spot on board.")
                          : (lang === "it"
                            ? "Le tratte esistono, ma al momento non risultano posti disponibili."
                            : "Legs exist, but no seats are currently available.")}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/bookings?voyage=${voyage.id}`}
                  aria-disabled={!hasAvailableLegs}
                  className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-sm transition ${
                    hasAvailableLegs ? "bg-emerald-700 hover:bg-emerald-800" : "pointer-events-none bg-emerald-700/30"
                  }`}
                >
                  <CalendarCheck size={16} />
                  {lang === "it" ? "Richiedi imbarco" : "Request a berth"}
                </Link>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="glass-panel-soft rounded-[22px] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-2">
                    <Users size={12} /> {lang === "it" ? "Posti totali" : "Total berths"}
                  </p>
                  <p className="text-sm">{voyage.booking_max_guests ? voyage.booking_max_guests : "-"}</p>
                </div>
                <div className="glass-panel-soft rounded-[22px] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-2">
                    <Route size={12} /> {lang === "it" ? "A partire da" : "Starting from"}
                  </p>
                  <p className="text-sm">{minLegPriceEur != null ? `${formatDepositEur(minLegPriceEur, lang)} / ${lang === "it" ? "persona" : "person"}` : "-"}</p>
                  {minLegPriceEur != null && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {lang === "it" ? "stima indicativa" : "indicative estimate"}
                    </p>
                  )}
                </div>
                <div className="glass-panel-soft rounded-[22px] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground mb-2">
                    <TicketCheck size={12} /> {lang === "it" ? "Intera rotta" : "Full route"}
                  </p>
                  <p className="text-sm">{fullVoyagePriceEur != null ? `${formatDepositEur(fullVoyagePriceEur, lang)} / ${lang === "it" ? "persona" : "person"}` : "-"}</p>
                  {fullVoyagePriceEur != null && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {lang === "it" ? "stima indicativa" : "indicative estimate"}
                    </p>
                  )}
                </div>
              </div>

              {bookableLegs.length > 0 && (
                <div className="mt-6 space-y-2">
                  {bookableLegs.map((leg) => {
                    const price = roundUpToNextEuro(legDepositEur(leg, contributionOpts));
                    return (
                      <div
                        key={leg.id}
                        className="flex flex-col gap-2 rounded-[18px] border border-emerald-100 bg-white/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-sm text-emerald-950">
                          {legWaypointLabel(leg.from_waypoint_id, lang === "it" ? "Partenza" : "Departure")}
                          {" → "}
                          {legWaypointLabel(leg.to_waypoint_id, lang === "it" ? "Arrivo" : "Arrival")}
                          <span className="ml-2 text-emerald-900/60">
                            {Number(leg.planned_nautical_miles || 0).toFixed(0)} NM
                          </span>
                        </p>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-emerald-900">{formatDepositEur(price, lang)}</span>
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                              leg.available
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {leg.available
                              ? (lang === "it" ? `${leg.remaining} posti liberi` : `${leg.remaining} seats left`)
                              : (lang === "it" ? "Al completo" : "Fully booked")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {bookableLegs.length > 0 && (
                <div className="mt-5 max-w-2xl space-y-1.5 text-xs leading-relaxed text-emerald-900/60">
                  <ContributionEstimateNote lang={lang} className="space-y-1.5" />
                  <p>{contributionExplanation}</p>
                  <p>
                    {lang === "it"
                      ? `* Agli importi indicati sopra va aggiunta una quota fissa una tantum di ${formatDepositEur(contributionFixedMinimumEur(), lang)} a persona, indipendentemente dal numero di tratte scelte.`
                      : `* A one-time fixed contribution of ${formatDepositEur(contributionFixedMinimumEur(), lang)} per person must be added to the amounts above, regardless of how many legs are chosen.`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Stops */}
      <section className="page-section pt-0">
        <div className="page-section-wide">
          <div className="glass-panel rounded-[34px] p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Navigation size={18} />
              </div>
              <div>
                <h2 className="editorial-heading text-2xl md:text-3xl">{lang === "it" ? "Tappe" : "Stops"}</h2>
                <p className="text-sm text-muted-foreground">{publicWaypoints.length} {lang === "it" ? "tappe pubbliche" : "public stops"}</p>
              </div>
            </div>
            <div className="space-y-6">
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
                const poiItems = normalizeWaypointPoi(waypoint.poi);
                const activityItems = normalizeWaypointActivities(waypoint.activities);
                const airportItems = normalizeWaypointAirports(waypoint.nearby_airports);
                const isDeparture = index === 0;
                const isArrival = index === publicWaypointEntries.length - 1;
                const isBookend = isDeparture || isArrival;
                const stopNumber = index;
                const stopLabel = isDeparture
                  ? (lang === "it" ? "Partenza" : "Departure")
                  : isArrival
                    ? (lang === "it" ? "Arrivo" : "Arrival")
                    : `${lang === "it" ? "Sosta" : "Stop"} ${stopNumber}`;
                const BookendIcon = isDeparture ? Navigation : MapPinned;

                const stopLegs = stopLegsByWaypointId[waypoint.id];
                const arrivalWindowLabel = formatBookingWindow(
                  stopLegs?.inbound?.ends_at_window_start,
                  stopLegs?.inbound?.ends_at_window_end,
                  bookingWindowLocale
                );
                const departureWindowLabel = formatBookingWindow(
                  stopLegs?.outbound?.starts_at_window_start,
                  stopLegs?.outbound?.starts_at_window_end,
                  bookingWindowLocale
                );
                // La finestra pianificata è più informativa della data secca: quando c'è, la sostituisce.
                const arrivalRow = arrivalWindowLabel
                  ? { label: lang === "it" ? "Finestra di arrivo" : "Arrival window", value: arrivalWindowLabel }
                  : (() => {
                      const arrivalLabel = formatIsoDate(waypoint.date_end, locale);
                      return arrivalLabel
                        ? { label: lang === "it" ? "Arrivo previsto" : "Expected arrival", value: arrivalLabel }
                        : null;
                    })();
                const departureRow = departureWindowLabel
                  ? { label: lang === "it" ? "Finestra di partenza" : "Departure window", value: departureWindowLabel }
                  : (() => {
                      const departureLabel = formatIsoDate(waypoint.date_start, locale);
                      return departureLabel
                        ? { label: lang === "it" ? "Ripartenza prevista" : "Expected departure", value: departureLabel }
                        : null;
                    })();
                const stopDurationLabel = formatWaypointStopDuration(waypoint, lang);
                const hasStayInfo = Boolean(arrivalRow || departureRow || stopDurationLabel);

                const heroMedia = mediaItems.find((item) => item.kind === "image") ?? mediaItems[0];
                const extraMedia = heroMedia ? mediaItems.filter((item) => item !== heroMedia) : [];

                return (
                  <article
                    key={waypoint.id}
                    id={`tappa-${waypoint.id}`}
                    className={`scroll-mt-24 overflow-hidden rounded-[28px] ${isBookend ? "glass-panel" : "glass-panel-soft"}`}
                  >
                    {heroMedia && heroMedia.kind === "image" ? (
                      <div className="relative aspect-[16/8] w-full overflow-hidden sm:aspect-[16/7]">
                        <img
                          src={heroMedia.url}
                          alt={heroMedia.name || waypointName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                        {isBookend ? (
                          <BookendIcon
                            className="absolute right-5 top-5 h-10 w-10 text-white/35 sm:h-12 sm:w-12"
                            strokeWidth={1.5}
                          />
                        ) : (
                          <span className="editorial-heading absolute right-5 top-4 text-5xl font-medium text-white/25 sm:text-6xl">
                            {stopNumber}
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-white/80">{stopLabel}</p>
                          <h3 className="editorial-heading mt-1 text-2xl text-white sm:text-3xl">{waypointName}</h3>
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/75">
                            <MapPin size={13} /> {formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-4 p-5 pb-0 sm:p-7 sm:pb-0">
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            isBookend ? "bg-accent text-accent-foreground" : "bg-accent/10 text-accent"
                          }`}
                        >
                          {isBookend ? <BookendIcon size={14} /> : stopNumber}
                        </span>
                        <div>
                          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-accent">{stopLabel}</p>
                          <h3 className="editorial-heading mt-1 text-xl sm:text-2xl">{waypointName}</h3>
                          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                            <MapPin size={13} /> {formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="p-5 sm:p-7">
                      {(waypointMoment || article) && (
                        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {waypointMoment && <span>{waypointMoment}</span>}
                          {article && (
                            <Link to={`/logbook/${article.slug}`} className="text-accent hover:text-foreground transition-colors">
                              {lang === "it" ? "Articolo collegato" : "Related article"}: {articleTitle}
                            </Link>
                          )}
                        </div>
                      )}
                      <div className={`grid gap-6 ${hasStayInfo ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
                        {waypointDescription && (
                          <div className="editorial-dropcap min-w-0 max-w-[64ch]">
                            <p className="text-[15px] leading-[1.75] text-foreground/75" style={{ textWrap: "pretty" }}>
                              {waypointDescription}
                            </p>
                          </div>
                        )}
                        {hasStayInfo && (
                          <aside className="rounded-[20px] border border-border/60 bg-background/40 p-4 sm:p-5 lg:self-start">
                            <p className="mb-3 text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                              {lang === "it" ? "Info pratiche" : "Practical info"}
                            </p>
                            <dl className="m-0 space-y-3.5">
                              {arrivalRow && (
                                <div className="flex items-start gap-2.5">
                                  <CalendarCheck size={14} className="mt-0.5 shrink-0 text-accent" />
                                  <div>
                                    <dt className="text-[11px] text-muted-foreground">{arrivalRow.label}</dt>
                                    <dd className="m-0 text-sm text-foreground">{arrivalRow.value}</dd>
                                  </div>
                                </div>
                              )}
                              {departureRow && (
                                <div className="flex items-start gap-2.5">
                                  <Ship size={14} className="mt-0.5 shrink-0 text-accent" />
                                  <div>
                                    <dt className="text-[11px] text-muted-foreground">{departureRow.label}</dt>
                                    <dd className="m-0 text-sm text-foreground">{departureRow.value}</dd>
                                  </div>
                                </div>
                              )}
                              {stopDurationLabel && (
                                <div className="flex items-start gap-2.5">
                                  <Clock size={14} className="mt-0.5 shrink-0 text-accent" />
                                  <div>
                                    <dt className="text-[11px] text-muted-foreground">
                                      {lang === "it" ? "Durata sosta" : "Stop duration"}
                                    </dt>
                                    <dd className="m-0 text-sm text-foreground">{stopDurationLabel}</dd>
                                  </div>
                                </div>
                              )}
                            </dl>
                          </aside>
                        )}
                      </div>
                      <div className="min-w-0">
                        {extraMedia.length > 0 && (
                          <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
                            {extraMedia.map((mediaItem, mediaIndex) => (
                              <div
                                key={`${waypoint.id}-${mediaIndex}`}
                                className="w-40 shrink-0 overflow-hidden rounded-[16px] border border-border/60 bg-background/40"
                              >
                                {mediaItem.kind === "image" ? (
                                  <img
                                    src={mediaItem.url}
                                    alt={mediaItem.name || waypointName}
                                    className="h-28 w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : mediaItem.kind === "video" ? (
                                  <video
                                    src={mediaItem.url}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    className="h-28 w-full object-cover"
                                  />
                                ) : (
                                  <a
                                    href={mediaItem.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex h-28 items-center justify-center px-3 text-center text-xs text-accent hover:text-foreground transition-colors"
                                  >
                                    {mediaItem.name || (lang === "it" ? "Apri allegato" : "Open attachment")}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {poiItems.length > 0 && (
                          <div className="mt-6">
                            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                              <Landmark size={13} className="text-accent" /> {lang === "it" ? "Punti di interesse" : "Points of interest"}
                            </p>
                            <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-proximity">
                              {poiItems.map((item, itemIndex) => (
                                <div
                                  key={`${waypoint.id}-poi-${itemIndex}`}
                                  className="w-64 shrink-0 snap-start rounded-[16px] border border-border/60 bg-background/40 p-3.5"
                                >
                                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                                  {item.description && (
                                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{item.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {activityItems.length > 0 && (
                          <div className="mt-6">
                            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                              <Activity size={13} className="text-accent" /> {lang === "it" ? "Attività previste" : "Planned activities"}
                            </p>
                            <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-proximity">
                              {activityItems.map((item, itemIndex) => (
                                <div
                                  key={`${waypoint.id}-activity-${itemIndex}`}
                                  className="w-64 shrink-0 snap-start rounded-[16px] border border-border/60 bg-background/40 p-3.5"
                                >
                                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                                  {item.description && (
                                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{item.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {airportItems.length > 0 && (
                          <div className="mt-6">
                            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                              <Plane size={13} /> {lang === "it" ? "Aeroporti vicini" : "Nearby airports"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {airportItems.map((airport, airportIndex) => (
                                <span
                                  key={`${waypoint.id}-airport-${airportIndex}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-foreground"
                                >
                                  {airport.name}
                                  {airport.iata ? ` (${airport.iata})` : ""}
                                  {airport.distanceKm != null ? (
                                    <span className="text-muted-foreground">· {Math.round(airport.distanceKm)} km</span>
                                  ) : null}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {publicWaypoints.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {lang === "it"
                    ? "Nessuna tappa pubblica ancora disponibile per questa rotta."
                    : "No public stops are available for this route yet."}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Related articles */}
      <section id="articoli-collegati" className="page-section pt-0 scroll-mt-24">
        <div className="page-section-wide">
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((article) => {
                const title = lang === "it" ? article.title_it || article.title_en : article.title_en;
                const excerpt = lang === "it" ? article.excerpt_it || article.excerpt_en : article.excerpt_en;
                const thumbStyle = article.cover_image
                  ? coverImageStyle(
                      article.cover_image,
                      clampCoverFocal(
                        Number(article.cover_focal_x ?? 50),
                        Number(article.cover_focal_y ?? 50),
                        Number(article.cover_zoom ?? 1)
                      )
                    )
                  : undefined;
                const publishedLabel = article.published_at
                  ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(article.published_at))
                  : null;
                return (
                  <Link
                    key={article.id}
                    to={`/logbook/${article.slug}`}
                    className="group flex gap-4 rounded-[24px] border border-border/60 bg-background/40 p-3 transition-colors hover:border-accent"
                  >
                    {article.cover_image && (
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[18px] relative bg-muted">
                        <img src={article.cover_image} alt={title || ""} className="absolute inset-0 max-w-none" style={thumbStyle} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      {publishedLabel && <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">{publishedLabel}</p>}
                      <h3 className="editorial-heading text-lg leading-snug mb-1 group-hover:text-accent transition-colors">{title}</h3>
                      {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
                    </div>
                  </Link>
                );
              })}
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

      {/* Media gallery */}
      {galleryItems.length > 0 && (
        <section className="page-section pt-0">
          <div className="page-section-wide glass-panel rounded-[34px] p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Images size={18} />
              </div>
              <div>
                <h2 className="editorial-heading text-2xl md:text-3xl">{lang === "it" ? "Galleria" : "Gallery"}</h2>
                <p className="text-sm text-muted-foreground">
                  {galleryItems.length} {lang === "it" ? "foto da questo viaggio" : "photos from this voyage"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {galleryItems.map((item, index) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  className="group overflow-hidden rounded-[20px] border border-border/60 bg-muted"
                >
                  <img
                    src={item.url}
                    alt={item.alt}
                    className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-105 sm:h-36"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <Dialog open={lightboxIndex != null} onOpenChange={(open) => !open && setLightboxIndex(null)}>
        <DialogContent className="max-w-[min(96vw,1120px)] overflow-hidden border border-white/10 bg-[rgba(10,14,20,0.96)] p-0 text-white shadow-2xl">
          {lightboxIndex != null && galleryItems[lightboxIndex] && (
            <div className="relative flex max-h-[85vh] items-center justify-center">
              <img
                src={galleryItems[lightboxIndex].url}
                alt={galleryItems[lightboxIndex].alt}
                className="max-h-[85vh] w-full object-contain"
              />
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
                aria-label={lang === "it" ? "Chiudi" : "Close"}
              >
                <X size={18} />
              </button>
              {galleryItems.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((lightboxIndex - 1 + galleryItems.length) % galleryItems.length)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
                    aria-label={lang === "it" ? "Precedente" : "Previous"}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((lightboxIndex + 1) % galleryItems.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
                    aria-label={lang === "it" ? "Successiva" : "Next"}
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
              <DialogTitle className="sr-only">{galleryItems[lightboxIndex].alt || "Photo"}</DialogTitle>
              <DialogDescription className="sr-only">{voyageName || voyage.name}</DialogDescription>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VoyagePage;
