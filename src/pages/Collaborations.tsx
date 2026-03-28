import { useI18n } from "@/lib/i18n";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const areas = [
  { en: "Sailing gear & hardware", it: "Attrezzatura e ferramenta nautica" },
  { en: "Technical & marine electronics", it: "Elettronica tecnica e marina" },
  { en: "Remote work tools & connectivity", it: "Strumenti per lavoro remoto e connettività" },
  { en: "Expedition & technical clothing", it: "Abbigliamento tecnico e da spedizione" },
  { en: "Pet gear for life aboard", it: "Attrezzatura per animali a bordo" },
  { en: "Sustainability, repair & self-sufficiency", it: "Sostenibilità, riparazione e autosufficienza" },
  { en: "Photography & video equipment", it: "Attrezzatura fotografica e video" },
];

const Collaborations = () => {
  const { t, lang } = useI18n();

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="pt-28 pb-0 md:pt-32 px-6 md:px-12">
        <div className="page-section-narrow glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <p className="glass-chip inline-flex px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-accent mb-6">
            {t("nav.collaborations")}
          </p>
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("collab.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("collab.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Who */}
      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel rounded-[34px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.who.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.who.text")}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel rounded-[34px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.content.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.content.text")}
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-dark rounded-[34px] px-6 py-10 text-white md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.values.title")}</h2>
          <p className="editorial-body text-white/74 text-lg leading-relaxed">
            {t("collab.values.text")}
          </p>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel rounded-[34px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-12">{t("collab.areas.title")}</h2>
          <div className="space-y-3">
            {areas.map((area, i) => (
              <div key={i} className="glass-panel-soft rounded-[24px] px-4 py-4 flex items-center gap-4">
                <span className="glass-chip inline-flex h-9 min-w-9 items-center justify-center text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <p className="editorial-body text-lg">{lang === "en" ? area.en : area.it}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-dark rounded-[34px] px-6 py-10 text-center text-white md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-6 whitespace-pre-line">
            {t("collab.title")}
          </h2>
          <p className="editorial-body text-white/70 text-lg mb-10 max-w-lg mx-auto">
            {t("collab.text")}
          </p>
          <Link
            to="/contact"
            className="glass-button inline-flex items-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
          >
            {t("collab.cta")} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Collaborations;
