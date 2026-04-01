import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deferSupabaseAuthWork } from "@/lib/supabase-auth";

export type Language = "en" | "it";
export type ExtendedLanguage = "en" | "it" | "fr" | "de" | "es" | "pt";

export const ALL_LANGUAGES: { code: ExtendedLanguage; label: string }[] = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
];

export const SITE_LANGUAGES: Language[] = ["it", "en"];

type Translations = Record<string, Record<Language, string>>;
type TranslationParams = Record<string, string | number>;

const translations: Translations = {
  // Nav
  "nav.home": { en: "Home", it: "Home" },
  "nav.about": { en: "The Crew", it: "La Ciurma" },
  "nav.manifesto": { en: "Manifesto", it: "Manifesto" },
  "nav.journal": { en: "Logbook", it: "Diario di bordo" },
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
  "intro.text": { en: "BITE was born in 2023 when we bought our first travel vehicle: Duodji, a 1990 FIAT Ducato camper that carried us from Lecce to Oslo. When the engine gave out for good, we decided to try something different — a boat. A few months later we found Spritz, a 1975 Deerberg Beryll 32\", and sailed her from Greece to Italy. Now we document the reality of building a life on the water — two humans, two dogs, and all the beauty and friction that comes with it.", it: "BITE è nato nel 2023 quando abbiamo acquistato il nostro primo mezzo di viaggio: Duodji, un camper FIAT Ducato del 1990 che ci ha portati da Lecce a Oslo. Quando il motore ci ha abbandonati definitivamente, abbiamo deciso di provare qualcosa di diverso — una barca. Pochi mesi dopo abbiamo trovato Spritz, una Deerberg Beryll del 1975 di 32 piedi, e l'abbiamo portata dalla Grecia all'Italia. Ora documentiamo la realtà di costruire una vita sull'acqua — due umani, due cani, e tutta la bellezza e l'attrito che ne derivano." },

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
  "life.text": { en: "Our home is Spritz, a 1975 Deerberg Beryll 32\" — built in Germany, originally rigged as a ketch, later converted to a cutter. She spent most of her life on Lake Constance before crossing Europe's inland waterways to the Black Sea and on to Greece, where we found her in 2024. She is not new, not fancy, and not always cooperative. But she floats, she sails, and she has carried us with two dogs, a toolbox, and a laptop.", it: "La nostra casa è Spritz, una Deerberg Beryll del 1975 di 32 piedi — costruita in Germania, originariamente armata a ketch, poi convertita a cutter. Ha trascorso gran parte della sua vita sul Lago di Costanza prima di attraversare i canali d'Europa fino al Mar Nero e poi in Grecia, dove l'abbiamo trovata nel 2024. Non è nuova, non è lussuosa, e non è sempre collaborativa. Ma galleggia, naviga, e ci ha portati con due cani, una cassetta degli attrezzi e un laptop." },

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
  "journal.label": { en: "From the Logbook", it: "Dal diario di bordo" },
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

  // Crew Page
  "crew.title": { en: "The Crew.", it: "La Ciurma." },
  "crew.intro": { en: "Two humans, two dogs, one boat. This is who we are — and how we got here.", it: "Due umani, due cani, una barca. Ecco chi siamo — e come siamo arrivati qui." },
  "crew.project.title": { en: "The Project", it: "Il Progetto" },
  "crew.project.text": { en: "BITE was born in 2023 when we bought our first travel vehicle: Duodji, a 1990 FIAT Ducato camper that we drove across Europe, from Lecce (IT) to Oslo (NO). When the engine failed beyond repair, we decided to try something radically different: a sailboat. A few months later we found Spritz — then called Paddy — for sale in Greece, and by late 2024 she was ours.", it: "BITE è nato nel 2023, quando abbiamo acquistato il nostro primo mezzo di viaggio: Duodji, un camper FIAT Ducato del 1990 che abbiamo portato in giro per l'Europa, da Lecce a Oslo. Quando il camper ci ha abbandonati a causa di un guasto irreparabile al motore, abbiamo deciso di provare qualcosa di radicalmente diverso: una barca a vela. Pochi mesi dopo abbiamo trovato Spritz — all'epoca Paddy — in vendita in Grecia, e a fine 2024 era nostra." },
  "crew.massimo.title": { en: "Massimo", it: "Massimo" },
  "crew.massimo.text": { en: "{{age}} years old, originally from Potenza. He moved to Milan at 18 in 2015 and after nearly a decade in the city, he felt ready for a change. His lifelong passion for travel led him to dream bigger — first a camper across Europe, now a sailboat across the Mediterranean.", it: "{{age}} anni, originario di Potenza. Si è trasferito a Milano a 18 anni nel 2015 e dopo quasi dieci anni nella città meneghina si sentiva pronto a cambiare. La sua passione di sempre per il viaggio lo ha spinto a sognare in grande — prima un camper attraverso l'Europa, ora una barca a vela nel Mediterraneo." },
  "crew.sami.title": { en: "Sami", it: "Sami" },
  "crew.sami.text": { en: "{{age}} years old, of Brazilian heritage. After years of going back and forth between Italy and Brazil, he settled in Sesto San Giovanni at the age of 8. Milan was home and he had never even thought of leaving it — until he met Massimo.", it: "{{age}} anni, di origini brasiliane. Dopo un continuo via vai tra Italia e Brasile all’età di 8 anni si è stabilizzato a Sesto San Giovanni. Milano era la sua casa e non aveva neanche mai pensato di lasciarla — finché non ha conosciuto Massimo." },
  "crew.godot.title": { en: "Godot", it: "Godot" },
  "crew.godot.text": { en: "A 6-year-old American Akita who lives with canine autism and epilepsy. He has always struggled to socialize with other dogs and doesn't handle solitude well. He has had a lifelong passion for water — but ironically, he's terrified of depths where his paws can't touch the bottom. He can swim; he simply doesn't enjoy it. He loves watching the sea from Spritz's deck or the shore.", it: "Un Akita Americano di 6 anni che convive con autismo canino ed epilessia. Ha sempre avuto difficoltà a socializzare con gli altri cani e non sa gestire bene la solitudine. Ha sempre avuto la passione dell'acqua — ma, ironicamente, ha anche sempre avuto una paura immensa della profondità e di dove non tocca con le zampe. Sa nuotare, semplicemente non gli piace. Ama guardare il mare dal ponte di Spritz o dalla spiaggia." },
  "crew.freya.title": { en: "Freya", it: "Freya" },
  "crew.freya.text": { en: "Joined the crew at one year old after Snow Daisy's passing. Until then, she had lived her whole life in the breeder's enclosure and knew nothing of the outside world — a true scaredy-cat. Discovering the world past the age of one is hard for a dog, but watching Godot face it fearlessly gave her confidence and courage. Now she's become fearless herself — sometimes too much so, as long as Godot is nearby.", it: "Arrivata nella ciurma all'età di un anno dopo la morte di Snow Daisy. Fino a quel momento aveva vissuto nel recinto dell'allevamento e non conosceva niente del mondo circostante — una vera fifona. Scoprire il mondo a più di un anno per un cane può essere molto difficile, ma vedere come Godot lo affrontava in maniera temeraria le ha dato fiducia e coraggio. Ora è diventata impavida, anche troppo — finché ha Godot vicino!" },
  "crew.snow.title": { en: "Snow Daisy", it: "Snow Daisy" },
  "crew.snow.subtitle": { en: "Ad Honorem", it: "Ad Honorem" },
  "crew.snow.text": { en: "Snow Daisy joined the crew in 2021 after retiring as a show dog from the same breeder as Godot. She lived a dream retirement filled with adventures: Denmark, Germany, Sweden, and Norway. Snowshoeing in Gran Paradiso and feasting in mountain refuges. Shortly after Massimo adopted her, Godot — who had never handled solitude well — finally found a companion. She accompanied him for about three years until she left us in January 2025, too quickly and too soon. Her legacy lives on in all of us.", it: "Snow Daisy è entrata nella ciurma nel 2021, dopo il suo pensionamento come cane da esposizione dall'allevamento di Godot. Ha vissuto una pensione da sogno, fatta di tanti viaggi ed avventure: Danimarca, Germania, Svezia e Norvegia. Ciaspolate sul Gran Paradiso e abbuffate nei rifugi montani. Poco dopo la sua adozione, Godot — che non aveva mai gestito bene la solitudine — aveva finalmente trovato una compagna. Lo ha accompagnato per circa tre anni fino a quando ci ha lasciati a gennaio 2025, troppo in fretta e troppo presto. Il suo retaggio resta indelebile in tutti noi." },
  "crew.spritz.title": { en: "Spritz", it: "Spritz" },
  "crew.spritz.text": { en: "Spritz is a Deerberg Beryll 32\", built in Germany in 1975. She was born as a ketch but was later converted to a cutter by her previous owner. She spent most of her life on Lake Constance in Germany. In 2019 she changed hands, and after an intensive refit she sailed through Eastern Europe's inland waterways to the Black Sea, then on to Greece where she remained until 2024 — when we took her and continued the journey to Italy.", it: "Spritz è una Deerberg Beryll di 32 piedi, costruita in Germania nel 1975. È nata come ketch ma è poi stata riadattata a cutter dal precedente proprietario. Ha vissuto il grosso della sua vita nel Lago di Costanza, in Germania. Nel 2019 ha cambiato proprietario e dopo un intensivo refit è salpata lungo i canali dell'Europa dell'est fino al Mar Nero per arrivare poi in Grecia, dove è rimasta fino al 2024 — dove noi l'abbiamo presa e le abbiamo fatto continuare il viaggio fino in Italia." },
  "crew.scroll": { en: "Scroll to discover", it: "Scorri per scoprire" },
  "crew.name.title": { en: "What's in a name.", it: "Cosa c'è in un nome." },
  "crew.name.text": { en: "BITE stands for Better Is The End — the title of a song by Tophouse that we fell in love with from the first listen. It felt like ours: a reminder that no matter how many curveballs and mishaps fill our days, it all works out in the end. And then there's a verse that seems to have been written about us.", it: "BITE sta per Better Is The End — il titolo di una canzone dei Tophouse di cui ci siamo innamorati dal primo ascolto. Ci sembrava nostra: un promemoria che, per quanti imprevisti e casini riempiano le nostre giornate, alla fine andrà tutto bene. E poi c'è una strofa che sembra essere stata scritta proprio per noi." },

  // Manifesto Page
  "manifesto.title": { en: "What we believe.", it: "In cosa crediamo." },
  "manifesto.intro": { en: "These are the principles that guide BITE — not as marketing copy, but as decisions we make every day aboard.", it: "Questi sono i principi che guidano BITE — non come copy pubblicitario, ma come decisioni che prendiamo ogni giorno a bordo." },

  // Journal Page
  "journal.page.title": { en: "Logbook", it: "Diario di bordo" },
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
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

// Maps extended languages to the closest available site language
function resolveToSiteLanguage(preferred: string, secondary?: string | null): Language {
  if (preferred === "it" || preferred === "en") return preferred as Language;
  // For non-native languages, use secondary if it's a site language
  if (secondary === "it" || secondary === "en") return secondary as Language;
  // Fallback: romance languages → Italian, others → English
  if (["fr", "es", "pt"].includes(preferred)) return "it";
  return "en";
}

function resolveLanguageFromLocation(): Language | null {
  if (typeof window === "undefined") return null;
  const urlLang = new URLSearchParams(window.location.search).get("lang");
  return urlLang === "it" || urlLang === "en" ? urlLang : null;
}

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Language>(() => resolveLanguageFromLocation() ?? "en");

  useEffect(() => {
    let cancelled = false;
    const forcedLang = resolveLanguageFromLocation();

    if (forcedLang) {
      setLang(forcedLang);
    }

    const loadUserLanguage = async (userId?: string | null) => {
      try {
        if (forcedLang || cancelled) return;
        let nextUserId = userId;
        if (!nextUserId) {
          const { data: { session } } = await supabase.auth.getSession();
          nextUserId = session?.user?.id ?? null;
        }
        if (!nextUserId || cancelled) return;

        const { data, error } = await supabase
          .from("profiles")
          .select("preferred_language, secondary_language")
          .eq("id", nextUserId)
          .single();
        if (cancelled || error || !data?.preferred_language) return;

        setLang(resolveToSiteLanguage(data.preferred_language, data.secondary_language));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load user language", error);
        }
      }
    };

    void loadUserLanguage();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      deferSupabaseAuthWork(() => {
        if (!session?.user?.id || cancelled) return;
        return loadUserLanguage(session.user.id);
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams) => {
      const template = translations[key]?.[lang] ?? key;
      if (!params) return template;

      return Object.entries(params).reduce((result, [paramKey, value]) => {
        return result.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(value));
      }, template);
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
