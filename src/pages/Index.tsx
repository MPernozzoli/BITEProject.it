import { useI18n } from "@/lib/i18n";
import { Link } from "react-router-dom";
import { ArrowRight, Anchor, Wrench, Compass, Wifi, Pen } from "lucide-react";

import bowSunset from "@/assets/bow-sunset.jpeg";
import sailingCockpit from "@/assets/sailing-cockpit.jpeg";
import dogsMarina from "@/assets/dogs-marina.jpeg";
import boatSunset from "@/assets/boat-sunset.jpeg";
import boatHarbor from "@/assets/boat-harbor.jpeg";
import dinghyCrew from "@/assets/dinghy-crew.jpg";
import dogSailing from "@/assets/dog-sailing.jpeg";

const journalEntries = [
  {
    slug: "the-engine-that-stopped",
    titleEn: "The Engine That Stopped in the Middle of the Strait",
    titleIt: "Il motore che si è fermato in mezzo allo stretto",
    category: "Navigation",
    date: "2025-03-14",
    image: sailingCockpit,
    excerptEn: "Somewhere between Corfu and the Italian coast, with 25 knots on the nose and a swell building from the northwest, the diesel coughed twice and went silent.",
    excerptIt: "Da qualche parte tra Corfù e la costa italiana, con 25 nodi al muso e un'onda in crescita da nord-ovest, il diesel ha tossito due volte ed è ammutolito.",
  },
  {
    slug: "rewiring-thirty-years",
    titleEn: "Rewiring Thirty Years of Mistakes",
    titleIt: "Ricablare trent'anni di errori",
    category: "Refit",
    date: "2025-01-22",
    image: boatHarbor,
    excerptEn: "When we opened the electrical panel for the first time, we found three decades of improvised repairs layered on top of each other like geological strata.",
    excerptIt: "Quando abbiamo aperto il quadro elettrico per la prima volta, abbiamo trovato tre decenni di riparazioni improvvisate stratificate come strati geologici.",
  },
  {
    slug: "wifi-at-anchor",
    titleEn: "Getting Reliable Wi-Fi at Anchor",
    titleIt: "Avere Wi-Fi affidabile all'ancora",
    category: "Remote Work",
    date: "2024-11-08",
    image: dogSailing,
    excerptEn: "The honest answer is: you can't always. But here's what we've tried, what worked, and what we'd recommend to anyone trying to run a business from a boat.",
    excerptIt: "La risposta onesta è: non sempre si può. Ma ecco cosa abbiamo provato, cosa ha funzionato, e cosa consiglieremmo a chiunque provi a gestire un'attività da una barca.",
  },
];

const Index = () => {
  const { t, lang } = useI18n();

  return (
    <div>
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={bowSunset} alt="View from the bow at sunset" className="img-cover" />
          <div className="absolute inset-0 bg-primary/60" />
        </div>
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto slide-up">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl text-primary-foreground mb-6 whitespace-pre-line">
            {t("hero.title")}
          </h1>
          <p className="editorial-body text-primary-foreground/80 text-base md:text-lg max-w-2xl mx-auto mb-10 whitespace-pre-line">
            {t("hero.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/logbook"
              className="inline-flex items-center gap-2 bg-primary-foreground text-primary px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-primary-foreground/90 transition-colors"
            >
              {t("hero.cta.journey")}
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/collaborations"
              className="inline-flex items-center gap-2 border border-primary-foreground/40 text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-primary-foreground/10 transition-colors"
            >
              {t("hero.cta.collaborate")}
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 animate-bounce">
          <span className="text-[10px] font-sans tracking-[0.3em] uppercase text-primary-foreground/50">
            {t("crew.scroll")}
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary-foreground/50">
            <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
          </svg>
        </div>
      </section>

      {/* Intro */}
      <section className="page-section">
        <div className="page-section-narrow">
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
            {t("intro.label")}
          </p>
          <p className="editorial-body text-lg md:text-xl text-foreground/80 leading-relaxed">
            {t("intro.text")}
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-wide">
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-16 text-center">
            {t("values.label")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-border pt-8">
                <h3 className="editorial-heading text-2xl md:text-3xl mb-4">
                  {t(`values.${i}.title`)}
                </h3>
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {t(`values.${i}.text`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Life Aboard */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
                {t("life.label")}
              </p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">
                {t("life.title")}
              </h2>
              <p className="editorial-body text-muted-foreground leading-relaxed text-lg">
                {t("life.text")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="aspect-[3/4] overflow-hidden">
                <img src={boatSunset} alt="Spritz at sunset" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="aspect-[3/4] overflow-hidden mt-8">
                <img src={dogsMarina} alt="Dogs at the marina" className="img-cover hover:scale-105 transition-transform duration-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Topics */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-wide">
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-primary-foreground/60 mb-16 text-center">
            {t("topics.label")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { key: "refit", icon: Wrench },
              { key: "navigation", icon: Compass },
              { key: "remote", icon: Wifi },
              { key: "storytelling", icon: Pen },
            ].map(({ key, icon: Icon }) => (
              <div key={key} className="border-t border-primary-foreground/20 pt-6">
                <Icon size={20} className="text-primary-foreground/50 mb-4" />
                <h3 className="editorial-heading text-xl mb-3">
                  {t(`topics.${key}`)}
                </h3>
                <p className="text-sm text-primary-foreground/60 leading-relaxed">
                  {t(`topics.${key}.text`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Journal Preview */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="flex items-end justify-between mb-16">
            <div>
              <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-4">
                {t("journal.label")}
              </p>
            </div>
            <Link
              to="/logbook"
              className="hidden md:inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {journalEntries.map((entry) => (
              <article key={entry.slug} className="group cursor-pointer">
                <div className="aspect-[4/3] overflow-hidden mb-6">
                  <img
                    src={entry.image}
                    alt={lang === "en" ? entry.titleEn : entry.titleIt}
                    className="img-cover group-hover:scale-105 transition-transform duration-700"
                  />
                </div>
                <p className="text-xs font-sans tracking-[0.2em] uppercase text-accent mb-2">
                  {entry.category}
                </p>
                <h3 className="editorial-heading text-xl md:text-2xl mb-3 group-hover:text-accent transition-colors">
                  {lang === "en" ? entry.titleEn : entry.titleIt}
                </h3>
                <p className="editorial-body text-sm text-muted-foreground line-clamp-3">
                  {lang === "en" ? entry.excerptEn : entry.excerptIt}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-8 md:hidden text-center">
            <Link
              to="/logbook"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Route Preview */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="aspect-[16/10] overflow-hidden bg-muted flex items-center justify-center">
              <div className="text-center p-8">
                <Anchor size={40} className="text-muted-foreground/40 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">Interactive route map</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Coming soon</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
                {t("route.label")}
              </p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">
                {t("route.title")}
              </h2>
              <p className="editorial-body text-muted-foreground leading-relaxed mb-8">
                {t("route.text")}
              </p>
              <Link
                to="/route"
                className="inline-flex items-center gap-2 text-sm font-sans font-medium text-foreground hover:text-accent transition-colors"
              >
                {t("route.explore")} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Collaborations Preview */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="max-w-3xl">
            <p className="text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
              {t("collab.label")}
            </p>
            <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">
              {t("collab.title")}
            </h2>
            <p className="editorial-body text-muted-foreground leading-relaxed text-lg mb-10">
              {t("collab.text")}
            </p>
            <Link
              to="/collaborations"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors"
            >
              {t("collab.cta")} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Full Width Image */}
      <section className="h-[50vh] md:h-[60vh] overflow-hidden">
        <img src={dinghyCrew} alt="Crew on the dinghy" className="img-cover" />
      </section>

      {/* Newsletter */}
      <section className="page-section bg-primary text-primary-foreground">
        <div className="page-section-narrow text-center">
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-primary-foreground/60 mb-8">
            {t("newsletter.label")}
          </p>
          <h2 className="editorial-heading text-3xl md:text-5xl mb-6">
            {t("newsletter.title")}
          </h2>
          <p className="editorial-body text-primary-foreground/70 mb-10 max-w-lg mx-auto">
            {t("newsletter.text")}
          </p>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <input
              type="email"
              placeholder={t("newsletter.placeholder")}
              className="flex-1 bg-primary-foreground/10 border border-primary-foreground/20 px-5 py-3 text-sm text-primary-foreground placeholder:text-primary-foreground/40 focus:outline-none focus:border-primary-foreground/40 transition-colors"
            />
            <button
              type="submit"
              className="bg-primary-foreground text-primary px-8 py-3 text-sm font-sans font-medium tracking-wide hover:bg-primary-foreground/90 transition-colors"
            >
              {t("newsletter.submit")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};

export default Index;
