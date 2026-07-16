import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Map" },
  { to: "/methodology", label: "Methodology" },
  { to: "/sensors", label: "Sensors" },
  { to: "/downloads", label: "Downloads" },
  { to: "/collaborate", label: "Collaborate" },
];

const BITE_HOME_URL = "https://biteproject.it/";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const getBiteHomeHref = () => {
  if (typeof window === "undefined") return "/";
  return LOCAL_HOSTNAMES.has(window.location.hostname) ? "/" : BITE_HOME_URL;
};

// Same chrome as the main site's Navbar: one light shell over any hero, never a
// scroll-driven dark variant.
const NAV_SHELL = "nav-shell-light shadow-[0_28px_80px_rgba(15,23,42,0.12)]";
const NAV_TEXT = "text-slate-900";

const DataNavbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 pt-3 transition-[padding] duration-500 ease-out-expo md:px-6 md:pt-4">
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center justify-between rounded-[30px] px-5 md:h-[4.75rem] md:px-7",
          NAV_SHELL,
        )}
      >
        <a
          href={getBiteHomeHref()}
          className={cn(
            "flex items-baseline gap-2 font-serif text-xl font-bold tracking-widest transition-colors duration-500 md:text-2xl",
            NAV_TEXT,
          )}
        >
          <span>BITE</span>
          <span className="text-[10px] font-sans font-medium uppercase tracking-[0.2em] text-slate-700/80">
            Data
          </span>
        </a>

        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-7">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "rounded-full px-3 py-2 text-[13px] font-sans tracking-wide transition-[color,background-color,box-shadow,transform] duration-300 ease-out-expo active:scale-[0.98]",
                isActive(link.to)
                  ? cn("nav-chip-light font-medium", NAV_TEXT)
                  : "text-slate-700/80 hover:text-slate-900",
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className="w-px h-4 mx-2 bg-slate-900/12" />
          <a
            href="https://biteproject.it"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[13px] font-sans tracking-wide text-slate-700/80 transition-colors hover:text-slate-900"
          >
            BITE Project
            <ExternalLink size={11} />
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className={cn(
            "lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-full transition-all",
            "nav-chip-light shadow-[0_10px_28px_rgba(15,23,42,0.08)]",
            NAV_TEXT,
          )}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="absolute inset-x-0 top-full z-40 lg:hidden">
          <button
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <div className="nav-menu-light relative mx-4 mt-2 flex flex-col gap-1 rounded-[1.5rem] p-1.5 text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.16)]">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-xl px-4 py-3 text-sm font-sans transition-all",
                  isActive(link.to)
                    ? "nav-chip-light font-medium text-slate-950"
                    : "text-slate-700/80 hover:text-slate-900",
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="my-2 border-t border-slate-900/10" />
            <a
              href="https://biteproject.it"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-sans text-slate-700/80 transition-colors hover:text-slate-900"
            >
              BITE Project
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default DataNavbar;
