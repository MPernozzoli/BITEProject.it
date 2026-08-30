import { useI18n } from "@/lib/i18n";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const collaborationTypes = [
  {
    en: "Field research at sea",
    it: "Ricerca sul campo in mare",
    text: {
      en: "We can host or support observation work, sampling protocols, citizen-science projects and data stories connected to routes, coastal habitats and life aboard.",
      it: "Possiamo ospitare o supportare osservazioni, protocolli di campionamento, progetti di citizen science e storie basate su dati legati alle rotte, agli habitat costieri e alla vita a bordo.",
    },
  },
  {
    en: "Editorial and creator projects",
    it: "Progetti editoriali e creator",
    text: {
      en: "We are open to formats with other creators, photographers, writers, filmmakers and communities, including projects that are not strictly nautical.",
      it: "Siamo aperti a formati con altri creator, fotografi, autori, filmmaker e community, anche quando il progetto non è strettamente nautico.",
    },
  },
  {
    en: "Brands, tools and services",
    it: "Brand, strumenti e servizi",
    text: {
      en: "Products and services are welcome when there is a real reason to bring them aboard, test them honestly and tell what happens without a forced script.",
      it: "Prodotti e servizi sono benvenuti quando esiste un motivo reale per portarli a bordo, provarli con onestà e raccontare cosa succede senza copioni forzati.",
    },
  },
];

const areas = [
  { en: "Marine biology, ecology and field observation", it: "Biologia marina, ecologia e osservazione sul campo" },
  { en: "Citizen science, open data and public research", it: "Citizen science, open data e ricerca pubblica" },
  { en: "Travel, outdoor, culture and slow living stories", it: "Viaggio, outdoor, cultura e vita lenta" },
  { en: "Creator formats, photography, video and audio", it: "Formati creator, fotografia, video e audio" },
  { en: "Sailing, refit, electronics and life-aboard systems", it: "Vela, refit, elettronica e sistemi di bordo" },
  { en: "Remote work, connectivity and lightweight operations", it: "Lavoro remoto, connettività e operatività leggera" },
  { en: "Animal life aboard, safety, welfare and routines", it: "Animali a bordo, sicurezza, benessere e routine" },
  { en: "Sustainability, repair, reuse and self-sufficiency", it: "Sostenibilità, riparazione, riuso e autosufficienza" },
];

const principles = [
  {
    en: "Real context",
    it: "Contesto reale",
    text: {
      en: "The boat is not a studio set. Anything we do has to survive weather, space limits, schedules and the normal friction of life at sea.",
      it: "La barca non è un set. Ogni progetto deve convivere con meteo, spazi stretti, tempi variabili e la normale frizione della vita in mare.",
    },
  },
  {
    en: "Clear expectations",
    it: "Aspettative chiare",
    text: {
      en: "Before starting, we define what is useful, what can be documented, what cannot be promised and how the work will be credited.",
      it: "Prima di partire definiamo cosa serve, cosa si può documentare, cosa non possiamo promettere e come verrà riconosciuto il lavoro.",
    },
  },
  {
    en: "Editorial honesty",
    it: "Onestà editoriale",
    text: {
      en: "We can be useful because we are specific and honest. We do not turn every collaboration into unconditional endorsement.",
      it: "Siamo utili quando restiamo specifici e onesti. Non trasformiamo ogni collaborazione in approvazione incondizionata.",
    },
  },
];

const Collaborations = () => {
  const { t, lang } = useI18n();
  const isEnglish = lang === "en";

  return (
    <div className="space-y-5 pb-4 md:space-y-7 md:pb-6">
      <section className="pt-28 pb-0 md:pt-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <p className="mb-5 text-[11px] font-sans uppercase tracking-[0.32em] text-accent/80">
            {isEnglish ? "Open projects from a real boat" : "Progetti aperti da una barca reale"}
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
        <div className="page-section-narrow glass-panel rounded-[28px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.who.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.who.text")}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel rounded-[28px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6">{t("collab.content.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
            {t("collab.content.text")}
          </p>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-8">{t("collab.forms.title")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {collaborationTypes.map((item) => (
              <article key={item.en} className="glass-panel rounded-[24px] px-5 py-6 md:px-6">
                <p className="mb-4 text-[11px] font-sans uppercase tracking-[0.24em] text-accent/80">
                  {isEnglish ? item.en : item.it}
                </p>
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {isEnglish ? item.text.en : item.text.it}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-light rounded-[28px] px-6 py-10 md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-6 text-foreground">{t("collab.values.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed mb-8">
            {t("collab.values.text")}
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {principles.map((principle) => (
              <div key={principle.en} className="border-t border-foreground/15 pt-4">
                <h3 className="font-sans text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
                  {isEnglish ? principle.en : principle.it}
                </h3>
                <p className="editorial-body mt-3 text-sm leading-relaxed text-muted-foreground">
                  {isEnglish ? principle.text.en : principle.text.it}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow">
          <div className="mb-8 max-w-2xl">
            <h2 className="editorial-heading text-3xl md:text-4xl mb-4">{t("collab.areas.title")}</h2>
            <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
              {t("collab.areas.text")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {areas.map((area, i) => (
              <div key={area.en} className="glass-panel-soft rounded-[20px] px-4 py-4 flex items-center gap-4">
                <span className="glass-chip inline-flex h-9 min-w-9 items-center justify-center text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <p className="editorial-body text-base md:text-lg">{isEnglish ? area.en : area.it}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-light rounded-[28px] px-6 py-10 text-center md:px-10 md:py-12">
          <h2 className="editorial-heading text-3xl md:text-5xl mb-6 whitespace-pre-line text-foreground">
            {t("collab.title")}
          </h2>
          <p className="editorial-body text-muted-foreground text-lg mb-10 max-w-lg mx-auto">
            {t("collab.text")}
          </p>
          <Link
            to="/contact"
            className="glass-button-secondary inline-flex items-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
          >
            {t("collab.cta")} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Collaborations;
