import { useI18n } from "@/lib/i18n";
import { Heart, Music } from "lucide-react";
import dinghyCrew from "@/assets/dinghy-crew.jpg";
import boatSunset from "@/assets/boat-sunset.jpeg";
import sailingCockpit from "@/assets/sailing-cockpit.jpeg";
import boatHarbor from "@/assets/boat-harbor.jpeg";
import godot from "@/assets/godot.jpeg";
import godotSnow from "@/assets/godot-snow.jpeg";
import snowSami from "@/assets/snow-sami.jpeg";
import duodji from "@/assets/duodji.jpeg";
import freya from "@/assets/freya.jpeg";

const TheCrew = () => {
  const { t } = useI18n();

  return (
    <div>
      {/* Hero with crew photo */}
      <section className="relative min-h-[70vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img src={dinghyCrew} alt="The crew" className="img-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/30 to-transparent" />
        </div>
        <div className="relative z-10 px-6 md:px-12 pb-16 md:pb-24 max-w-4xl">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl text-primary-foreground mb-4">
            {t("crew.title")}
          </h1>
          <p className="editorial-body text-lg md:text-xl text-primary-foreground/80 leading-relaxed max-w-2xl">
            {t("crew.intro")}
          </p>
        </div>
      </section>

      {/* The Project */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.project.title")}</h2>
              <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
                {t("crew.project.text")}
              </p>
            </div>
            <div className="aspect-[4/3] overflow-hidden">
              <img src={duodji} alt="Duodji — the camper" className="img-cover hover:scale-105 transition-transform duration-700 object-bottom" />
            </div>
          </div>
        </div>
      </section>

      {/* Massimo & Sami */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20">
            <div className="border-t border-border pt-8">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.massimo.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.massimo.text")}
              </p>
            </div>
            <div className="border-t border-border pt-8">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.sami.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.sami.text")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Godot */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="aspect-[4/3] overflow-hidden">
              <img src={godot} alt="Godot" className="img-cover hover:scale-105 transition-transform duration-700" />
            </div>
            <div>
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.godot.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.godot.text")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Freya */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="order-2 lg:order-1">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.freya.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.freya.text")}
              </p>
            </div>
            <div className="aspect-[4/3] overflow-hidden order-1 lg:order-2">
              <img src={freya} alt="Freya" className="img-cover hover:scale-105 transition-transform duration-700" />
            </div>
          </div>
        </div>
      </section>

      {/* Snow Daisy — Ad Honorem */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-narrow text-center mb-12">
          <Heart size={24} className="mx-auto mb-6 text-primary-foreground/40" />
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-primary-foreground/40 mb-4">
            {t("crew.snow.subtitle")}
          </p>
          <h3 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.snow.title")}</h3>
          <p className="editorial-body text-primary-foreground/75 text-lg leading-relaxed max-w-2xl mx-auto">
            {t("crew.snow.text")}
          </p>
        </div>
        <div className="page-section-wide">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="aspect-[3/4] overflow-hidden max-h-[520px] mx-auto w-full">
              <img src={snowSami} alt="Snow Daisy and Sami" className="img-cover" />
            </div>
            <div className="aspect-[3/4] overflow-hidden max-h-[520px] mx-auto w-full">
              <img src={godotSnow} alt="Godot and Snow Daisy" className="img-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* Spritz */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.spritz.title")}</h2>
              <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
                {t("crew.spritz.text")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="aspect-[3/4] overflow-hidden">
                <img src={boatHarbor} alt="Spritz in harbor" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="aspect-[3/4] overflow-hidden mt-8">
                <img src={sailingCockpit} alt="Sailing cockpit" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Full width closing image */}
      <section className="h-[40vh] md:h-[50vh] overflow-hidden">
        <img src={boatSunset} alt="Spritz at sunset" className="img-cover object-bottom" />
      </section>
    </div>
  );
};

export default TheCrew;
