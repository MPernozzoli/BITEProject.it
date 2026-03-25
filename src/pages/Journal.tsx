import { useI18n } from "@/lib/i18n";
import { useState } from "react";

import sailingCockpit from "@/assets/sailing-cockpit.jpeg";
import boatHarbor from "@/assets/boat-harbor.jpeg";
import dogSailing from "@/assets/dog-sailing.jpeg";
import bowSunset from "@/assets/bow-sunset.jpeg";
import dogsMarina from "@/assets/dogs-marina.jpeg";
import boatSunset from "@/assets/boat-sunset.jpeg";

const categories = ["All", "Refit", "Life Aboard", "Navigation", "Remote Work", "Places", "Notes from the Boat", "Lessons Learned"];

const articles = [
  { slug: "the-engine-that-stopped", titleEn: "The Engine That Stopped in the Middle of the Strait", titleIt: "Il motore che si è fermato in mezzo allo stretto", category: "Navigation", date: "2025-03-14", image: sailingCockpit, excerptEn: "Somewhere between Corfu and the Italian coast, with 25 knots on the nose and a swell building from the northwest, the diesel coughed twice and went silent.", excerptIt: "Da qualche parte tra Corfù e la costa italiana, con 25 nodi al muso e un'onda in crescita da nord-ovest, il diesel ha tossito due volte ed è ammutolito." },
  { slug: "rewiring-thirty-years", titleEn: "Rewiring Thirty Years of Mistakes", titleIt: "Ricablare trent'anni di errori", category: "Refit", date: "2025-01-22", image: boatHarbor, excerptEn: "When we opened the electrical panel for the first time, we found three decades of improvised repairs layered on top of each other like geological strata.", excerptIt: "Quando abbiamo aperto il quadro elettrico per la prima volta, abbiamo trovato tre decenni di riparazioni improvvisate stratificate come strati geologici." },
  { slug: "wifi-at-anchor", titleEn: "Getting Reliable Wi-Fi at Anchor", titleIt: "Avere Wi-Fi affidabile all'ancora", category: "Remote Work", date: "2024-11-08", image: dogSailing, excerptEn: "The honest answer is: you can't always. But here's what we've tried, what worked, and what we'd recommend.", excerptIt: "La risposta onesta è: non sempre si può. Ma ecco cosa abbiamo provato, cosa ha funzionato, e cosa consiglieremmo." },
  { slug: "dogs-on-boats", titleEn: "Two Dogs, One Dinghy, and a Lot of Patience", titleIt: "Due cani, un tender e molta pazienza", category: "Life Aboard", date: "2024-09-15", image: dogsMarina, excerptEn: "Living aboard with animals means rethinking every routine. Shore walks, seasickness, vet visits in foreign languages, and the surprisingly philosophical question of where a dog should pee when land is two miles away.", excerptIt: "Vivere a bordo con animali significa ripensare ogni routine. Passeggiate a terra, mal di mare, visite veterinarie in lingue straniere, e la domanda sorprendentemente filosofica di dove un cane dovrebbe fare i bisogni quando la terra è a due miglia." },
  { slug: "first-night-passage", titleEn: "What Your First Night Passage Actually Feels Like", titleIt: "Come si sente davvero la prima navigazione notturna", category: "Navigation", date: "2024-07-20", image: bowSunset, excerptEn: "Nobody tells you about the specific quality of silence at 3am, fifty miles offshore, when the only light is the compass glow and the stars.", excerptIt: "Nessuno ti racconta della qualità specifica del silenzio alle 3 di notte, a cinquanta miglia dalla costa, quando l'unica luce è il chiarore della bussola e le stelle." },
  { slug: "sanding-varnishing", titleEn: "The Meditation of Sanding and Varnishing", titleIt: "La meditazione della carteggiatura e verniciatura", category: "Refit", date: "2024-05-10", image: boatSunset, excerptEn: "There is a particular kind of peace in repetitive physical work that has a visible result. Six coats of varnish on a teak coaming taught me more about patience than any book.", excerptIt: "C'è un tipo particolare di pace nel lavoro fisico ripetitivo che ha un risultato visibile. Sei mani di vernice su un falchetto di teak mi hanno insegnato più sulla pazienza di qualsiasi libro." },
];

const Journal = () => {
  const { t, lang } = useI18n();
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = activeCategory === "All" ? articles : articles.filter((a) => a.category === activeCategory);

  return (
    <div>
      <section className="pt-32 pb-12 md:pt-40 md:pb-16 px-6 md:px-12">
        <div className="page-section-wide">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("journal.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground">
            {t("journal.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Categories */}
      <section className="px-6 md:px-12 pb-12">
        <div className="page-section-wide">
          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`text-xs font-sans tracking-wide px-4 py-2 border transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Articles */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          <div className="space-y-16">
            {filtered.map((article, i) => (
              <article key={article.slug} className="group cursor-pointer">
                <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center ${i % 2 === 1 ? "lg:direction-rtl" : ""}`}>
                  <div className={`aspect-[16/10] overflow-hidden ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                    <img
                      src={article.image}
                      alt={lang === "en" ? article.titleEn : article.titleIt}
                      className="img-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  </div>
                  <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                        {article.category}
                      </span>
                      <span className="text-xs text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">{article.date}</span>
                    </div>
                    <h2 className="editorial-heading text-2xl md:text-3xl lg:text-4xl mb-4 group-hover:text-accent transition-colors">
                      {lang === "en" ? article.titleEn : article.titleIt}
                    </h2>
                    <p className="editorial-body text-muted-foreground leading-relaxed">
                      {lang === "en" ? article.excerptEn : article.excerptIt}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Journal;
