import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { navLinks, uiCopy } from "@/data/site";
import { cn } from "@/lib/utils";

export const Nav = () => {
  const [scrolled, setScrolled] = useState(false);
  const [heroComplete, setHeroComplete] = useState(false);
  const [open, setOpen] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById("top");
      const heroExit = hero ? hero.offsetTop + hero.offsetHeight - window.innerHeight : 0;
      setScrolled(window.scrollY > 24);
      setHeroComplete(!hero || window.scrollY >= heroExit - 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = open ? "hidden" : prev;
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 px-4 pt-3 transition-all duration-500 md:px-6 md:pt-4",
        heroComplete || open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-5 opacity-0",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-[1380px] items-center justify-between rounded-[30px] px-5 transition-all duration-500 md:h-[4.75rem] md:px-7",
          "nav-shell-dark shadow-[0_28px_80px_rgba(0,0,0,0.45)]",
          scrolled && "shadow-[0_32px_90px_rgba(0,0,0,0.55)]",
        )}
      >
        <a
          href="#top"
          className={cn(
            "group relative inline-flex flex-col gap-0.5 pr-4 font-serif text-lg font-semibold tracking-tight text-cream md:text-xl",
          )}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
        >
          <span className="inline-flex items-baseline gap-0 overflow-hidden whitespace-nowrap">
            <span className="transition-colors duration-300 group-hover:text-bronze">G</span>
            <span
              className={cn(
                "inline-block overflow-hidden transition-all duration-500 ease-out",
                logoHovered ? "max-w-[3.2em] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              odot
            </span>
            <span className="mx-0.5 text-bronze/90 italic transition-opacity duration-300 group-hover:opacity-100">
              &amp;
            </span>
            <span className="transition-colors duration-300 group-hover:text-bronze">F</span>
            <span
              className={cn(
                "inline-block overflow-hidden transition-all duration-500 ease-out delay-75",
                logoHovered ? "max-w-[3.5em] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              reyja
            </span>
          </span>
          <span
            className={cn(
              "font-sans text-[10px] font-medium uppercase tracking-[0.26em] text-muted-foreground transition-all duration-400",
              logoHovered ? "opacity-0 max-h-0" : "opacity-100 max-h-4",
            )}
          >
            BITE · PACK
          </span>
        </a>

        <div className="hidden items-center gap-1 lg:flex lg:gap-2">
          {navLinks.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={cn(
                "relative rounded-full px-3 py-2 font-sans text-[13px] tracking-wide text-cream/80 transition-colors duration-300 hover:text-cream",
                "after:absolute after:bottom-1 after:left-1/2 after:h-px after:w-0 after:-translate-x-1/2 after:bg-bronze after:transition-all after:duration-300 hover:after:w-[60%]",
              )}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden lg:block">
          <a
            href="#contact"
            className="glass-button inline-flex h-10 items-center justify-center gap-2 px-6 py-0"
          >
            {uiCopy.actions.contact}
            <ArrowRight size={14} className="opacity-90" />
          </a>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300",
              "nav-chip-dark text-cream",
            )}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-navigation"
          className="absolute inset-x-0 top-full z-40 mt-3 max-h-[min(85dvh,640px)] overflow-hidden px-4 md:px-6 lg:hidden"
        >
          <div
            className={cn(
              "mx-auto max-h-full overflow-y-auto rounded-[28px] border border-cream/10 p-5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300",
              "nav-menu-dark",
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="glass-chip-bronze inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-sans uppercase tracking-[0.24em] text-cream">
                <span className="h-1.5 w-1.5 rounded-full bg-cream/90" />
                {uiCopy.actions.navigate}
              </span>
            </div>
            <nav className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "group flex items-center justify-between gap-4 rounded-2xl border border-cream/10 px-4 py-4 transition-all duration-300",
                    "bg-cream/[0.04] hover:border-bronze/35 hover:bg-cream/[0.07]",
                  )}
                >
                  <div className="min-w-0 text-left">
                    <p className="font-serif text-xl leading-none text-cream">{link.label}</p>
                    <p className="mt-2 max-w-[16rem] font-sans text-xs leading-relaxed text-muted-foreground">
                      {uiCopy.navDescriptions[link.id as keyof typeof uiCopy.navDescriptions] ?? ""}
                    </p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cream/15 bg-cream/[0.06] text-cream/85 transition-transform duration-300 group-hover:translate-x-0.5">
                    <ArrowRight size={16} />
                  </span>
                </a>
              ))}
            </nav>
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="glass-button mt-5 flex h-12 w-full items-center justify-center gap-2"
            >
              {uiCopy.actions.contact}
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};
