import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, LogIn, LogOut, Menu, Shield, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileNotificationsMenu from "@/components/ProfileNotificationsMenu";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SUBTITLES: Record<string, string> = {
  "/logbook": "'s logbook",
  "/crew": "'s crew",
  "/manifesto": "'s manifesto",
  "/collaborations": "'s collabs",
  "/contact": "'s contact",
};

const Navbar = () => {
  const { t, lang, setLang } = useI18n();
  const { session, isAdmin, loading: authLoading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<{
    name: string;
    avatar_url: string | null;
  } | null>(null);
  const [logoHovered, setLogoHovered] = useState(false);
  const [desktopProfileMenuOpen, setDesktopProfileMenuOpen] = useState(false);
  const [mobileProfileMenuOpen, setMobileProfileMenuOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  const pageSubtitle =
    PAGE_SUBTITLES[location.pathname] ||
    Object.entries(PAGE_SUBTITLES).find(([path]) =>
      location.pathname.startsWith(`${path}/`),
    )?.[1] ||
    null;

  useEffect(() => {
    setMobileOpen(false);
    setDesktopProfileMenuOpen(false);
    setMobileProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = mobileOpen ? "hidden" : previousOverflow;

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      setUnreadNotificationCount(0);
      return;
    }
    void loadProfile(userId);
  }, [session?.user?.id]);

  const loadProfile = async (userId: string) => {
    setProfile(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data) setProfile(data);
  };

  const meta = session?.user?.user_metadata as
    | Record<string, string | undefined>
    | undefined;
  const displayAvatarUrl =
    profile?.avatar_url || meta?.avatar_url || meta?.picture;
  const displayName =
    profile?.name?.trim() ||
    meta?.full_name ||
    meta?.name ||
    session?.user?.email?.split("@")[0] ||
    "";
  const initials = displayName
    ? displayName
        .split(/\s+/)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : (session?.user?.email?.[0]?.toUpperCase() ?? "?");
  const isGuest = !authLoading && !session;
  const toggleLanguage = () => setLang(lang === "en" ? "it" : "en");
  const languageToggleAriaLabel =
    lang === "en" ? "Switch to Italian" : "Passa all'inglese";
  const languageToggleMenuLabel =
    lang === "en" ? "Switch to Italian" : "Passa all'inglese";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    navigate("/");
  };

  const isLinkActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(`${to}/`);

  const links = [
    {
      to: "/crew",
      label: t("nav.about"),
      description:
        lang === "it"
          ? "Chi siamo, come viviamo e cosa stiamo costruendo."
          : "Who we are, how we live, and what we are building.",
    },
    {
      to: "/manifesto",
      label: t("nav.manifesto"),
      description:
        lang === "it"
          ? "Principi, metodo e scelte che guidano il progetto."
          : "Principles, methods, and choices that guide the project.",
    },
    {
      to: "/logbook",
      label: t("nav.journal"),
      description:
        lang === "it"
          ? "Articoli, note tecniche e storie dal bordo."
          : "Articles, technical notes, and stories from aboard.",
    },
    {
      to: "/collaborations",
      label: t("nav.collaborations"),
      description:
        lang === "it"
          ? "Brand fit, partnership e lavori che hanno senso."
          : "Brand fit, partnerships, and work that actually make sense.",
    },
    {
      to: "/contact",
      label: t("nav.contact"),
      description:
        lang === "it"
          ? "Messaggi, collaborazioni e richieste dirette."
          : "Messages, partnerships, and direct requests.",
    },
  ];

  const navShellClass =
    "glass-panel border-white/60 shadow-[0_26px_80px_rgba(15,23,42,0.14)]";
  const navTextClass = "nav-adaptive-ink";
  const mobileButtonClass =
    "glass-chip nav-adaptive-ink border-white/60 shadow-sm";
  const authCardText =
    lang === "it"
      ? "Accedi per gestire profilo, contenuti e impostazioni."
      : "Sign in to manage profile, content, and settings.";

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 px-4 pt-3 transition-all duration-500 md:px-6 md:pt-4",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center justify-between rounded-[30px] px-5 md:h-[4.75rem] md:px-7",
          navShellClass,
        )}
      >
        {/* Logo with hover expand */}
        <Link
          to="/"
          className={cn(
            "relative inline-flex items-baseline gap-0 overflow-hidden font-serif text-xl font-bold tracking-widest transition-colors duration-500 md:text-2xl",
            navTextClass,
          )}
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
              className={`inline-block overflow-hidden transition-all duration-300 delay-500 ${
                logoHovered
                  ? "max-w-[0.7em] opacity-100 translate-y-0 scale-110 text-current"
                  : "max-w-0 opacity-0 -translate-y-2 scale-75"
              }`}
            >
              !
            </span>
          </span>
          {/* Dynamic page subtitle — hidden during hover expand */}
          {pageSubtitle && (
            <span
              className={`inline-block font-sans font-normal text-[0.55em] tracking-wider transition-all duration-400 ease-out ${
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
              className={cn(
                "rounded-full px-3 py-2 text-[13px] font-sans tracking-wide transition-all duration-300",
                navTextClass,
                isLinkActive(link.to)
                  ? "glass-chip font-medium"
                  : "opacity-72 hover:opacity-100",
              )}
            >
              {link.label}
            </Link>
          ))}

          <div
            className="nav-adaptive-divider mx-1 h-5 w-px"
          />

          {isGuest && (
            <button
              onClick={toggleLanguage}
              aria-label={languageToggleAriaLabel}
              className={cn(
                "rounded-full px-3.5 py-2 text-xs font-sans uppercase tracking-[0.24em] transition-colors",
                mobileButtonClass,
                "h-9 opacity-80 hover:opacity-100",
              )}
            >
              {lang.toUpperCase()}
            </button>
          )}

          {/* User menu — in attesa del bootstrap auth non mostrare uno stato “loggato” incoerente */}
          {authLoading ? (
            <div
              className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0"
              aria-hidden
            />
          ) : session ? (
            <DropdownMenu open={desktopProfileMenuOpen} onOpenChange={setDesktopProfileMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-xs font-sans font-medium tracking-wide transition-opacity focus:outline-none shrink-0",
                    mobileButtonClass,
                  )}
                >
                  <ProfileAvatar
                    name={displayName}
                    avatarUrl={displayAvatarUrl}
                    imgClassName="w-8 h-8 rounded-full object-cover"
                    fallback={initials}
                  />
                  {unreadNotificationCount > 0 ? (
                    <span className="absolute right-0 top-0 h-3 w-3 rounded-full border border-white bg-destructive shadow-[0_0_0_2px_rgba(255,255,255,0.65)]" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
              className="glass-panel mt-2 w-[22rem] rounded-[1.5rem] border-white/55 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
              >
                <ProfileNotificationsMenu
                  sessionUserId={session.user.id}
                  lang={lang === "en" ? "en" : "it"}
                  open={desktopProfileMenuOpen}
                  onNavigate={() => setDesktopProfileMenuOpen(false)}
                  onUnreadChange={setUnreadNotificationCount}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2">
                    <User size={14} />
                    <span>{lang === "it" ? "Profilo" : "Profile"}</span>
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 text-center text-[10px] leading-[14px]">
                        ⚙
                      </span>
                      <span>Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={toggleLanguage}>
                  <span>{languageToggleMenuLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut size={14} />
                  <span>{lang === "it" ? "Esci" : "Logout"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/login"
              className={cn(
                "rounded-full px-3.5 py-2 text-xs font-sans tracking-wide transition-colors",
                mobileButtonClass,
                "opacity-80 hover:opacity-100",
              )}
            >
              {lang === "it" ? "Accedi" : "Login"}
            </Link>
          )}
        </div>

        {/* Mobile Toggle */}
        <div className="flex items-center gap-2.5 lg:hidden">
          {isGuest && (
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label={languageToggleAriaLabel}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3 text-[11px] font-semibold tracking-[0.24em] uppercase transition-all duration-300",
                mobileButtonClass,
              )}
            >
              {lang.toUpperCase()}
            </button>
          )}

          {!authLoading && session && (
            <DropdownMenu open={mobileProfileMenuOpen} onOpenChange={setMobileProfileMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border text-[10px] font-sans font-medium transition-all duration-300",
                    mobileButtonClass,
                  )}
                >
                  <ProfileAvatar
                    name={displayName}
                    avatarUrl={displayAvatarUrl}
                    imgClassName="h-9 w-9 rounded-full object-cover"
                    fallback={initials}
                  />
                  {unreadNotificationCount > 0 ? (
                    <span className="absolute right-0 top-0 h-3 w-3 rounded-full border border-white bg-destructive shadow-[0_0_0_2px_rgba(255,255,255,0.65)]" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="glass-panel mt-2 w-[22rem] rounded-[1.5rem] border-white/55 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
              >
                <ProfileNotificationsMenu
                  sessionUserId={session.user.id}
                  lang={lang === "en" ? "en" : "it"}
                  open={mobileProfileMenuOpen}
                  onNavigate={() => setMobileProfileMenuOpen(false)}
                  onUnreadChange={setUnreadNotificationCount}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2">
                    <User size={14} />
                    <span>{lang === "it" ? "Profilo" : "Profile"}</span>
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 text-center text-[10px] leading-[14px]">
                        ⚙
                      </span>
                      <span>Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={toggleLanguage}>
                  <span>{languageToggleMenuLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut size={14} />
                  <span>{lang === "it" ? "Esci" : "Logout"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            aria-label={
              mobileOpen
                ? lang === "it"
                  ? "Chiudi menu"
                  : "Close menu"
                : lang === "it"
                  ? "Apri menu"
                  : "Open menu"
            }
            onClick={() => setMobileOpen(!mobileOpen)}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-300",
              mobileButtonClass,
            )}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div
          id="mobile-navigation"
          className="absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] lg:hidden md:h-[calc(100dvh-5rem)]"
        >
          <button
            type="button"
            aria-label={
              lang === "it"
                ? "Chiudi il pannello di navigazione"
                : "Close navigation panel"
            }
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />

          <div className="relative h-full overflow-y-auto border-t border-white/10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_38%),linear-gradient(180deg,rgba(25,37,58,0.98)_0%,rgba(17,27,42,0.98)_55%,rgba(12,21,34,1)_100%)] px-5 pb-6 pt-5 text-white shadow-2xl">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
              <div className="flex flex-col gap-3">
                {links.map((link) => {
                  const active = isLinkActive(link.to);

                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                        className={cn(
                        "group flex items-center justify-between gap-4 rounded-[1.75rem] border px-4 py-4 transition-all duration-300",
                        active
                          ? "glass-chip border-white/0 text-navy shadow-[0_24px_60px_-36px_rgba(255,255,255,0.65)]"
                          : "glass-chip-dark border-white/12 text-white hover:border-white/22",
                      )}
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "font-serif text-[1.85rem] leading-none",
                            active ? "text-navy" : "text-white",
                          )}
                        >
                          {link.label}
                        </p>
                        <p
                          className={cn(
                            "mt-2 max-w-[18rem] text-sm leading-relaxed",
                            active ? "text-navy/70" : "text-white/65",
                          )}
                        >
                          {link.description}
                        </p>
                      </div>

                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all duration-300 group-hover:translate-x-0.5",
                          active
                            ? "border-navy/10 bg-navy text-white"
                            : "border-white/10 bg-white/[0.06] text-white/82 group-hover:border-white/20 group-hover:bg-white/[0.1]",
                        )}
                      >
                        <ArrowRight size={18} />
                      </span>
                    </Link>
                  );
                })}
              </div>

              <div className="glass-panel-dark rounded-[1.75rem] border-white/12 p-4 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.95)]">
                <p className="text-[0.65rem] font-sans uppercase tracking-[0.32em] text-white/55">
                  Account
                </p>

                {authLoading ? (
                  <div className="mt-4 h-24 animate-pulse rounded-2xl bg-white/10" />
                ) : session ? (
                  <>
                    <div className="mt-4 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10">
                        <ProfileAvatar
                          name={displayName}
                          avatarUrl={displayAvatarUrl}
                          imgClassName="h-12 w-12 rounded-full object-cover"
                          fallback={initials}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-sans text-sm font-medium tracking-wide text-white">
                          {displayName}
                        </p>
                        <p className="truncate text-sm text-white/58">
                          {session.user.email}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      <Link
                        to="/profile"
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 font-sans text-sm text-white/88 transition-colors hover:bg-white/[0.09]"
                      >
                        <span className="flex items-center gap-3">
                          <User size={16} />
                          {lang === "it" ? "Profilo" : "Profile"}
                        </span>
                        <ArrowRight size={16} className="text-white/55" />
                      </Link>

                      {isAdmin && (
                        <Link
                          to="/admin"
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 font-sans text-sm text-white/88 transition-colors hover:bg-white/[0.09]"
                        >
                          <span className="flex items-center gap-3">
                            <Shield size={16} />
                            Dashboard
                          </span>
                          <ArrowRight size={16} className="text-white/55" />
                        </Link>
                      )}

                      <button
                        type="button"
                        onClick={toggleLanguage}
                        aria-label={languageToggleAriaLabel}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left font-sans text-sm text-white/88 transition-colors hover:bg-white/[0.09]"
                      >
                        <span>{languageToggleMenuLabel}</span>
                        <ArrowRight size={16} className="text-white/55" />
                      </button>

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center justify-between rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-left font-sans text-sm text-red-100 transition-colors hover:bg-red-500/15"
                      >
                        <span className="flex items-center gap-3">
                          <LogOut size={16} />
                          {lang === "it" ? "Esci" : "Logout"}
                        </span>
                        <ArrowRight size={16} className="text-red-100/70" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-white/68">
                      {authCardText}
                    </p>
                    <Link
                      to="/login"
                      className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white px-4 py-3 font-sans text-sm font-medium text-navy transition-colors hover:bg-white/90"
                    >
                      <span className="flex items-center gap-3">
                        <LogIn size={16} />
                        {lang === "it" ? "Accedi" : "Login"}
                      </span>
                      <ArrowRight size={16} />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
