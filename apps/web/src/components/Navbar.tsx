import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, CalendarCheck, LogIn, LogOut, Menu, Shield, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileNotificationsMenu from "@/components/ProfileNotificationsMenu";
import { ThemeChoice, ThemeToggle } from "@/components/ThemeToggle";
import { getAdminUrl, getMainSiteUrl, isCurrentAdminHostname } from "@/lib/admin-host";
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
  "/collaborations": "'s collabs",
  "/contact": "'s contact",
};

const BITE_HOME_URL = "https://biteproject.it/";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const getBiteHomeHref = () => {
  if (typeof window === "undefined") return "/";
  return LOCAL_HOSTNAMES.has(window.location.hostname) ? "/" : BITE_HOME_URL;
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

  // Blocco dello scroll di fondo mentre il pannello è aperto. `overflow: hidden`
  // sul body basta su Android e desktop, ma Safari iOS lo ignora e continua a far
  // scorrere la pagina dietro il pannello. Lì serve `position: fixed`, che però
  // fa saltare la pagina in cima: si salva l'offset, lo si compensa con `top`
  // negativo e alla chiusura si torna dove si era.
  useEffect(() => {
    if (!mobileOpen) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
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

  const onAdminHost = isCurrentAdminHostname();

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
    "nav-shell-light shadow-[0_28px_80px_rgba(15,23,42,0.12)]";
  const navTextClass = "text-foreground";
  const mobileButtonClass =
    "nav-chip-light text-foreground shadow-[0_10px_28px_rgba(15,23,42,0.08)]";
  const authCardText =
    lang === "it"
      ? "Accedi per gestire profilo, contenuti e impostazioni."
      : "Sign in to manage profile, content, and settings.";

  return (
    <nav
      className={cn(
        // pt e px sommano la safe-area: con viewport-fit=cover il contenuto passa
        // sotto tacca e angoli arrotondati, e senza questo la barra ci finirebbe dentro.
        "fixed top-0 left-0 right-0 z-50 transition-[padding] duration-500 ease-out-expo",
        "px-[max(1rem,env(safe-area-inset-left))] pt-[max(0.75rem,env(safe-area-inset-top))]",
        "md:px-[max(1.5rem,env(safe-area-inset-left))] md:pt-[max(1rem,env(safe-area-inset-top))]",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center justify-between rounded-[30px] px-5 md:h-[4.75rem] md:px-7",
          navShellClass,
        )}
      >
        {/* Logo with hover expand */}
        <a
          href={getBiteHomeHref()}
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
              className={`inline-block overflow-hidden transition-[max-width,opacity] duration-500 ease-out-expo ${
                logoHovered ? "max-w-[4em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              etter&nbsp;
            </span>
            <span>I</span>
            <span
              className={`inline-block overflow-hidden transition-[max-width,opacity] duration-500 ease-out-expo delay-75 ${
                logoHovered ? "max-w-[2em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              s&nbsp;
            </span>
            <span>T</span>
            <span
              className={`inline-block overflow-hidden transition-[max-width,opacity] duration-500 ease-out-expo delay-100 ${
                logoHovered ? "max-w-[3em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              he&nbsp;
            </span>
            <span>E</span>
            <span
              className={`inline-block overflow-hidden transition-[max-width,opacity] duration-500 ease-out-expo delay-150 ${
                logoHovered ? "max-w-[3em] opacity-100" : "max-w-0 opacity-0"
              }`}
            >
              nd
            </span>
            <span
              className={`inline-block overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out-expo delay-500 ${
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
              className={`inline-block font-sans font-normal text-[0.55em] tracking-wider transition-[max-width,opacity,transform] duration-500 ease-out-expo ${
                logoHovered
                  ? "max-w-0 opacity-0 scale-95"
                  : "max-w-[12em] opacity-70 scale-100"
              } overflow-hidden whitespace-nowrap`}
            >
              {pageSubtitle}
            </span>
          )}
        </a>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-7">
          {links.map((link) => {
            const className = cn(
              "rounded-full px-3 py-2 text-[13px] font-sans tracking-wide transition-[color,background-color,box-shadow,transform] duration-300 ease-out-expo active:scale-[0.98]",
              navTextClass,
              isLinkActive(link.to)
                ? "nav-chip-light font-medium"
                : "text-foreground/70 hover:text-foreground",
            );

            return onAdminHost ? (
              <a key={link.to} href={getMainSiteUrl(link.to)} className={className}>
                {link.label}
              </a>
            ) : (
              <Link key={link.to} to={link.to} className={className}>
                {link.label}
              </Link>
            );
          })}

          <div className="mx-1 h-5 w-px bg-border" />

          <ThemeToggle className={cn("h-9 w-9", mobileButtonClass)} />

          {isGuest && (
            <button
              onClick={toggleLanguage}
              aria-label={languageToggleAriaLabel}
              className={cn(
                "rounded-full px-3.5 py-2 text-xs font-sans uppercase tracking-[0.24em] transition-colors",
                mobileButtonClass,
                "h-9 text-foreground/80 hover:text-foreground",
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
                    <span className="absolute right-0 top-0 h-3 w-3 rounded-full border border-glass-edge bg-destructive shadow-[0_0_0_2px_rgba(255,255,255,0.65)] dark:shadow-[0_0_0_2px_rgba(255,255,255,0.117)]" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="nav-menu-light mt-2 w-[22rem] rounded-[1.5rem] p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
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
                <DropdownMenuItem asChild>
                  <Link to="/bookings" className="flex items-center gap-2">
                    <CalendarCheck size={14} />
                    <span>{lang === "it" ? "Imbarchi" : "Boardings"}</span>
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <a href={getAdminUrl("/admin")} className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 text-center text-[10px] leading-[14px]">
                        ⚙
                      </span>
                      <span>Dashboard</span>
                    </a>
                  </DropdownMenuItem>
                )}
                <div className="px-2 py-1.5">
                  <ThemeChoice />
                </div>
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
                "text-foreground/80 hover:text-foreground",
              )}
            >
              {lang === "it" ? "Accedi" : "Login"}
            </Link>
          )}
        </div>

        {/* Mobile Toggle */}
        <div className="flex items-center gap-2.5 lg:hidden">
          <ThemeToggle className={cn("h-9 w-9 border", mobileButtonClass)} />

          {isGuest && (
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label={languageToggleAriaLabel}
              className={cn(
                "touch-target-44 inline-flex h-9 items-center rounded-full border px-3 text-[11px] font-semibold tracking-[0.24em] uppercase transition-[color,background-color,border-color,transform] duration-300 ease-out-expo active:scale-[0.98]",
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
                    "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border text-[10px] font-sans font-medium transition-[color,background-color,border-color,transform,opacity] duration-300 ease-out-expo active:scale-[0.98]",
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
                    <span className="absolute right-0 top-0 h-3 w-3 rounded-full border border-glass-edge bg-destructive shadow-[0_0_0_2px_rgba(255,255,255,0.65)] dark:shadow-[0_0_0_2px_rgba(255,255,255,0.117)]" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="glass-panel mt-2 w-[22rem] rounded-[1.5rem] border-glass-edge/55 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
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
                <DropdownMenuItem asChild>
                  <Link to="/bookings" className="flex items-center gap-2">
                    <CalendarCheck size={14} />
                    <span>{lang === "it" ? "Imbarchi" : "Boardings"}</span>
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <a href={getAdminUrl("/admin")} className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 text-center text-[10px] leading-[14px]">
                        ⚙
                      </span>
                      <span>Dashboard</span>
                    </a>
                  </DropdownMenuItem>
                )}
                <div className="px-2 py-1.5">
                  <ThemeChoice />
                </div>
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
              "inline-flex h-11 w-11 items-center justify-center rounded-full border transition-[color,background-color,border-color,transform] duration-300 ease-out-expo active:scale-[0.98]",
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
            className="absolute inset-0 bg-slate-900/18 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />

          <div className="nav-menu-light relative h-full overflow-y-auto border-t border-glass-edge/70 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-foreground shadow-2xl">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
              <div className="flex flex-col gap-3">
                {links.map((link) => {
                  const active = isLinkActive(link.to);
                  const className = cn(
                    "group flex items-center justify-between gap-4 rounded-[1.75rem] border px-4 py-4 transition-[border-color,background-color,transform,box-shadow] duration-300 ease-out-expo active:scale-[0.99]",
                    active
                      ? "nav-chip-light border-glass-edge/80 text-foreground shadow-[0_18px_44px_-32px_rgba(15,23,42,0.34)]"
                      : "border-glass-edge/70 bg-glass/48 text-foreground/90 hover:border-glass-edge hover:bg-glass/70",
                  );
                  const content = (
                    <>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "font-serif text-[1.85rem] leading-none",
                            active ? "text-foreground" : "text-foreground",
                          )}
                        >
                          {link.label}
                        </p>
                        <p
                          className={cn(
                            "mt-2 max-w-[18rem] text-sm leading-relaxed",
                            active ? "text-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          {link.description}
                        </p>
                      </div>

                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-[transform,color,background-color] duration-300 ease-out-expo group-hover:translate-x-0.5",
                          active
                            ? "border-foreground/10 bg-primary text-primary-foreground"
                            : "border-foreground/10 bg-glass/58 text-foreground/80 group-hover:border-foreground/16 group-hover:bg-glass/78",
                        )}
                      >
                        <ArrowRight size={18} />
                      </span>
                    </>
                  );

                  return onAdminHost ? (
                    <a key={link.to} href={getMainSiteUrl(link.to)} className={className}>
                      {content}
                    </a>
                  ) : (
                    <Link key={link.to} to={link.to} className={className}>
                      {content}
                    </Link>
                  );
                })}
              </div>

              <div className="nav-chip-light rounded-[1.75rem] p-4 shadow-[0_20px_54px_-38px_rgba(15,23,42,0.4)]">
                <p className="text-[0.65rem] font-sans uppercase tracking-[0.32em] text-muted-foreground">
                  Account
                </p>

                <ThemeChoice className="mt-3" />

                {authLoading ? (
                  <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted/60" />
                ) : session ? (
                  <>
                    <div className="mt-4 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-glass-edge/80 bg-glass/70">
                        <ProfileAvatar
                          name={displayName}
                          avatarUrl={displayAvatarUrl}
                          imgClassName="h-12 w-12 rounded-full object-cover"
                          fallback={initials}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-sans text-sm font-medium tracking-wide text-foreground">
                          {displayName}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {session.user.email}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      <Link
                        to="/profile"
                        className="flex items-center justify-between rounded-2xl border border-glass-edge/75 bg-glass/50 px-4 py-3 font-sans text-sm text-foreground/90 transition-colors hover:bg-glass/75"
                      >
                        <span className="flex items-center gap-3">
                          <User size={16} />
                          {lang === "it" ? "Profilo" : "Profile"}
                        </span>
                        <ArrowRight size={16} className="text-muted-foreground" />
                      </Link>

                      <Link
                        to="/bookings"
                        className="flex items-center justify-between rounded-2xl border border-glass-edge/75 bg-glass/50 px-4 py-3 font-sans text-sm text-foreground/90 transition-colors hover:bg-glass/75"
                      >
                        <span className="flex items-center gap-3">
                          <CalendarCheck size={16} />
                          {lang === "it" ? "Imbarchi" : "Boardings"}
                        </span>
                        <ArrowRight size={16} className="text-muted-foreground" />
                      </Link>

                      {isAdmin && (
                        <a
                          href={getAdminUrl("/admin")}
                          className="flex items-center justify-between rounded-2xl border border-glass-edge/75 bg-glass/50 px-4 py-3 font-sans text-sm text-foreground/90 transition-colors hover:bg-glass/75"
                        >
                          <span className="flex items-center gap-3">
                            <Shield size={16} />
                            Dashboard
                          </span>
                          <ArrowRight size={16} className="text-muted-foreground" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={toggleLanguage}
                        aria-label={languageToggleAriaLabel}
                        className="flex items-center justify-between rounded-2xl border border-glass-edge/75 bg-glass/50 px-4 py-3 text-left font-sans text-sm text-foreground/90 transition-colors hover:bg-glass/75"
                      >
                        <span>{languageToggleMenuLabel}</span>
                        <ArrowRight size={16} className="text-muted-foreground" />
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
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {authCardText}
                    </p>
                    <Link
                      to="/login"
                      className="mt-4 flex items-center justify-between rounded-2xl border border-foreground/10 bg-primary px-4 py-3 font-sans text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
