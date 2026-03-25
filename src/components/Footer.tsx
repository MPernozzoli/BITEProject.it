import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

const Footer = () => {
  const { t } = useI18n();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          <div>
            <h3 className="font-serif text-2xl font-bold tracking-widest mb-4">BITE</h3>
            <p className="text-primary-foreground/70 text-sm leading-relaxed max-w-xs">
              {t("footer.tagline")}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link to="/crew" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.about")}</Link>
            <Link to="/manifesto" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.manifesto")}</Link>
            <Link to="/logbook" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.journal")}</Link>
            <Link to="/route" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.route")}</Link>
            <Link to="/collaborations" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.collaborations")}</Link>
            <Link to="/contact" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{t("nav.contact")}</Link>
          </div>

          <div className="flex flex-col gap-3">
            <a href="https://www.instagram.com/better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">Instagram</a>
            <a href="https://www.youtube.com/@better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">YouTube</a>
            <a href="https://www.tiktok.com/@better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">TikTok</a>
            <a href="https://dashboard.seapeopleapp.com/group/41a0ad62-7f71-4107-9269-878fa210f24c?utm_source=SP&utm_medium=usershare&utm_campaign=mpernozzoli" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">SeaPeople</a>
            <a href="mailto:hello@biteproject.com" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">hello@biteproject.com</a>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-primary-foreground/10">
          <p className="text-xs text-primary-foreground/40">
            © {new Date().getFullYear()} BITE. {t("footer.rights")}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
