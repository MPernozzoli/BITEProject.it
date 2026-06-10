import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Overview" },
  { to: "/data", label: "Data" },
  { to: "/map", label: "Map" },
  { to: "/missions", label: "Missions" },
  { to: "/sensors", label: "Sensors" },
  { to: "/methodology", label: "Methodology" },
  { to: "/downloads", label: "Downloads" },
  { to: "/collaborate", label: "Collaborate" },
];

const DataNavbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 pt-3 md:px-6 md:pt-4">
      <div
        className={cn(
          "mx-auto flex h-14 max-w-7xl items-center justify-between rounded-2xl px-4 md:h-16 md:px-6 transition-all duration-500",
          mobileOpen
            ? "glass-panel-dark border-white/16"
            : scrolled
              ? "glass-panel border-white/50"
              : "glass-panel-dark border-white/14"
        )}
      >
        {/* Logo */}
        <Link to="/" className={cn(
          "flex items-baseline gap-2 font-serif text-lg font-bold tracking-wider transition-colors",
          mobileOpen || !scrolled ? "text-primary-foreground" : "text-foreground"
        )}>
          <span>BITE</span>
          <span className={cn(
            "text-[10px] font-sans font-medium uppercase tracking-[0.2em]",
            mobileOpen || !scrolled ? "text-primary-foreground/60" : "text-muted-foreground"
          )}>Data</span>
        </Link>

        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12.5px] font-sans tracking-wide transition-all duration-300",
                scrolled
                  ? isActive(link.to)
                    ? "glass-chip text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                  : isActive(link.to)
                    ? "glass-chip-dark text-primary-foreground font-medium"
                    : "text-primary-foreground/70 hover:text-primary-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className={cn("w-px h-4 mx-2", scrolled ? "bg-border" : "bg-primary-foreground/20")} />
          <a
            href="https://biteproject.it"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-sans tracking-wide transition-colors",
              scrolled
                ? "text-muted-foreground hover:text-foreground"
                : "text-primary-foreground/60 hover:text-primary-foreground"
            )}
          >
            BITE Project
            <ExternalLink size={11} />
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className={cn(
            "lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border transition-all",
            mobileOpen
              ? "glass-chip-dark border-white/16 text-primary-foreground"
              : scrolled
                ? "glass-chip border-white/50 text-foreground"
                : "glass-chip-dark border-white/16 text-primary-foreground"
          )}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="absolute inset-x-0 top-full z-40 lg:hidden">
          <button
            className="fixed inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative mx-4 mt-2 glass-panel-dark rounded-2xl p-4 flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-xl px-4 py-3 text-sm font-sans transition-all",
                  isActive(link.to)
                    ? "glass-chip-dark text-primary-foreground font-medium"
                    : "text-primary-foreground/70 hover:text-primary-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t glass-divider my-2" />
            <a
              href="https://biteproject.it"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-sans text-primary-foreground/60 hover:text-primary-foreground"
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
