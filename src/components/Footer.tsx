import { Link } from "react-router-dom";
import { Instagram, Youtube } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";

const TikTokIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const socialLinks = [
  {
    href: "https://www.instagram.com/better_is_the_end",
    label: "Instagram",
    icon: Instagram,
  },
  {
    href: "https://www.youtube.com/@better_is_the_end",
    label: "YouTube",
    icon: Youtube,
  },
  {
    href: "https://www.tiktok.com/@better_is_the_end",
    label: "TikTok",
    icon: TikTokIcon,
  },
  {
    href: "https://dashboard.seapeopleapp.com/group/41a0ad62-7f71-4107-9269-878fa210f24c?utm_source=SP&utm_medium=usershare&utm_campaign=mpernozzoli",
    label: "SeaPeople",
    icon: SeaPeopleIcon,
  },
] as const;

const Footer = () => {
  const { t, lang } = useI18n();

  return (
    <footer className="px-4 pb-4 pt-8 md:px-6 md:pb-6 md:pt-10">
      <div className="glass-panel max-w-7xl mx-auto rounded-[34px] px-6 py-10 md:px-10 md:py-12">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10">
          <div className="max-w-sm">
            <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Better Is The End
            </div>
            <h3 className="font-serif text-2xl font-bold tracking-[0.18em] mb-3 text-foreground">BITE</h3>
            <p className="text-foreground/68 text-sm leading-relaxed italic font-serif">
              {lang === "it"
                ? "Due umani, due cani, una barca vecchia e il coraggio di mollare gli ormeggi. Storie vere da chi vive il mare ogni giorno."
                : "Two humans, two dogs, an old boat, and the guts to cast off. Real stories from those who live the sea every day."}
            </p>
          </div>

          <div className="flex flex-col gap-8 md:items-end">
            <nav className="flex flex-wrap gap-2 md:justify-end">
              <Link to="/crew" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.about")}</Link>
              <Link to="/manifesto" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.manifesto")}</Link>
              <Link to="/logbook" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.journal")}</Link>
              <Link to="/route" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.route")}</Link>
              <Link to="/collaborations" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.collaborations")}</Link>
              <Link to="/contact" className="glass-chip px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">{t("nav.contact")}</Link>
            </nav>
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              {socialLinks.map(({ href, label, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Icon size={16} />
                  <span className="sr-only">{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t glass-divider flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground/70">
            <p>
              © {new Date().getFullYear()} BITE. {t("footer.rights")}
            </p>
            <Link to="/privacy-policy" className="hover:text-foreground transition-colors">
              {lang === "it" ? "Privacy Policy" : "Privacy Policy"}
            </Link>
            <Link to="/cookie-policy" className="hover:text-foreground transition-colors">
              {lang === "it" ? "Cookie Policy" : "Cookie Policy"}
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            {lang === "it" ? "Realizzato da" : "Made by"}{" "}
            <a
              href="https://www.pynkstudio.it"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-accent transition-colors font-medium"
            >
              PynkStudio
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
