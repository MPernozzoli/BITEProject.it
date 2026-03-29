import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applySeo, DEFAULT_DESCRIPTION } from "@/lib/seo";

type SeoConfig = {
  title: string;
  description: string;
  robots?: string;
};

const STATIC_ROUTE_SEO: Record<string, SeoConfig> = {
  "/": {
    title: "BITE",
    description: DEFAULT_DESCRIPTION,
  },
  "/crew": {
    title: "Crew | BITE",
    description: "Meet the crew behind BITE and the life aboard S/Y Spritz.",
  },
  "/manifesto": {
    title: "Manifesto | BITE",
    description: "Read the values behind BITE: life at sea, intentional living, and independent storytelling.",
  },
  "/logbook": {
    title: "Logbook | BITE",
    description: "Explore voyages, refit notes, and stories from aboard S/Y Spritz.",
  },
  "/voyages": {
    title: "Voyages | BITE",
    description: "Browse public routes with departures, arrivals, dates, and waypoints from aboard S/Y Spritz.",
  },
  "/collaborations": {
    title: "Collaborations | BITE",
    description: "Partnerships, editorial work, and creative collaborations with BITE.",
  },
  "/contact": {
    title: "Contact | BITE",
    description: "Get in touch with BITE for collaborations, editorial projects, and updates from aboard.",
  },
  "/privacy-policy": {
    title: "Privacy Policy | BITE",
    description: "Privacy information for biteproject.it and related services.",
  },
  "/cookie-policy": {
    title: "Cookie Policy | BITE",
    description: "Cookie policy and technical information for biteproject.it.",
  },
  "/login": {
    title: "Login | BITE",
    description: "Access your BITE account.",
    robots: "noindex, nofollow",
  },
  "/signup": {
    title: "Sign Up | BITE",
    description: "Create your BITE account.",
    robots: "noindex, nofollow",
  },
  "/unsubscribe": {
    title: "Unsubscribe | BITE",
    description: "Manage your BITE email subscription preferences.",
    robots: "noindex, nofollow",
  },
};

const getSeoForPathname = (pathname: string): SeoConfig => {
  if (pathname.startsWith("/admin")) {
    return {
      title: "Admin | BITE",
      description: "Administrative area for BITE.",
      robots: "noindex, nofollow",
    };
  }

  if (pathname === "/profile" || pathname.startsWith("/profile/")) {
    return {
      title: "Profile | BITE",
      description: "BITE profile page.",
      robots: "noindex, nofollow",
    };
  }

  if (pathname.startsWith("/logbook/story/")) {
    return {
      title: "Story | BITE",
      description: "Story from the BITE logbook.",
    };
  }

  if (pathname.startsWith("/logbook/")) {
    return {
      title: "Logbook Article | BITE",
      description: "Article from the BITE logbook.",
    };
  }

  if (pathname.startsWith("/voyages/")) {
    return {
      title: "Voyage Route | BITE",
      description: "Public route page with departure, arrival, waypoints, and voyage dates.",
    };
  }

  return (
    STATIC_ROUTE_SEO[pathname] ?? {
      title: "BITE",
      description: DEFAULT_DESCRIPTION,
      robots: pathname === "/404" ? "noindex, nofollow" : "index, follow",
    }
  );
};

const SeoManager = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const seo = getSeoForPathname(pathname);
    applySeo({
      title: seo.title,
      description: seo.description,
      pathname,
      robots: seo.robots ?? "index, follow",
      type:
        pathname === "/logbook"
          || pathname === "/voyages"
          ? "collection"
          : pathname === "/"
            ? "website"
            : "website",
    });
  }, [pathname]);

  return null;
};

export default SeoManager;
