import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Wrench, Compass, Wifi, Pen, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useArticleReads } from "@/hooks/useArticleReads";
import { useAuth } from "@/hooks/useAuth";
import type { GeoArticle, Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import LazyVoyageMap from "@/components/LazyVoyageMap";
import StructuredData from "@/components/StructuredData";
import { ORGANIZATION_ID, SITE_URL, WEBSITE_ID } from "@/lib/seo";
import { useIsMobile } from "@/hooks/use-mobile";

import bowSunset from "@/assets/bow-sunset.webp";
import boatSunset from "@/assets/boat-sunset.webp";
import dogsMarina from "@/assets/dogs-marina.webp";
import dinghyCrew from "@/assets/dinghy-crew.webp";
import spritzAnchor from "@/assets/hero-media/spritz-anchor.webp";
import spritzCockpitVertical from "@/assets/hero-media/spritz-cockpit-vertical.webp";
import spritzDogRest from "@/assets/hero-media/spritz-dog-rest.webp";
import spritzDogsBow from "@/assets/hero-media/spritz-dogs-bow.webp";
import spritzKeel from "@/assets/hero-media/spritz-keel.webp";
import spritzMooringVertical from "@/assets/hero-media/spritz-mooring-vertical.webp";
import spritzWake from "@/assets/hero-media/spritz-wake.webp";
import spritzWide from "@/assets/hero-media/spritz-wide.webp";

interface HomeTag {
  id: string;
  name: string;
}

interface HomeArticle {
  id: string;
  title_en: string;
  title_it: string | null;
  slug: string;
  excerpt_en: string | null;
  excerpt_it: string | null;
  cover_image: string | null;
  published_at: string | null;
  category: string;
  tags: HomeTag[];
}

interface ArticleTagRelation {
  article_id: string;
  tags: HomeTag | null;
}

interface HeroMedia {
  kind: "image" | "video";
  src: string;
  alt: string;
  poster?: string;
  mimeType?: string;
}

interface HomepageHeroVideoPool {
  desktop: HeroMedia[];
  mobile: HeroMedia[];
}

interface StorageListItem {
  name: string;
}

const HOMEPAGE_MEDIA_BUCKET = "homepage-media";
const HOMEPAGE_HORIZONTAL_FOLDER = "hero-horizontal";
const HOMEPAGE_VERTICAL_FOLDER = "hero-vertical";
const SUPPORTED_HERO_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "m4v", "mov"]);

const desktopHeroMedia: HeroMedia[] = [
  { kind: "image", src: bowSunset, alt: "View from the bow at sunset" },
  { kind: "image", src: spritzWake, alt: "Spritz stern slicing through bright blue water" },
  { kind: "image", src: spritzAnchor, alt: "Spritz stern gear above the sea" },
  { kind: "image", src: spritzKeel, alt: "Keel detail over clear water" },
  { kind: "image", src: spritzWide, alt: "Wide view of Spritz under sail" },
];

const mobileHeroMedia: HeroMedia[] = [
  { kind: "image", src: bowSunset, alt: "View from the bow at sunset" },
  { kind: "image", src: spritzCockpitVertical, alt: "Cockpit view while sailing" },
  { kind: "image", src: spritzDogRest, alt: "Dog resting on deck during navigation" },
  { kind: "image", src: spritzDogsBow, alt: "Dogs watching the water from the bow" },
  { kind: "image", src: spritzMooringVertical, alt: "Spritz moored in calm water" },
];

const pickRandomHeroMedia = (isMobile: boolean) => {
  const mediaPool = isMobile ? mobileHeroMedia : desktopHeroMedia;
  return mediaPool[Math.floor(Math.random() * mediaPool.length)] ?? mediaPool[0];
};

const shuffleHeroMedia = (items: HeroMedia[], avoidSrc?: string) => {
  const nextItems = [...items];
  for (let i = nextItems.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [nextItems[i], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[i]];
  }

  if (avoidSrc && nextItems.length > 1 && nextItems[0]?.src === avoidSrc) {
    [nextItems[0], nextItems[1]] = [nextItems[1], nextItems[0]];
  }

  return nextItems;
};

const getVideoMimeType = (filename: string) => {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return "video/mp4";
};

const createStorageVideoEntries = (folder: string, files: StorageListItem[], alt: string): HeroMedia[] =>
  files
    .filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return Boolean(extension && SUPPORTED_HERO_VIDEO_EXTENSIONS.has(extension));
    })
    .map((file) => {
      const path = `${folder}/${file.name}`;
      const { data } = supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).getPublicUrl(path);

      return {
        kind: "video" as const,
        src: data.publicUrl,
        alt,
        mimeType: getVideoMimeType(file.name),
      };
    });

const Index = () => {
  const { t, lang } = useI18n();
  const { isRead } = useArticleReads();
  const { session } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [heroPlaylist, setHeroPlaylist] = useState<HeroMedia[]>(() => [pickRandomHeroMedia(false)]);
  const [heroPlaylistIndex, setHeroPlaylistIndex] = useState(0);
  const [heroMediaVisible, setHeroMediaVisible] = useState(true);

  const { data: heroVideoPool } = useQuery<HomepageHeroVideoPool>({
    queryKey: ["homepage-hero-videos"],
    queryFn: async () => {
      const [desktopResult, mobileResult] = await Promise.all([
        supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_HORIZONTAL_FOLDER, {
          limit: 100,
          sortBy: { column: "name", order: "asc" },
        }),
        supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_VERTICAL_FOLDER, {
          limit: 100,
          sortBy: { column: "name", order: "asc" },
        }),
      ]);

      if (desktopResult.error && mobileResult.error) {
        throw desktopResult.error;
      }

      return {
        desktop: createStorageVideoEntries(
          HOMEPAGE_HORIZONTAL_FOLDER,
          (desktopResult.data ?? []) as StorageListItem[],
          "Spritz sailing footage for the desktop hero"
        ),
        mobile: createStorageVideoEntries(
          HOMEPAGE_VERTICAL_FOLDER,
          (mobileResult.data ?? []) as StorageListItem[],
          "Spritz sailing footage for the mobile hero"
        ),
      };
    },
    staleTime: 1000 * 60 * 10,
    retry: false,
  });

  const currentHeroPool = useMemo(() => {
    const desktopPool = [...(heroVideoPool?.desktop ?? []), ...desktopHeroMedia];
    const mobilePool = [...(heroVideoPool?.mobile ?? []), ...mobileHeroMedia];
    return isMobile ? mobilePool : desktopPool;
  }, [heroVideoPool, isMobile]);

  const heroMedia = heroPlaylist[heroPlaylistIndex] ?? currentHeroPool[0] ?? pickRandomHeroMedia(false);

  useEffect(() => {
    const nextPlaylist = shuffleHeroMedia(currentHeroPool);
    setHeroPlaylist(nextPlaylist.length ? nextPlaylist : [pickRandomHeroMedia(isMobile)]);
    setHeroPlaylistIndex(0);
    setHeroMediaVisible(true);
  }, [currentHeroPool, isMobile]);

  useEffect(() => {
    if (!heroMedia || heroMedia.kind !== "image" || heroPlaylist.length <= 1) return;

    const timeoutId = window.setTimeout(() => {
      setHeroMediaVisible(false);
      window.setTimeout(() => {
        setHeroPlaylistIndex((currentIndex) => {
          const isLast = currentIndex >= heroPlaylist.length - 1;
          if (isLast) {
            const nextPlaylist = shuffleHeroMedia(currentHeroPool, heroPlaylist[currentIndex]?.src);
            setHeroPlaylist(nextPlaylist);
            return 0;
          }
          return currentIndex + 1;
        });
        setHeroMediaVisible(true);
      }, 320);
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [currentHeroPool, heroMedia, heroPlaylist, heroPlaylist.length]);

  const advanceHeroMedia = () => {
    if (heroPlaylist.length <= 1) return;

    setHeroMediaVisible(false);
    window.setTimeout(() => {
      setHeroPlaylistIndex((currentIndex) => {
        const isLast = currentIndex >= heroPlaylist.length - 1;
        if (isLast) {
          const nextPlaylist = shuffleHeroMedia(currentHeroPool, heroPlaylist[currentIndex]?.src);
          setHeroPlaylist(nextPlaylist);
          return 0;
        }
        return currentIndex + 1;
      });
      setHeroMediaVisible(true);
    }, 320);
  };

  // Fetch real articles for the journal preview
  const { data: latestArticles = [] } = useQuery<HomeArticle[]>({
    queryKey: ["home-latest-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, excerpt_en, excerpt_it, cover_image, published_at, category")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(3);
      if (error) throw error;

      // Fetch tags for these articles
      const ids = (data || []).map((a) => a.id);
      if (ids.length) {
        const { data: tagData } = await supabase
          .from("article_tags")
          .select("article_id, tags(id, name)")
          .in("article_id", ids);
        const tagMap: Record<string, HomeTag[]> = {};
        (tagData as ArticleTagRelation[] | null)?.forEach((t) => {
          if (!tagMap[t.article_id]) tagMap[t.article_id] = [];
          if (t.tags) tagMap[t.article_id].push(t.tags);
        });
        return (data || []).map((a) => ({ ...a, tags: tagMap[a.id] || [] })) as HomeArticle[];
      }
      return (data || []).map((a) => ({ ...a, tags: [] })) as HomeArticle[];
    },
  });

  const { data: mapArticles = [], isLoading: isMapArticlesLoading } = useQuery<GeoArticle[]>({
    queryKey: ["home-logbook-map-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, location_name")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as GeoArticle[];
    },
  });

  const { data: voyages = [], isLoading: isVoyagesLoading } = useQuery<Voyage[]>({
    queryKey: ["home-voyages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages" as any)
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as Voyage[];
    },
  });

  const { data: allWaypoints = [], isLoading: isWaypointsLoading } = useQuery<VoyageWaypoint[]>({
    queryKey: ["home-voyage-waypoints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });

  const waypointsMap = useMemo(() => {
    const map: Record<string, VoyageWaypoint[]> = {};
    allWaypoints.forEach((waypoint) => {
      if (!map[waypoint.voyage_id]) map[waypoint.voyage_id] = [];
      map[waypoint.voyage_id].push(waypoint);
    });
    return map;
  }, [allWaypoints]);

  const isHomeMapReady = !isMapArticlesLoading && !isVoyagesLoading && !isWaypointsLoading;

  const handleNewsletterSubscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetEmail = session?.user.email?.trim() || newsletterEmail.trim();

    if (!targetEmail) {
      toast.error(lang === "it" ? "Inserisci una email valida." : "Enter a valid email.");
      return;
    }

    setNewsletterLoading(true);
    const { data, error } = await supabase.functions.invoke("newsletter-subscribe", {
      body: {
        email: targetEmail,
        preferredLanguage: lang,
        source: session ? "homepage_logged_in" : "homepage",
      },
    });
    setNewsletterLoading(false);

    if (error) {
      console.error("Newsletter subscribe failed", error);
      toast.error(
        lang === "it"
          ? "Iscrizione non riuscita. Riprova."
          : "Subscription failed. Please try again."
      );
      return;
    }

    setNewsletterEmail("");
    toast.success(
      data?.alreadySubscribed
        ? lang === "it"
          ? "Sei già iscritto. Preferenze aggiornate."
          : "You were already subscribed. Preferences updated."
        : lang === "it"
          ? "Iscrizione confermata."
          : "Subscription confirmed."
    );
  };

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <StructuredData
        id="homepage"
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "@id": ORGANIZATION_ID,
            name: "BITE",
            url: SITE_URL,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": WEBSITE_ID,
            name: "BITE",
            url: SITE_URL,
            description: "Stories, voyages, refit notes, and life aboard S/Y Spritz.",
            publisher: { "@id": ORGANIZATION_ID },
          },
        ]}
      />
      <section className="relative min-h-screen overflow-hidden px-4 pb-6 pt-24 md:px-6 md:pb-8 md:pt-28">
        <div className="absolute inset-0">
          {heroMedia.kind === "video" ? (
            <video
              key={heroMedia.src}
              className={`img-cover hero-media ${heroMediaVisible ? "hero-media--visible" : ""}`}
              poster={heroMedia.poster}
              autoPlay
              muted
              playsInline
              preload="metadata"
              onEnded={advanceHeroMedia}
            >
              <source src={heroMedia.src} type={heroMedia.mimeType ?? "video/mp4"} />
            </video>
          ) : (
            <img
              key={heroMedia.src}
              src={heroMedia.src}
              alt={heroMedia.alt}
              className={`img-cover hero-media ${heroMediaVisible ? "hero-media--visible" : ""}`}
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_26%),linear-gradient(180deg,rgba(7,15,27,0.42)_0%,rgba(9,18,31,0.38)_24%,rgba(10,20,34,0.54)_48%,rgba(8,17,30,0.76)_100%)]" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl items-center justify-center">
          <div className="hero-copy-shell w-full max-w-4xl px-4 py-8 text-center slide-up md:px-10 md:py-10">
            <p className="hero-kicker mb-6 text-[11px] font-sans uppercase tracking-[0.34em]">
              {lang === "it" ? "A bordo di Spritz" : "From aboard Spritz"}
            </p>
            <h1 className="editorial-heading hero-copy-text text-4xl md:text-6xl lg:text-7xl mb-6 whitespace-pre-line">
              {t("hero.title")}
            </h1>
            <p className="editorial-body hero-copy-text text-base md:text-lg max-w-2xl mx-auto mb-10 whitespace-pre-line">
              {t("hero.subtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/logbook"
                className="glass-button hero-cta inline-flex items-center justify-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
              >
                {t("hero.cta.journey")}
                <ArrowRight size={16} />
              </Link>
              <Link
                to="/collaborations"
                className="glass-button-dark hero-cta hero-cta-dark inline-flex items-center justify-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
              >
                {t("hero.cta.collaborate")}
              </Link>
            </div>
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2">
          <div className="hero-scroll-cue">
            <span className="hero-scroll-cue__label">{t("crew.scroll")}</span>
            <span className="hero-scroll-cue__line" aria-hidden="true">
              <span className="hero-scroll-cue__dot" />
            </span>
          </div>
        </div>
      </section>

      <section className="page-section pt-4 md:pt-6">
        <div className="page-section-narrow glass-panel rounded-[34px] px-8 py-10 md:px-12 md:py-14">
          <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
            {t("intro.label")}
          </p>
          <p className="editorial-body text-lg md:text-xl text-foreground/82 leading-relaxed">{t("intro.text")}</p>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="flex items-center justify-center mb-12">
            <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent">
              {t("values.label")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-panel-soft rounded-[28px] p-6 md:p-8">
                <h3 className="editorial-heading text-2xl md:text-3xl mb-4">{t(`values.${i}.title`)}</h3>
                <p className="editorial-body text-muted-foreground leading-relaxed">{t(`values.${i}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
                {t("life.label")}
              </p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">{t("life.title")}</h2>
              <p className="editorial-body text-muted-foreground leading-relaxed text-lg">{t("life.text")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4]">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={boatSunset}
                    alt="Spritz at sunset"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4] mt-8">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={dogsMarina}
                    alt="Dogs at the marina"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel-dark rounded-[38px] px-6 py-10 text-white md:px-10 md:py-12">
          <div className="flex items-center justify-center mb-12">
            <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76">
              {t("topics.label")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { key: "refit", icon: Wrench },
              { key: "navigation", icon: Compass },
              { key: "remote", icon: Wifi },
              { key: "storytelling", icon: Pen },
            ].map(({ key, icon: Icon }) => (
              <div key={key} className="glass-chip-dark rounded-[28px] p-6">
                <div className="glass-chip-dark inline-flex h-12 w-12 items-center justify-center mb-5 text-white/92">
                  <Icon size={20} />
                </div>
                <h3 className="editorial-heading text-xl mb-3 text-white">{t(`topics.${key}`)}</h3>
                <p className="text-sm text-white/84 leading-relaxed">{t(`topics.${key}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="flex items-end justify-between mb-12 gap-6">
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-4">{t("journal.label")}</p>
              <h2 className="editorial-heading text-3xl md:text-4xl">
                {lang === "it" ? "Ultime dal logbook" : "Latest from the logbook"}
              </h2>
            </div>
            <Link
              to="/logbook"
              className="hidden md:inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>

          {latestArticles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {latestArticles.map((entry) => {
                const title = lang === "en" ? entry.title_en : (entry.title_it || entry.title_en);
                const excerpt = lang === "en" ? entry.excerpt_en : (entry.excerpt_it || entry.excerpt_en);
                return (
                  <Link to={`/logbook/${entry.slug}`} key={entry.id} className="group block">
                    <article className="glass-panel-soft rounded-[30px] p-3 h-full transition-transform duration-300 group-hover:-translate-y-1">
                      <div className="glass-frame rounded-[24px] p-1.5 mb-5">
                        <div className="aspect-[4/3] overflow-hidden rounded-[19px] bg-muted relative">
                          {entry.cover_image ? (
                            <img
                              src={entry.cover_image}
                              alt={title}
                              className="img-cover group-hover:scale-105 transition-transform duration-700"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-2xl">BITE</div>
                          )}
                          {isRead(entry.id) && (
                            <span className="glass-chip absolute top-2 left-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-sans text-muted-foreground">
                              <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {entry.tags?.slice(0, 2).map((tag) => (
                          <span key={tag.id} className="glass-chip inline-flex px-2.5 py-1 text-[11px] font-sans text-accent">#{tag.name}</span>
                        ))}
                        {entry.published_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(entry.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      <h3 className="editorial-heading text-xl md:text-2xl mb-2 group-hover:text-accent transition-colors line-clamp-2">
                        {title}
                      </h3>
                      <p className="editorial-body text-sm text-muted-foreground line-clamp-3">{excerpt}</p>
                    </article>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-12">
              {lang === "it" ? "Nessun articolo ancora pubblicato." : "No articles published yet."}
            </p>
          )}

          <div className="mt-8 md:hidden text-center">
            <Link to="/logbook" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="glass-frame rounded-[30px] p-2">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(243,246,247,0.62))]">
                <LazyVoyageMap
                  voyages={voyages}
                  waypointsMap={waypointsMap}
                  articles={mapArticles}
                  lang={lang}
                  initialFitReady={isHomeMapReady}
                  onArticleClick={(article) => navigate(`/logbook/${article.slug}`)}
                  fallbackHeightClassName="aspect-[16/10]"
                  deferUntilVisible
                />
                {!isHomeMapReady ? (
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
                    <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans text-muted-foreground">
                      {lang === "it" ? "Caricamento mappa..." : "Loading map..."}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">{t("route.label")}</p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">{t("route.title")}</h2>
              <p className="editorial-body text-muted-foreground leading-relaxed mb-8">{t("route.text")}</p>
              <Link to="/route" className="glass-button-secondary inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium">
                {t("route.explore")} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel-dark rounded-[38px] px-6 py-10 text-white md:px-10 md:py-12">
          <div className="max-w-3xl">
            <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76 mb-8">{t("collab.label")}</p>
            <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line text-white">{t("collab.title")}</h2>
            <p className="editorial-body text-white/84 leading-relaxed text-lg mb-10">{t("collab.text")}</p>
            <Link to="/collaborations" className="glass-button inline-flex items-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide">
              {t("collab.cta")} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 md:px-6">
        <div className="glass-frame rounded-[34px] p-2 h-[50vh] md:h-[60vh] overflow-hidden">
          <div className="overflow-hidden rounded-[28px] h-full">
            <img src={dinghyCrew} alt="Crew on the dinghy" className="img-cover" loading="lazy" decoding="async" />
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-dark rounded-[38px] px-6 py-10 text-center text-white md:px-10 md:py-12">
          <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76 mb-8">{t("newsletter.label")}</p>
          <h2 className="editorial-heading text-3xl md:text-5xl mb-6 text-white">{t("newsletter.title")}</h2>
          <p className="editorial-body text-white/84 mb-10 max-w-lg mx-auto">{t("newsletter.text")}</p>
          <form onSubmit={handleNewsletterSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
            {session?.user.email ? (
              <div className="glass-chip-dark flex-1 px-5 py-3 text-sm text-white/88 text-left">
                {lang === "it"
                  ? `Ti iscriveremo con ${session.user.email}`
                  : `We'll subscribe you with ${session.user.email}`}
              </div>
            ) : (
              <div className="glass-input flex-1 rounded-full px-1.5">
                <input
                  type="email"
                  value={newsletterEmail}
                  onChange={(event) => setNewsletterEmail(event.target.value)}
                  placeholder={t("newsletter.placeholder")}
                  className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={newsletterLoading}
              className="glass-button px-8 py-3 text-sm font-sans font-medium tracking-wide disabled:opacity-60 rounded-full"
            >
              {newsletterLoading ? (lang === "it" ? "Invio..." : "Sending...") : t("newsletter.submit")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};

export default Index;
