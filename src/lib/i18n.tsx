import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type Language = "en" | "it";

type Translations = Record<string, Record<Language, string>>;

const translations: Translations = {
  // Nav
  "nav.home": { en: "Home", it: "Home" },
  "nav.about": { en: "About", it: "Chi siamo" },
  "nav.manifesto": { en: "Manifesto", it: "Manifesto" },
  "nav.journal": { en: "Journal", it: "Giornale di bordo" },
  "nav.route": { en: "Route", it: "Rotta" },
  "nav.collaborations": { en: "Collaborations", it: "Collaborazioni" },
  "nav.contact": { en: "Contact", it: "Contatti" },

  // Hero
  "hero.title": { en: "Life is built,\nnot found.", it: "La vita si costruisce,\nnon si trova." },
  "hero.subtitle": { en: "A sailboat. Two humans. Two dogs. Open water.\nStories from a life that moves slowly, breaks often, and means something.", it: "Una barca a vela. Due umani. Due cani. Mare aperto.\nStorie da una vita che si muove piano, si rompe spesso, e ha un senso." },
  "hero.cta.journey": { en: "Follow the Journey", it: "Segui il viaggio" },
  "hero.cta.collaborate": { en: "Collaborate With Us", it: "Collabora con noi" },

  // Intro
  "intro.label": { en: "What is BITE", it: "Cos'è BITE" },
  "intro.text": { en: "BITE is a long-term storytelling project built around real life aboard a sailboat. It documents the intersection of remote work, boat maintenance, slow travel, practical problem-solving, and the ongoing effort to live with more intention and less noise. It is not a travel blog. It is not a luxury brand. It is an honest account of what it takes to build a life on the water — with all the beauty and friction that comes with it.", it: "BITE è un progetto narrativo a lungo termine costruito attorno alla vita reale a bordo di una barca a vela. Documenta l'intersezione tra lavoro remoto, manutenzione della barca, viaggio lento, problem-solving pratico e lo sforzo continuo di vivere con più intenzione e meno rumore. Non è un travel blog. Non è un brand di lusso. È un racconto onesto di cosa serve per costruire una vita sull'acqua — con tutta la bellezza e l'attrito che ne derivano." },

  // Values
  "values.label": { en: "What We Stand For", it: "I nostri valori" },
  "values.1.title": { en: "Autonomy", it: "Autonomia" },
  "values.1.text": { en: "We maintain our own boat, solve our own problems, and take responsibility for our decisions. Independence is a practice, not a privilege.", it: "Manteniamo la nostra barca, risolviamo i nostri problemi, ci prendiamo la responsabilità delle nostre decisioni. L'indipendenza è una pratica, non un privilegio." },
  "values.2.title": { en: "Honesty", it: "Onestà" },
  "values.2.text": { en: "We show the real picture — broken engines, bad weather, difficult days. Truth is more interesting than performance.", it: "Mostriamo la realtà — motori rotti, maltempo, giornate difficili. La verità è più interessante della performance." },
  "values.3.title": { en: "Intention", it: "Intenzione" },
  "values.3.text": { en: "Every choice — where we go, what we carry, how we spend our time — is deliberate. Slowness is not laziness. It is precision.", it: "Ogni scelta — dove andiamo, cosa portiamo, come spendiamo il tempo — è deliberata. La lentezza non è pigrizia. È precisione." },
  "values.4.title": { en: "Competence", it: "Competenza" },
  "values.4.text": { en: "Sailing is not a hobby for us. It is a discipline that demands constant learning — navigation, mechanics, weather, seamanship.", it: "La vela per noi non è un hobby. È una disciplina che richiede apprendimento continuo — navigazione, meccanica, meteo, marineria." },

  // Life Aboard
  "life.label": { en: "Life Aboard", it: "Vita a bordo" },
  "life.title": { en: "Thirty-two feet of\neverything.", it: "Dieci metri di\ntutto." },
  "life.text": { en: "Our home is a 1983 sailboat named Spritz. She is not new, not fancy, and not always cooperative. But she floats, she sails, and she has carried us across seas with two dogs, a toolbox, and a laptop. Living aboard means fixing what breaks, adapting to what changes, and finding rhythm in the unpredictable.", it: "La nostra casa è una barca a vela del 1983 di nome Spritz. Non è nuova, non è lussuosa, e non è sempre collaborativa. Ma galleggia, naviga, e ci ha portati attraverso i mari con due cani, una cassetta degli attrezzi e un laptop. Vivere a bordo significa riparare ciò che si rompe, adattarsi a ciò che cambia, e trovare ritmo nell'imprevedibile." },

  // Topics
  "topics.label": { en: "What We Document", it: "Cosa documentiamo" },
  "topics.refit": { en: "Refit & Maintenance", it: "Refit e manutenzione" },
  "topics.refit.text": { en: "Every bolt, every coat of paint, every system rebuilt from scratch. The work never stops, and we document all of it.", it: "Ogni bullone, ogni mano di vernice, ogni sistema ricostruito da zero. Il lavoro non finisce mai, e lo documentiamo tutto." },
  "topics.navigation": { en: "Navigation & Seamanship", it: "Navigazione e marineria" },
  "topics.navigation.text": { en: "Weather routing, passage planning, anchoring, docking — the practical knowledge that keeps you safe and moving.", it: "Routing meteo, pianificazione delle traversate, ancoraggio, ormeggio — la conoscenza pratica che ti tiene al sicuro e in movimento." },
  "topics.remote": { en: "Remote Work", it: "Lavoro remoto" },
  "topics.remote.text": { en: "Running a business from a moving boat with unreliable Wi-Fi. It works. Mostly.", it: "Gestire un'attività da una barca in movimento con Wi-Fi inaffidabile. Funziona. Quasi sempre." },
  "topics.storytelling": { en: "Storytelling", it: "Narrazione" },
  "topics.storytelling.text": { en: "Long-form writing, photography, and video that captures the texture of days spent between salt, wind, and work.", it: "Scrittura lunga, fotografia e video che catturano la consistenza dei giorni trascorsi tra sale, vento e lavoro." },

  // Journal
  "journal.label": { en: "From the Journal", it: "Dal giornale di bordo" },
  "journal.readmore": { en: "Read More", it: "Leggi tutto" },
  "journal.viewall": { en: "View All Entries", it: "Vedi tutte le voci" },

  // Route
  "route.label": { en: "The Route", it: "La rotta" },
  "route.title": { en: "Where we've been.\nWhere we're going.", it: "Dove siamo stati.\nDove stiamo andando." },
  "route.text": { en: "Our route is not planned years in advance. It responds to seasons, weather windows, boat condition, and curiosity. We move when it makes sense, and we stay when a place has more to teach.", it: "La nostra rotta non è pianificata con anni di anticipo. Risponde alle stagioni, alle finestre meteo, alle condizioni della barca e alla curiosità. Ci muoviamo quando ha senso, e restiamo quando un luogo ha ancora qualcosa da insegnare." },
  "route.explore": { en: "Explore the Route", it: "Esplora la rotta" },

  // Collaborations
  "collab.label": { en: "Work With Us", it: "Lavora con noi" },
  "collab.title": { en: "Partnerships built\non shared values.", it: "Partnership costruite\nsu valori condivisi." },
  "collab.text": { en: "We work with brands that align with our principles — durability, honesty, function, and respect. If your product belongs on a boat that actually sails, we should talk.", it: "Lavoriamo con brand che condividono i nostri principi — durabilità, onestà, funzionalità e rispetto. Se il tuo prodotto ha un posto su una barca che davvero naviga, dovremmo parlarne." },
  "collab.cta": { en: "Start a Conversation", it: "Inizia una conversazione" },

  // Newsletter
  "newsletter.label": { en: "Stay Close", it: "Resta vicino" },
  "newsletter.title": { en: "Notes from the boat.", it: "Appunti dalla barca." },
  "newsletter.text": { en: "Routes, problems, ideas, lessons, and what comes next. A periodic letter from wherever we happen to be anchored.", it: "Rotte, problemi, idee, lezioni, e cosa viene dopo. Una lettera periodica da dovunque siamo ancorati." },
  "newsletter.placeholder": { en: "Your email", it: "La tua email" },
  "newsletter.submit": { en: "Subscribe", it: "Iscriviti" },

  // Footer
  "footer.tagline": { en: "A storytelling project from aboard S/Y Spritz.", it: "Un progetto narrativo da bordo della S/Y Spritz." },
  "footer.rights": { en: "All rights reserved.", it: "Tutti i diritti riservati." },

  // About Page
  "about.title": { en: "Who we are.", it: "Chi siamo." },
  "about.intro": { en: "We are two people who decided that the conventional path wasn't the only one available. So we bought an old sailboat, taught ourselves to fix it, and started living on the water full-time — with two dogs, a small business, and a commitment to documenting the whole thing honestly.", it: "Siamo due persone che hanno deciso che il percorso convenzionale non era l'unico disponibile. Così abbiamo comprato una vecchia barca a vela, abbiamo imparato a ripararla, e abbiamo iniziato a vivere sull'acqua a tempo pieno — con due cani, una piccola attività, e l'impegno di documentare tutto onestamente." },
  "about.why.title": { en: "Why this life.", it: "Perché questa vita." },
  "about.why.text": { en: "Not because it's easy or glamorous. Because it demands presence, adaptability, and constant learning. Because a 32-foot sailboat is the smallest possible space where you can fit an entire life — work, relationships, growth, solitude, community, and weather. Because we believe that the best stories come from lives that are actually lived, not performed for cameras.", it: "Non perché sia facile o glamour. Perché richiede presenza, adattabilità e apprendimento costante. Perché una barca a vela di 10 metri è lo spazio più piccolo dove puoi far stare un'intera vita — lavoro, relazioni, crescita, solitudine, comunità e meteo. Perché crediamo che le storie migliori vengano da vite realmente vissute, non recitate per le telecamere." },
  "about.what.title": { en: "What BITE is — and isn't.", it: "Cos'è BITE — e cosa non è." },
  "about.what.text": { en: "BITE is not a travel blog. It is not a brand that sells a fantasy. It is a long-term project that documents the reality of choosing a different kind of life — the maintenance, the passages, the remote work, the isolation, the beauty, and the unglamorous effort behind all of it. We believe that honest storytelling has more value than polished content. And we think there are people out there who agree.", it: "BITE non è un travel blog. Non è un brand che vende una fantasia. È un progetto a lungo termine che documenta la realtà di scegliere un tipo diverso di vita — la manutenzione, le traversate, il lavoro remoto, l'isolamento, la bellezza, e lo sforzo poco glamour dietro a tutto. Crediamo che una narrazione onesta abbia più valore di un contenuto patinato. E pensiamo che là fuori ci siano persone che la pensano allo stesso modo." },
  "about.how.title": { en: "How we work.", it: "Come lavoriamo." },
  "about.how.text": { en: "We run a small digital business from the boat — design, strategy, and consulting work that funds the project and the life. The laptop opens in marinas, anchorages, and cafés across the Mediterranean. Connectivity is unreliable. Deadlines don't care about weather windows. But we've learned to make it work, and we write about that too.", it: "Gestiamo una piccola attività digitale dalla barca — design, strategia e consulenza che finanzia il progetto e la vita. Il laptop si apre in marina, all'ancora e nei bar del Mediterraneo. La connettività è inaffidabile. Le scadenze non si curano delle finestre meteo. Ma abbiamo imparato a farlo funzionare, e scriviamo anche di questo." },

  // Manifesto Page
  "manifesto.title": { en: "What we believe.", it: "In cosa crediamo." },
  "manifesto.intro": { en: "These are the principles that guide BITE — not as marketing copy, but as decisions we make every day aboard.", it: "Questi sono i principi che guidano BITE — non come copy pubblicitario, ma come decisioni che prendiamo ogni giorno a bordo." },

  // Journal Page
  "journal.page.title": { en: "Journal", it: "Giornale di bordo" },
  "journal.page.subtitle": { en: "Stories, technical notes, and reflections from aboard.", it: "Storie, note tecniche e riflessioni da bordo." },

  // Route Page
  "route.page.title": { en: "The Route", it: "La rotta" },
  "route.page.subtitle": { en: "Where we've been, where we are, and what's ahead.", it: "Dove siamo stati, dove siamo, e cosa ci aspetta." },
  "route.status.title": { en: "Current Status", it: "Stato attuale" },
  "route.status.location": { en: "Current Location", it: "Posizione attuale" },
  "route.status.phase": { en: "Current Phase", it: "Fase attuale" },
  "route.status.next": { en: "Next Destination", it: "Prossima destinazione" },
  "route.past.title": { en: "Past Stops", it: "Tappe passate" },
  "route.future.title": { en: "Ahead", it: "In programma" },

  // Collaborations Page
  "collab.page.title": { en: "Collaborations", it: "Collaborazioni" },
  "collab.page.subtitle": { en: "We work with brands and organizations whose values match ours.", it: "Lavoriamo con brand e organizzazioni i cui valori corrispondono ai nostri." },
  "collab.who.title": { en: "Who we are.", it: "Chi siamo." },
  "collab.who.text": { en: "We are the crew behind BITE — a real sailing and storytelling project with a growing audience of people interested in intentional living, self-sufficiency, technical skills, and honest documentation of life at sea.", it: "Siamo l'equipaggio dietro BITE — un progetto reale di navigazione e narrazione con un pubblico in crescita di persone interessate a una vita intenzionale, all'autosufficienza, alle competenze tecniche e alla documentazione onesta della vita in mare." },
  "collab.content.title": { en: "What we create.", it: "Cosa creiamo." },
  "collab.content.text": { en: "Long-form articles, photo essays, technical reviews, video content, and social media storytelling — all rooted in genuine daily use aboard a working sailboat.", it: "Articoli di lunga forma, reportage fotografici, recensioni tecniche, contenuti video e storytelling sui social — tutto radicato nell'uso quotidiano genuino a bordo di una barca a vela che naviga davvero." },
  "collab.values.title": { en: "What we look for.", it: "Cosa cerchiamo." },
  "collab.values.text": { en: "We only partner with brands whose products we would genuinely use aboard. No generic sponsorships. No forced endorsements. Every collaboration must feel natural to our audience and honest to our experience.", it: "Collaboriamo solo con brand i cui prodotti useremmo davvero a bordo. Nessuna sponsorizzazione generica. Nessuna promozione forzata. Ogni collaborazione deve risultare naturale per il nostro pubblico e onesta rispetto alla nostra esperienza." },
  "collab.areas.title": { en: "Areas of interest", it: "Aree di interesse" },

  // Contact Page
  "contact.title": { en: "Get in touch.", it: "Scrivici." },
  "contact.subtitle": { en: "Whether it's a collaboration, a question, or just a message from someone who gets it — we read everything.", it: "Che sia una collaborazione, una domanda, o semplicemente un messaggio da qualcuno che capisce — leggiamo tutto." },
  "contact.name": { en: "Name", it: "Nome" },
  "contact.email": { en: "Email", it: "Email" },
  "contact.subject": { en: "Subject", it: "Oggetto" },
  "contact.message": { en: "Message", it: "Messaggio" },
  "contact.send": { en: "Send Message", it: "Invia messaggio" },
  "contact.closing": { en: "We respond from wherever we are — sometimes a marina, sometimes an anchorage, sometimes offshore. Give us a few days.", it: "Rispondiamo da dovunque siamo — a volte una marina, a volte un'ancoraggio, a volte in navigazione. Dacci qualche giorno." },
};

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Language>("en");

  const t = useCallback(
    (key: string) => {
      return translations[key]?.[lang] ?? key;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
