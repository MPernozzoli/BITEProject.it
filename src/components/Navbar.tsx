import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Menu, X, User, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SUBTITLES: Record<string, { en: string; it: string }> = {
  "/logbook": { en: "'s Logbook", it: "'s Diario" },
  "/crew": { en: "'s Crew", it: "'s Ciurma" },
  "/manifesto": { en: "'s Manifesto", it: "'s Manifesto" },
  "/collaborations": { en: "'s Collabs", it: "'s Collabs" },
  "/contact": { en: "'s Contact", it: "'s Contatti" },
};

const Navbar = () => {
  const { t, lang, setLang } = useI18n();
  const { session, isAdmin } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<{ name: string; avatar_url: string | null } | null>(null);
  const [logoHovered, setLogoHovered] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pageSubtitle = PAGE_SUBTITLES[location.pathname]?.[lang] || null;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      return;
    }
    void loadProfile(userId);
  }, [session?.user?.id]);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", userId)
      .single();
    if (data) setProfile(data);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    navigate("/");
  };

  const links = [
    { to: "/crew", label: t("nav.about") },
    { to: "/manifesto", label: t("nav.manifesto") },
    { to: "/logbook", label: t("nav.journal") },
    { to: "/collaborations", label: t("nav.collaborations") },
    { to: "/contact", label: t("nav.contact") },
  ];

  const initials = profile?.name
    ? profile.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/95 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-gradient-to-b from-black/60 via-black/30 to-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16 md:h-20">
        {/* Logo with hover expand */}
        <Link
          to="/"
          className={`relative font-serif text-xl md:text-2xl font-bold tracking-widest overflow-hidden transition-colors duration-500 ${scrolled ? "text-foreground" : "text-white"}`}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
        >
          <span className="inline-flex items-baseline whitespace-nowrap">
            <span>B</span>
            <span
              className={`inline-block overflow-hidden transition-all duration-500 ease-out ${
                logoHovered ? "max-w-[4em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              etter&nbsp;
            </span>
            <span>I</span>
            <span
              className={`inline-block overflow-hidden transition-all duration-500 ease-out delay-75 ${
                logoHovered ? "max-w-[2em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              s&nbsp;
            </span>
            <span>T</span>
            <span
              className={`inline-block overflow-hidden transition-all duration-500 ease-out delay-100 ${
                logoHovered ? "max-w-[3em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              he&nbsp;
            </span>
            <span>E</span>
            <span
              className={`inline-block overflow-hidden transition-all duration-500 ease-out delay-150 ${
                logoHovered ? "max-w-[3em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              nd
            </span>
            <span
              className={`inline-block transition-all duration-300 delay-500 ${
                logoHovered
                  ? "opacity-100 translate-y-0 scale-110 text-accent"
                  : "opacity-0 -translate-y-2 scale-75"
              }`}
            >
              !
            </span>
          </span>
          {/* Dynamic page subtitle — hidden during hover expand */}
          {pageSubtitle && (
            <span
              className={`inline-block font-sans font-normal text-[0.55em] tracking-wider uppercase transition-all duration-400 ease-out ${
                logoHovered
                  ? "max-w-0 opacity-0 scale-95"
                  : "max-w-[12em] opacity-70 scale-100"
              } overflow-hidden whitespace-nowrap`}
            >
              {pageSubtitle}
            </span>
          )}
        </Link>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-7">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-[13px] font-sans tracking-wide transition-colors duration-300 hover:text-accent ${
                scrolled
                  ? location.pathname === link.to ? "text-foreground font-medium" : "text-muted-foreground"
                  : location.pathname === link.to ? "text-white font-medium" : "text-white/75"
              }`}
            >
              {link.label}
            </Link>
          ))}

          <div className={`w-px h-5 mx-1 ${scrolled ? "bg-border" : "bg-white/30"}`} />

          <button
            onClick={() => setLang(lang === "en" ? "it" : "en")}
            className={`text-xs font-sans tracking-widest transition-colors uppercase px-3 py-1 rounded-sm ${
              scrolled
                ? "text-muted-foreground hover:text-foreground border border-border"
                : "text-white/75 hover:text-white border border-white/30"
            }`}
          >
            {lang === "en" ? "IT" : "EN"}
          </button>

          {/* User menu */}
          {session ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-sans font-medium tracking-wide hover:opacity-90 transition-opacity focus:outline-none">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    initials
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2">
                    <User size={14} />
                    <span>{lang === "it" ? "Profilo" : "Profile"}</span>
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 text-center text-[10px] leading-[14px]">⚙</span>
                      <span>Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-destructive focus:text-destructive">
                  <LogOut size={14} />
                  <span>{lang === "it" ? "Esci" : "Logout"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/login"
              className={`text-xs font-sans tracking-wide transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}
            >
              {lang === "it" ? "Accedi" : "Login"}
            </Link>
          )}
        </div>

        {/* Mobile Toggle */}
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={() => setLang(lang === "en" ? "it" : "en")}
            className={`text-xs font-sans tracking-widest uppercase ${scrolled ? "text-muted-foreground" : "text-white/75"}`}
          >
            {lang === "en" ? "IT" : "EN"}
          </button>

          {session && (
            <Link to="/profile" className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-[10px] font-sans font-medium">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                initials
              )}
            </Link>
          )}

          <button onClick={() => setMobileOpen(!mobileOpen)} className={scrolled ? "text-foreground" : "text-white"}>
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-b border-border">
          <div className="px-6 py-8 flex flex-col gap-5">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`font-serif text-2xl transition-colors ${
                  location.pathname === link.to ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="h-px bg-border my-2" />
            {session ? (
              <>
                <Link to="/profile" className="font-sans text-base text-muted-foreground hover:text-foreground transition-colors">
                  {lang === "it" ? "Profilo" : "Profile"}
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="font-sans text-base text-muted-foreground hover:text-foreground transition-colors">
                    Dashboard
                  </Link>
                )}
                <button onClick={handleLogout} className="font-sans text-base text-destructive text-left">
                  {lang === "it" ? "Esci" : "Logout"}
                </button>
              </>
            ) : (
              <Link to="/login" className="font-sans text-base text-accent hover:text-foreground transition-colors">
                {lang === "it" ? "Accedi" : "Login"}
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
