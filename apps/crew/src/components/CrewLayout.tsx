import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Anchor, ExternalLink, Menu, PenLine, UserCircle, Vote, Waves, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const mainSiteUrl = () => {
  if (typeof window === "undefined") return "https://biteproject.it";
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname)
    ? "/"
    : "https://biteproject.it";
};

const mainProfileUrl = () => {
  if (typeof window === "undefined") return "https://biteproject.it/profile";
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname)
    ? "/profile"
    : "https://biteproject.it/profile";
};

const CrewLayout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (mounted) setIsAdmin(false);
        return;
      }
      const { data } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
      if (mounted) setIsAdmin(Boolean(data));
    };
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void load(), 0);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const nav = (
    <>
      <Link className="rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" to="/">
        Crew Pass
      </Link>
      <Link className="rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" to="/feed">
        Feed
      </Link>
      <Link className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" to="/live">
        <Waves size={14} />
        Live
      </Link>
      <Link className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" to="/polls">
        <Vote size={14} />
        Polls
      </Link>
      <a className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" href={mainProfileUrl()}>
        <UserCircle size={14} />
        Profilo
      </a>
      {isAdmin && (
        <Link className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950" to="/studio">
          <PenLine size={14} />
          Studio
        </Link>
      )}
      <a
        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-700 transition-colors hover:text-slate-950"
        href={mainSiteUrl()}
      >
        BITE Project
        <ExternalLink size={13} />
      </a>
    </>
  );

  return (
    <div className="site-shell min-h-[100dvh] flex flex-col">
      <div className="site-shell__ambient" aria-hidden>
        <span className="site-shell__orb site-shell__orb--one" />
        <span className="site-shell__orb site-shell__orb--two" />
        <span className="site-shell__orb site-shell__orb--three" />
      </div>
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 md:px-6 md:pt-4">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-[30px] border border-white/50 bg-white/78 px-5 text-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl md:h-[4.75rem] md:px-7">
          <Link to="/" className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white">
              <Anchor size={18} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-xl font-bold tracking-widest md:text-2xl">BITE</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-600">Crew</span>
            </span>
          </Link>
          <div className="hidden items-center gap-3 lg:flex">{nav}</div>
          <button
            type="button"
            aria-label={mobileOpen ? "Chiudi menu" : "Apri menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-950 shadow-[0_10px_28px_rgba(15,23,42,0.08)] lg:hidden"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>
        {mobileOpen && (
          <div className="absolute inset-x-0 top-full z-40 lg:hidden">
            <button className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Chiudi menu" />
            <div className={cn("relative mx-4 mt-2 flex flex-col rounded-3xl p-2", "border border-white/50 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl")}>
              {nav}
            </div>
          </div>
        )}
      </header>
      <main id="content" tabIndex={-1} className="relative flex-1 pt-24 md:pt-28">
        {children}
      </main>
      <footer className="relative px-4 py-8 text-center text-xs text-slate-500">
        BITE Crew è in costruzione privata. Nessun link è esposto sul sito principale.
      </footer>
    </div>
  );
};

export default CrewLayout;
