import { Link } from "react-router-dom";
import { Globe, Instagram, Youtube } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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
    icon: Globe,
  },
] as const;

const Footer = () => {
  const { t, lang } = useI18n();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-16">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10">
          {/* Brand */}
          <div className="max-w-sm">
            <h3 className="font-serif text-xl font-bold tracking-widest mb-3">BITE</h3>
            <p className="text-primary-foreground/60 text-sm leading-relaxed italic font-serif">
              {lang === "it"
                ? "Due umani, due cani, una barca vecchia e il coraggio di mollare gli ormeggi. Storie vere da chi vive il mare ogni giorno."
                : "Two humans, two dogs, an old boat, and the guts to cast off. Real stories from those who live the sea every day."}
            </p>
          </div>

          {/* Nav + Social inline */}
          <div className="flex gap-12 md:gap-16">
            <nav className="flex flex-col gap-2">
              <Link to="/crew" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.about")}</Link>
              <Link to="/manifesto" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.manifesto")}</Link>
              <Link to="/logbook" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.journal")}</Link>
              <Link to="/route" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.route")}</Link>
              <Link to="/collaborations" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.collaborations")}</Link>
              <Link to="/contact" className="text-xs text-primary-foreground/50 hover:text-primary-foreground transition-colors">{t("nav.contact")}</Link>
            </nav>
            <div className="flex flex-wrap items-center gap-3 self-start">
              {socialLinks.map(({ href, label, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/15 text-primary-foreground/50 transition-colors hover:border-primary-foreground/40 hover:text-primary-foreground"
                >
                  <Icon size={16} />
                  <span className="sr-only">{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-primary-foreground/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-[11px] text-primary-foreground/30">
            © {new Date().getFullYear()} BITE. {t("footer.rights")}
          </p>
          <p className="text-[11px] text-primary-foreground/30">
            {lang === "it" ? "Realizzato da" : "Made by"}{" "}
            <a
              href="https://www.pynkstudio.it"
              target="_blank"
              rel="noopener noreferrer"
              className="text-pink-400 hover:text-pink-300 transition-colors font-medium"
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
