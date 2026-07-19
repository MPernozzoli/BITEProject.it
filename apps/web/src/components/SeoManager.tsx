import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  applySeo,
  DEFAULT_DESCRIPTION,
  DEFAULT_DESCRIPTION_IT,
  ORGANIZATION_ID,
  SITE_URL,
  stripLangPrefix,
} from "@/lib/seo";
import type { SeoStructuredData } from "@/lib/seo";
import { useI18n } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";

type SeoConfig = {
  title: { en: string; it: string };
  description: { en: string; it: string };
  robots?: string;
  structuredData?: (lang: Language) => SeoStructuredData;
};

const STATIC_ROUTE_SEO: Record<string, SeoConfig> = {
  "/": {
    title: {
      en: "BITE — Stories from S/Y Spritz",
      it: "BITE — Storie da S/Y Spritz",
    },
    description: {
      en: DEFAULT_DESCRIPTION,
      it: DEFAULT_DESCRIPTION_IT,
    },
  },
  "/crew": {
    title: { en: "Crew and S/Y Spritz Deerberg Beryll 32 | BITE", it: "Ciurma e S/Y Spritz Deerberg Beryll 32 | BITE" },
    description: {
      en: "Meet Massimo, Sami, Godot and Freyja aboard Spritz, a 1975 Deerberg Beryll 32 sailboat refitted for Mediterranean sailing, remote work and life at sea.",
      it: "Conosci Massimo, Sami, Godot e Freyja a bordo di Spritz, una Deerberg Beryll 32 del 1975 riadattata per vela, lavoro remoto e vita in mare.",
    },
    structuredData: (lang) => ({
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: lang === "it" ? "Ciurma e S/Y Spritz Deerberg Beryll 32" : "Crew and S/Y Spritz Deerberg Beryll 32",
      description:
        lang === "it"
          ? "Pagina sulla ciurma BITE e su Spritz, barca a vela Deerberg Beryll 32 del 1975."
          : "Page about the BITE crew and Spritz, a 1975 Deerberg Beryll 32 sailboat.",
      url: `${SITE_URL}/${lang}/crew`,
      inLanguage: lang,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": ORGANIZATION_ID },
      about: [
        { "@type": "Person", name: "Massimo" },
        { "@type": "Person", name: "Sami" },
        { "@type": "Person", name: "Godot" },
        { "@type": "Person", name: "Freyja" },
        {
          "@type": "Product",
          name: "S/Y Spritz",
          model: "Deerberg Beryll 32",
          category: "Sailboat",
          description:
            lang === "it"
              ? "Barca a vela Deerberg Beryll 32 costruita in Germania nel 1975, nata ketch e poi convertita a cutter."
              : "Deerberg Beryll 32 sailboat built in Germany in 1975, originally a ketch and later converted to a cutter.",
        },
      ],
    }),
  },
  "/manifesto": {
    // Temporarily withheld while the Manifesto is being reworked: not linked in
    // the header/footer and kept out of indexing until it's ready again.
    title: { en: "Manifesto | BITE", it: "Manifesto | BITE" },
    description: {
      en: "Read the values behind BITE: life at sea, intentional living, and independent storytelling.",
      it: "I valori dietro BITE: vita in mare, scelte intenzionali e narrazione indipendente.",
    },
    robots: "noindex, nofollow",
  },
  "/logbook": {
    title: { en: "Logbook | BITE", it: "Diario di bordo | BITE" },
    description: {
      en: "Explore voyages, refit notes, and stories from aboard S/Y Spritz.",
      it: "Esplora rotte, note di refit e storie da bordo di S/Y Spritz.",
    },
  },
  "/voyages": {
    title: { en: "Voyages | BITE", it: "Rotte | BITE" },
    description: {
      en: "Browse public routes with departures, arrivals, dates, and stops from aboard S/Y Spritz.",
      it: "Naviga le rotte pubbliche con partenze, arrivi, date e tappe da bordo di S/Y Spritz.",
    },
  },
  "/links": {
    title: { en: "Links | BITE", it: "Link | BITE" },
    description: {
      en: "Quick links to all BITE projects, social channels and resources.",
      it: "Tutti i link al progetto BITE, ai canali social e alle risorse.",
    },
  },
  "/collaborations": {
    title: { en: "Sailing Partnerships and Collaborations | BITE", it: "Partnership nautiche e collaborazioni | BITE" },
    description: {
      en: "Sailing partnerships, marine gear collaborations and editorial projects with BITE aboard S/Y Spritz: field-tested products, reviews, stories and content from real use at sea.",
      it: "Partnership nautiche, collaborazioni marine e progetti editoriali con BITE a bordo di S/Y Spritz: prodotti testati in mare, recensioni, storie e contenuti da uso reale.",
    },
    structuredData: (lang) => ({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: lang === "it" ? "Partnership nautiche e collaborazioni" : "Sailing partnerships and collaborations",
      description:
        lang === "it"
          ? "Collaborazioni editoriali e partnership nautiche per attrezzatura, elettronica marina, connettività, abbigliamento tecnico, accessori per animali a bordo e sostenibilità."
          : "Editorial collaborations and sailing partnerships for marine gear, marine electronics, connectivity, technical clothing, pet gear aboard and sustainability.",
      url: `${SITE_URL}/${lang}/collaborations`,
      inLanguage: lang,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": ORGANIZATION_ID },
      about: [
        "partnership nautica",
        "collaborazioni nautiche",
        "sailing partnerships",
        "marine gear collaborations",
        "attrezzatura nautica",
        "elettronica marina",
      ],
    }),
  },
  "/contact": {
    title: { en: "Contact | BITE", it: "Contatti | BITE" },
    description: {
      en: "Get in touch with BITE for collaborations, editorial projects, and updates from aboard.",
      it: "Contatta BITE per collaborazioni, progetti editoriali e aggiornamenti da bordo.",
    },
  },
  "/privacy-policy": {
    title: { en: "Privacy Policy | BITE", it: "Privacy Policy | BITE" },
    description: {
      en: "Privacy information for biteproject.it and related services.",
      it: "Informativa sulla privacy per biteproject.it e servizi correlati.",
    },
  },
  "/cookie-policy": {
    title: { en: "Cookie Policy | BITE", it: "Cookie Policy | BITE" },
    description: {
      en: "Cookie policy and technical information for biteproject.it.",
      it: "Cookie policy e informazioni tecniche per biteproject.it.",
    },
  },
  "/login": {
    title: { en: "Login | BITE", it: "Accedi | BITE" },
    description: {
      en: "Access your BITE account.",
      it: "Accedi al tuo account BITE.",
    },
    robots: "noindex, nofollow",
  },
  "/signup": {
    title: { en: "Sign Up | BITE", it: "Registrati | BITE" },
    description: {
      en: "Create your BITE account.",
      it: "Crea il tuo account BITE.",
    },
    robots: "noindex, nofollow",
  },
  "/bookings": {
    title: { en: "My Voyages | BITE", it: "Le mie partecipazioni | BITE" },
    description: {
      en: "Manage the voyages you've joined on BITE.",
      it: "Gestisci le tue partecipazioni ai viaggi BITE.",
    },
    robots: "noindex, nofollow",
  },
  "/unsubscribe": {
    title: { en: "Unsubscribe | BITE", it: "Disiscriviti | BITE" },
    description: {
      en: "Manage your BITE email subscription preferences.",
      it: "Gestisci le tue preferenze di iscrizione email BITE.",
    },
    robots: "noindex, nofollow",
  },
  "/newsletter/confirm": {
    title: { en: "Confirm subscription | BITE", it: "Conferma iscrizione | BITE" },
    description: {
      en: "Confirm your subscription to BITE's Notes from the boat.",
      it: "Conferma la tua iscrizione agli Appunti dalla barca di BITE.",
    },
    robots: "noindex, nofollow",
  },
};

const getSeoForPathname = (rawPath: string): SeoConfig => {
  const pathname = stripLangPrefix(rawPath);

  if (pathname.startsWith("/admin")) {
    return {
      title: { en: "Admin | BITE", it: "Admin | BITE" },
      description: {
        en: "Administrative area for BITE.",
        it: "Area amministrativa di BITE.",
      },
      robots: "noindex, nofollow",
    };
  }

  // Own profile area is private (noindex). Public profile pages /profile/:id
  // ARE indexable — they are listed in the public sitemap.
  if (pathname === "/profile") {
    return {
      title: { en: "Profile | BITE", it: "Profilo | BITE" },
      description: {
        en: "BITE profile page.",
        it: "Pagina profilo BITE.",
      },
      robots: "noindex, nofollow",
    };
  }

  if (pathname.startsWith("/profile/")) {
    return {
      title: { en: "Profile | BITE", it: "Profilo | BITE" },
      description: {
        en: "Public BITE profile page.",
        it: "Profilo pubblico BITE.",
      },
    };
  }

  if (pathname.startsWith("/logbook/story/")) {
    return {
      title: { en: "Story | BITE", it: "Storia | BITE" },
      description: {
        en: "Story from the BITE logbook.",
        it: "Storia dal diario di bordo BITE.",
      },
    };
  }

  if (pathname.startsWith("/logbook/")) {
    return {
      title: { en: "Logbook Article | BITE", it: "Articolo del diario | BITE" },
      description: {
        en: "Article from the BITE logbook.",
        it: "Articolo dal diario di bordo BITE.",
      },
    };
  }

  if (pathname.startsWith("/voyages/")) {
    return {
      title: { en: "Voyage Route | BITE", it: "Rotta del viaggio | BITE" },
      description: {
        en: "Public route page with departure, arrival, stops, and voyage dates.",
        it: "Pagina rotta pubblica con partenza, arrivo, tappe e date del viaggio.",
      },
    };
  }

  // Every legit public route is enumerated above (static map + dynamic
  // prefixes). Anything else renders the NotFound page at an arbitrary URL:
  // noindex it so soft-404s never get indexed. New public routes must be
  // registered in STATIC_ROUTE_SEO (or a prefix branch) to be indexable.
  return (
    STATIC_ROUTE_SEO[pathname] ?? {
      title: { en: "Page not found | BITE", it: "Pagina non trovata | BITE" },
      description: { en: DEFAULT_DESCRIPTION, it: DEFAULT_DESCRIPTION_IT },
      robots: "noindex, nofollow",
    }
  );
};

const SeoManager = () => {
  const { pathname } = useLocation();
  const { lang } = useI18n();

  useEffect(() => {
    const seo = getSeoForPathname(pathname);
    const activeLang = lang as Language;
    const strippedPath = stripLangPrefix(pathname);
    applySeo({
      title: seo.title[activeLang],
      description: seo.description[activeLang],
      pathname: strippedPath,
      lang: activeLang,
      robots: seo.robots ?? "index, follow",
      type:
        strippedPath === "/logbook" || strippedPath === "/voyages"
          ? "collection"
          : "website",
      structuredData: seo.structuredData?.(activeLang),
    });
  }, [pathname, lang]);

  return null;
};

export default SeoManager;
