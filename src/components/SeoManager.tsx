import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  applySeo,
  DEFAULT_DESCRIPTION,
  DEFAULT_DESCRIPTION_IT,
  stripLangPrefix,
} from "@/lib/seo";
import { useI18n } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";

type SeoConfig = {
  title: { en: string; it: string };
  description: { en: string; it: string };
  robots?: string;
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
    title: { en: "Crew | BITE", it: "La Ciurma | BITE" },
    description: {
      en: "Meet the crew behind BITE and the life aboard S/Y Spritz.",
      it: "Scopri la ciurma dietro BITE e la vita a bordo di S/Y Spritz.",
    },
  },
  "/manifesto": {
    title: { en: "Manifesto | BITE", it: "Manifesto | BITE" },
    description: {
      en: "Read the values behind BITE: life at sea, intentional living, and independent storytelling.",
      it: "I valori dietro BITE: vita in mare, scelte intenzionali e narrazione indipendente.",
    },
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
      en: "Browse public routes with departures, arrivals, dates, and waypoints from aboard S/Y Spritz.",
      it: "Naviga le rotte pubbliche con partenze, arrivi, date e waypoint da bordo di S/Y Spritz.",
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
    title: { en: "Collaborations | BITE", it: "Collaborazioni | BITE" },
    description: {
      en: "Partnerships, editorial work, and creative collaborations with BITE.",
      it: "Partnership, lavoro editoriale e collaborazioni creative con BITE.",
    },
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
      en: "Confirm your BITE newsletter subscription.",
      it: "Conferma la tua iscrizione alla newsletter BITE.",
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
        en: "Public route page with departure, arrival, waypoints, and voyage dates.",
        it: "Pagina rotta pubblica con partenza, arrivo, waypoint e date del viaggio.",
      },
    };
  }

  return (
    STATIC_ROUTE_SEO[pathname] ?? {
      title: { en: "BITE", it: "BITE" },
      description: { en: DEFAULT_DESCRIPTION, it: DEFAULT_DESCRIPTION_IT },
      robots: pathname === "/404" ? "noindex, nofollow" : "index, follow",
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
    });
  }, [pathname, lang]);

  return null;
};

export default SeoManager;
