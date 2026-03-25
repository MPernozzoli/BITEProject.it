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
    <div>
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("collab.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("collab.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Who */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.who.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.who.text")}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="page-section">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.content.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.content.text")}
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.values.title")}</h2>
          <p className="editorial-body text-primary-foreground/80 text-lg leading-relaxed">
            {t("collab.values.text")}
          </p>
        </div>
      </section>

      {/* Areas */}
      <section className="page-section">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-12">{t("collab.areas.title")}</h2>
          <div className="space-y-0">
            {areas.map((area, i) => (
              <div key={i} className="py-5 border-b border-border flex items-center gap-4">
                <span className="text-xs text-muted-foreground/40 w-8">{String(i + 1).padStart(2, "0")}</span>
                <p className="editorial-body text-lg">{lang === "en" ? area.en : area.it}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow text-center">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-6 whitespace-pre-line">
            {t("collab.title")}
          </h2>
          <p className="editorial-body text-muted-foreground text-lg mb-10 max-w-lg mx-auto">
            {t("collab.text")}
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors"
          >
            {t("collab.cta")} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Collaborations;
