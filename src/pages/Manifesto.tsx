import { useI18n } from "@/lib/i18n";

const principles = [
  {
    titleEn: "Autonomy over convenience.",
    titleIt: "Autonomia prima della comodità.",
    textEn: "We chose a life that requires fixing things ourselves, making decisions without a safety net, and accepting responsibility for outcomes. Convenience is easy. Autonomy is earned.",
    textIt: "Abbiamo scelto una vita che richiede riparare le cose da soli, prendere decisioni senza rete di sicurezza e accettare la responsabilità dei risultati. La comodità è facile. L'autonomia si guadagna.",
  },
  {
    titleEn: "Reality over performance.",
    titleIt: "Realtà prima della performance.",
    textEn: "We don't curate a highlight reel. We show the bilge pump at 3am, the failed repair, the frustration, and the quiet satisfaction of getting it right on the third try. Reality is always more interesting than the version edited for approval.",
    textIt: "Non curiamo un montaggio dei momenti migliori. Mostriamo la pompa di sentina alle 3 di notte, la riparazione fallita, la frustrazione, e la soddisfazione silenziosa di riuscirci al terzo tentativo. La realtà è sempre più interessante della versione editata per ottenere approvazione.",
  },
  {
    titleEn: "Intentional slowness over passive consumption.",
    titleIt: "Lentezza intenzionale prima del consumo passivo.",
    textEn: "We move at the speed of wind and weather, not algorithms. Slow travel isn't about doing nothing — it's about being present enough to notice what's actually happening. Speed is noise. Attention is signal.",
    textIt: "Ci muoviamo alla velocità del vento e del meteo, non degli algoritmi. Il viaggio lento non è stare fermi — è essere abbastanza presenti da notare cosa sta davvero accadendo. La velocità è rumore. L'attenzione è segnale.",
  },
  {
    titleEn: "Practical competence over romantic aesthetics.",
    titleIt: "Competenza pratica prima dell'estetica romantica.",
    textEn: "Sailing looks beautiful in photos. In practice, it demands mechanics, meteorology, navigation, and an endless capacity to troubleshoot. We value what works over what looks good. The beauty is in the function.",
    textIt: "La vela è bellissima in foto. In pratica, richiede meccanica, meteorologia, navigazione e una capacità infinita di risolvere problemi. Diamo valore a ciò che funziona più che a ciò che è bello. La bellezza è nella funzione.",
  },
  {
    titleEn: "Transparency over curated perfection.",
    titleIt: "Trasparenza prima della perfezione curata.",
    textEn: "We share our costs, our mistakes, our learning process. Not because vulnerability is trendy, but because honest information is more useful than polished content. If someone can learn from our experience, the story was worth telling.",
    textIt: "Condividiamo i nostri costi, i nostri errori, il nostro processo di apprendimento. Non perché la vulnerabilità sia di moda, ma perché un'informazione onesta è più utile di un contenuto patinato. Se qualcuno può imparare dalla nostra esperienza, la storia valeva la pena di essere raccontata.",
  },
  {
    titleEn: "Respect for what surrounds us.",
    titleIt: "Rispetto per ciò che ci circonda.",
    textEn: "The sea, the weather, the places we visit, the animals who live aboard with us — none of it belongs to us. We are guests. We act accordingly. Respect is not a value we perform. It is a constraint we accept.",
    textIt: "Il mare, il meteo, i luoghi che visitiamo, gli animali che vivono a bordo con noi — niente di tutto questo ci appartiene. Siamo ospiti. Ci comportiamo di conseguenza. Il rispetto non è un valore che esibiamo. È un vincolo che accettiamo.",
  },
];

const Manifesto = () => {
  const { lang, t } = useI18n();

  return (
    <div>
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-8">
            {t("manifesto.title")}
          </h1>
          <p className="editorial-body text-lg md:text-xl text-muted-foreground leading-relaxed">
            {t("manifesto.intro")}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-narrow">
          {principles.map((p, i) => (
            <div key={i} className="border-t border-border py-12 md:py-16">
              <div className="flex gap-6 md:gap-12">
                <span className="text-xs font-sans tracking-widest text-muted-foreground/40 pt-2 select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="editorial-heading text-2xl md:text-4xl mb-6">
                    {lang === "en" ? p.titleEn : p.titleIt}
                  </h2>
                  <p className="editorial-body text-muted-foreground text-lg leading-relaxed max-w-2xl">
                    {lang === "en" ? p.textEn : p.textIt}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Manifesto;
