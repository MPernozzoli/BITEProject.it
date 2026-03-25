import { useI18n } from "@/lib/i18n";
import { Heart } from "lucide-react";
import dinghyCrew from "@/assets/dinghy-crew.jpg";
import boatSunset from "@/assets/boat-sunset.jpeg";
import dogsMarina from "@/assets/dogs-marina.jpeg";
import sailingCockpit from "@/assets/sailing-cockpit.jpeg";
import boatHarbor from "@/assets/boat-harbor.jpeg";
import dogSailing from "@/assets/dog-sailing.jpeg";
import snowSami from "@/assets/snow-sami.jpeg";

const TheCrew = () => {
  const { t } = useI18n();

  return (
    <div>
      {/* Hero */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-8">
            {t("crew.title")}
          </h1>
          <p className="editorial-body text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl">
            {t("crew.intro")}
          </p>
        </div>
      </section>

      {/* Photo Grid */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="aspect-[4/5] overflow-hidden">
              <img src={dinghyCrew} alt="The crew" className="img-cover hover:scale-105 transition-transform duration-700" />
            </div>
            <div className="grid grid-rows-2 gap-4">
              <div className="overflow-hidden">
                <img src={dogsMarina} alt="Dogs at marina" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="overflow-hidden">
                <img src={boatSunset} alt="Spritz at sunset" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Project */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.project.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("crew.project.text")}
          </p>
        </div>
      </section>

      {/* Massimo & Sami */}
      <section className="page-section">
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

      {/* Dogs Section */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            <div className="aspect-[4/3] overflow-hidden">
              <img src={dogSailing} alt="Dogs on board" className="img-cover hover:scale-105 transition-transform duration-700" />
            </div>
            <div className="space-y-12">
              <div>
                <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.godot.title")}</h3>
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {t("crew.godot.text")}
                </p>
              </div>
              <div className="border-t border-border pt-8">
                <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.freya.title")}</h3>
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {t("crew.freya.text")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Snow Daisy — Ad Honorem */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="aspect-[3/4] overflow-hidden max-h-[500px] mx-auto lg:mx-0">
              <img src={snowSami} alt="Snow Daisy and Sami" className="img-cover" />
            </div>
            <div className="text-center lg:text-left">
              <Heart size={24} className="mx-auto lg:mx-0 mb-6 text-primary-foreground/50" />
              <p className="text-xs font-sans tracking-[0.3em] uppercase text-primary-foreground/50 mb-4">
                {t("crew.snow.subtitle")}
              </p>
              <h3 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.snow.title")}</h3>
              <p className="editorial-body text-primary-foreground/80 text-lg leading-relaxed">
                {t("crew.snow.text")}
              </p>
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
    </div>
  );
};

export default TheCrew;
