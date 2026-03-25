import { useI18n } from "@/lib/i18n";
import dinghyCrew from "@/assets/dinghy-crew.jpg";
import boatSunset from "@/assets/boat-sunset.jpeg";
import dogsMarina from "@/assets/dogs-marina.jpeg";
import sailingCockpit from "@/assets/sailing-cockpit.jpeg";

const About = () => {
  const { t } = useI18n();

  return (
    <div>
      {/* Hero */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-8">
            {t("about.title")}
          </h1>
          <p className="editorial-body text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl">
            {t("about.intro")}
          </p>
        </div>
      </section>

      {/* Portrait Section */}
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

      {/* Why */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("about.why.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("about.why.text")}
          </p>
        </div>
      </section>

      {/* What */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("about.what.title")}</h2>
              <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
                {t("about.what.text")}
              </p>
            </div>
            <div className="aspect-[4/3] overflow-hidden">
              <img src={sailingCockpit} alt="Sailing" className="img-cover hover:scale-105 transition-transform duration-700" />
            </div>
          </div>
        </div>
      </section>

      {/* How */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("about.how.title")}</h2>
          <p className="editorial-body text-primary-foreground/80 text-lg leading-relaxed">
            {t("about.how.text")}
          </p>
        </div>
      </section>
    </div>
  );
};

export default About;
