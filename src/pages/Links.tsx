import { Link } from "react-router-dom";
import {
  ArrowRight,
  ExternalLink,
  Globe,
  Instagram,
  Mail,
  Youtube,
} from "lucide-react";
import { useEffect } from "react";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";
import { useI18n } from "@/lib/i18n";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, SITE_URL, WEBSITE_ID } from "@/lib/seo";
import boatSunset from "@/assets/boat-sunset.webp";

const TikTokIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const bioLinks = [
  {
    label: "Sito ufficiale",
    labelEn: "Official website",
    description: "Esplora il progetto completo, i viaggi e il logbook.",
    descriptionEn: "Explore the full project, voyages, and logbook.",
    href: SITE_URL,
    icon: Globe,
    featured: true,
  },
  {
    label: "Logbook",
    labelEn: "Logbook",
    description: "Articoli, storie e note tecniche dal bordo.",
    descriptionEn: "Articles, stories, and technical notes from aboard.",
    href: "/logbook",
    icon: ArrowRight,
    internal: true,
  },
  {
    label: "Collaborazioni",
    labelEn: "Collaborations",
    description: "Partnership, media kit e contatti professionali.",
    descriptionEn: "Partnerships, media kit, and professional contacts.",
    href: "/collaborations",
    icon: ArrowRight,
    internal: true,
  },
  {
    label: "Instagram",
    labelEn: "Instagram",
    description: "Aggiornamenti quotidiani, reel e dietro le quinte.",
    descriptionEn: "Daily updates, reels, and behind the scenes.",
    href: "https://www.instagram.com/better_is_the_end",
    icon: Instagram,
  },
  {
    label: "YouTube",
    labelEn: "YouTube",
    description: "Video di bordo, navigazione e vita reale in barca.",
    descriptionEn: "Aboard videos, sailing, and real life on the boat.",
    href: "https://www.youtube.com/@better_is_the_end",
    icon: Youtube,
  },
  {
    label: "TikTok",
    labelEn: "TikTok",
    description: "Clip brevi dal mare, dai cani e dai refit.",
    descriptionEn: "Short clips from the sea, the dogs, and refits.",
    href: "https://www.tiktok.com/@better_is_the_end",
    icon: TikTokIcon,
  },
  {
    label: "SeaPeople",
    labelEn: "SeaPeople",
    description: "Segui la community e la nostra presenza sulla mappa.",
    descriptionEn: "Follow the community and our presence on the map.",
    href: "https://dashboard.seapeopleapp.com/group/41a0ad62-7f71-4107-9269-878fa210f24c?utm_source=SP&utm_medium=usershare&utm_campaign=mpernozzoli",
    icon: SeaPeopleIcon,
  },
  {
    label: "Email",
    labelEn: "Email",
    description: "Scrivici direttamente per collaborazioni o messaggi.",
    descriptionEn: "Write to us directly for collaborations or messages.",
    href: "mailto:hello@biteproject.com",
    icon: Mail,
  },
] as const satisfies readonly { label: string; labelEn: string; description: string; descriptionEn: string; href: string; icon: any; featured?: boolean; internal?: boolean }[];

const Links = () => {
  const { lang } = useI18n();

  useEffect(() => {
    const title = lang === "it" ? "BITE | Link utili" : "BITE | Useful links";
    const description =
      lang === "it"
        ? "Una pagina rapida con tutti i link ufficiali di BITE: sito, logbook, collaborazioni e social."
        : "A quick page with all official BITE links: website, logbook, collaborations, and social channels.";

    applySeo({
      title,
      description,
      pathname: "/links",
      image: boatSunset,
      type: "collection",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: `${SITE_URL}/links`,
        isPartOf: { "@id": WEBSITE_ID },
        publisher: { "@id": ORGANIZATION_ID },
        hasPart: bioLinks.map((item) => ({
          "@type": "WebPage",
          name: lang === "it" ? item.label : item.labelEn,
          url: item.internal ? new URL(item.href, SITE_URL).toString() : item.href,
        })),
      },
    });
  }, [lang]);

  return (
    <div className="px-4 pb-6 pt-28 md:px-6 md:pb-8 md:pt-32">
      <section className="mx-auto max-w-3xl">
        <div className="glass-panel overflow-hidden rounded-[36px]">
          <div className="relative h-44 overflow-hidden md:h-56">
            <img
              src={boatSunset}
              alt="BITE sailing at sunset"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-8">
              <div className="glass-chip-dark mb-4 inline-flex items-center gap-2 border-white/16 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-white/80">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Better Is The End
              </div>
              <h1 className="font-serif text-3xl font-bold tracking-[0.08em] md:text-5xl">
                {lang === "it" ? "Tutti i link utili" : "All the essential links"}
              </h1>
            </div>
          </div>

          <div className="space-y-6 p-5 md:p-8">
            <div className="rounded-[28px] border border-white/45 bg-white/55 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6">
              <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-accent/80">
                BITE
              </p>
              <p className="max-w-2xl font-serif text-lg italic leading-relaxed text-foreground/80">
                {lang === "it"
                  ? "Due umani, due cani, una barca vecchia e storie vere dal mare. Qui trovi il sito e tutti i canali ufficiali."
                  : "Two humans, two dogs, an old boat, and real stories from the sea. Here you can find the website and all official channels."}
              </p>
            </div>

            <div className="grid gap-3">
              {bioLinks.map((item) => {
                const Icon = item.icon;
                const title = lang === "it" ? item.label : item.labelEn;
                const description = lang === "it" ? item.description : item.descriptionEn;
                const isExternal = !item.internal;
                const cardClass = item.featured
                  ? "glass-panel-dark text-white border-white/12 shadow-[0_30px_90px_rgba(15,23,42,0.2)]"
                  : "glass-panel text-foreground border-white/50";

                if (item.internal) {
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={`group flex items-center gap-4 rounded-[28px] border px-5 py-4 transition-transform duration-300 hover:-translate-y-0.5 ${cardClass}`}
                    >
                      <span className="glass-chip inline-flex h-12 w-12 shrink-0 items-center justify-center text-current">
                        <Icon size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-sm uppercase tracking-[0.24em] text-current/70">
                          {title}
                        </span>
                        <span className="mt-1 block font-serif text-lg leading-snug text-current">
                          {description}
                        </span>
                      </span>
                      <ArrowRight
                        size={18}
                        className="shrink-0 transition-transform duration-300 group-hover:translate-x-1"
                      />
                    </Link>
                  );
                }

                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group flex items-center gap-4 rounded-[28px] border px-5 py-4 transition-transform duration-300 hover:-translate-y-0.5 ${cardClass}`}
                  >
                    <span className="glass-chip inline-flex h-12 w-12 shrink-0 items-center justify-center text-current">
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-sans text-sm uppercase tracking-[0.24em] text-current/70">
                        {title}
                      </span>
                      <span className="mt-1 block font-serif text-lg leading-snug text-current">
                        {description}
                      </span>
                    </span>
                    {isExternal ? (
                      <ExternalLink
                        size={18}
                        className="shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      />
                    ) : null}
                  </a>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 rounded-[28px] border border-white/45 bg-white/55 p-5 text-sm text-foreground/70 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:flex-row md:items-center md:justify-between md:p-6">
              <p>
                {lang === "it"
                  ? "Usa questa pagina come link in bio o come hub rapido da condividere."
                  : "Use this page as your bio link or as a quick hub to share."}
              </p>
              <a
                href={SITE_URL}
                className="inline-flex items-center gap-2 font-medium text-foreground transition-colors hover:text-accent"
              >
                {lang === "it" ? "Apri biteproject.it" : "Open biteproject.it"} <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Links;
