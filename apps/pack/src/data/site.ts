import { duoPhotos, freyjaPhotos, godotPhotos } from "@/data/photos";

export type SupportedLanguage = "it" | "en";

const detectBrowserLanguage = (): SupportedLanguage => {
  if (typeof navigator === "undefined") return "en";
  const languages = [navigator.language, ...Array.from(navigator.languages ?? [])];
  return languages.some((language) => language.toLowerCase().startsWith("it")) ? "it" : "en";
};

export const currentLanguage = detectBrowserLanguage();
export const isItalian = currentLanguage === "it";

export const navLinks = [
  { id: "overview", label: isItalian ? "Overview" : "Overview" },
  { id: "brands", label: isItalian ? "Brand" : "Brands" },
  { id: "casting", label: "Casting" },
  { id: "profiles", label: isItalian ? "Profili" : "Profiles" },
  { id: "metrics", label: isItalian ? "Metriche" : "Metrics" },
  { id: "work", label: isItalian ? "Progetti" : "Work" },
  { id: "gallery", label: isItalian ? "Galleria" : "Gallery" },
  { id: "contact", label: isItalian ? "Contatti" : "Contact" },
];

export const instagramProfile = {
  handle: "bitespack",
  url: "https://instagram.com/bitespack",
  mediaKitUrl: "https://app.notjustanalytics.com/it/profiles/bitespack",
  profileInfoUrl: "https://api.notjustanalytics.com/insights/ig/profile-info/bitespack",
  supabaseFunctionName: "instagram-metrics",
};

export const publicMetricsMethodology = {
  capturedAt: "2026-04-18",
  sampledPostCount: 25,
  excludesMostRecentPost: false,
  refreshWindow: "24h",
  sourceLabel: "Not Just Analytics",
};

export const uiCopy = isItalian
  ? {
      navDescriptions: {
        overview: "Chi sono, senza giri lunghi.",
        brands: "Partnership, contenuti e formati.",
        casting: "Temperamento, logistica e note da set.",
        profiles: "Schede singole dei due cani.",
        metrics: "Copertura e pubblico, in chiaro.",
        work: "Idee, set e collaborazioni.",
        gallery: "Scatti tra città, strada e mare.",
        contact: "Linea diretta con l'handler.",
      },
      actions: {
        contact: "Scrivici",
        navigate: "Naviga",
        mediaKit: "Apri media kit",
        sendInquiry: "Invia richiesta",
        sending: "Invio...",
      },
      hero: {
        aria: "Storia di Godot e Freyja",
        alt: "Godot e Freyja seduti insieme in studio",
        intro: "Due nordici, una sola gestione. Godot porta calma e peso visivo, Freyja porta luce, ritmo e movimento.",
        kitTitle: "Media kit social",
        scroll: "Scroll",
        stats: {
          weight: "Peso",
          height: "Altezza",
          coat: "Manto",
          set: "Set",
          freyjaSet: "Studio · natura · movimento",
          godotCoat: "Avorio chic",
          godotSet: "Studio · nature · mountain",
        },
      },
      sections: {
        overviewEyebrow: "Il pack",
        overviewTitle: "Due cani, una gestione sola.",
        overviewBody:
          "Godot è più fermo, Freyja più dinamica. Vivono gli stessi luoghi, viaggiano con la stessa persona e arrivano sul set con una routine già rodata.",
        cardLabel: "Nota pack",
        brandEyebrow: "Brand",
        brandTitle: "Per brand che cercano presenza, non numeri da riempire.",
        brandBody:
          "Pet gear, travel, outdoor, hospitality: funziona quando il cane sembra davvero dentro la scena, non appoggiato lì per fare contenuto.",
        castingEyebrow: "Casting",
        castingTitle: "Per produzioni che hanno bisogno di calma quando parte il ciak.",
        castingBody:
          "Luci, microfoni, attese, reset. Entrambi conoscono le parti lente del set, quelle che fanno risparmiare tempo quando tutto intorno corre.",
        profilesEyebrow: "Schede singole",
        profilesTitle: "Due caratteri diversi. Stessa casa, stesso handler.",
        profilesBody:
          "Si possono lavorare separati o insieme. La parte utile, per chi produce, è che gestione, documenti e comunicazione restano in un unico punto.",
        talentCard: "Scheda talent",
        onSet: "Sul set",
        commands: "Comandi",
        environments: "Set",
        handlerNote: "Nota handler",
        duoEyebrow: "Scheda duo",
        duoTitle: "Insieme riempiono la scena senza doverla forzare.",
        duoBody:
          "Un manto scalda l'immagine, l'altro la alleggerisce. Al guinzaglio e in barca hanno già un ritmo comune, quindi la camera può restare larga.",
        duoBestFor: "Funzionano bene per",
        metricsEyebrow: "Reach",
        metricsTitle: "I numeri, senza trucco.",
        metricsBody: `Snapshot pubblico di @${instagramProfile.handle}, aggiornato al massimo ogni ${publicMetricsMethodology.refreshWindow}. La fonte principale è ${publicMetricsMethodology.sourceLabel}.`,
        audienceCountries: "Pubblico · paesi",
        audienceCountriesTitle: "Da dove arrivano salvataggi e visualizzazioni",
        audienceSplit: "Pubblico · split",
        audienceSplitTitle: "Chi guarda",
        highlights: "Highlights",
        topPosts: "I post migliori restano nel kit",
        metricsNote:
          "Schede complete, salvataggi e note di watch-through restano nel profilo Not Just Analytics. Qui teniamo solo le metriche principali.",
        metricsMethod:
          "Metodo: medie sugli ultimi post pubblici disponibili; geografia e split seguono la reportistica Meta/NJA. Se lo scraping non risponde, resta visibile l'ultimo dato in cache.",
      },
      profileFields: {
        sex: "Sesso",
        born: "Anno di nascita",
        weight: "Peso",
        height: "Altezza",
        coat: "Manto",
        base: "Base",
        passport: "Passaporto",
        vaccinations: "Vaccinazioni",
        temperament: "Temperamento",
      },
      contact: {
        eyebrow: "Contatti",
        title: "Parla con l'handler.",
        body: "Casting deck, tariffe, location strane o date già fissate: scrivi qui. Niente inbox terze, niente passaggi inutili.",
        whatsapp: "Scrivi al telefono di bordo",
        based: "Italia · trasferte su richiesta",
      },
    }
  : {
      navDescriptions: {
        overview: "Who they are, without the long pitch.",
        brands: "Partnerships, content, and deliverables.",
        casting: "Temperament, logistics, and set notes.",
        profiles: "Individual talent cards.",
        metrics: "Reach and audience, stated plainly.",
        work: "Concepts, sets, and collaborations.",
        gallery: "Stills from city walks, roads, and water.",
        contact: "Direct line to the handler.",
      },
      actions: {
        contact: "Get in touch",
        navigate: "Navigate",
        mediaKit: "Open media kit",
        sendInquiry: "Send inquiry",
        sending: "Sending...",
      },
      hero: {
        aria: "Godot and Freyja story",
        alt: "Godot and Freyja sitting together on a studio backdrop",
        intro: "Two northern dogs, one handler. Godot brings stillness and visual weight; Freyja brings light, pace, and motion.",
        kitTitle: "Social media kit",
        scroll: "Scroll",
        stats: {
          weight: "Weight",
          height: "Height",
          coat: "Coat",
          set: "Sets",
          freyjaSet: "Studio · nature · motion",
          godotCoat: "Chic ivory",
          godotSet: "Studio · nature · mountain",
        },
      },
      sections: {
        overviewEyebrow: "The pack",
        overviewTitle: "Two dogs, one steady setup.",
        overviewBody:
          "Godot is the still one, Freyja is the mover. They share the same places, the same handler, and a routine that is already built before call time.",
        cardLabel: "Pack note",
        brandEyebrow: "Brand lane",
        brandTitle: "For brands that need presence, not filler.",
        brandBody:
          "Pet gear, travel, outdoor, hospitality: the work lands best when the dog feels genuinely inside the scene, not dropped in to make content.",
        castingEyebrow: "Casting lane",
        castingTitle: "For productions that need calm when the red light is on.",
        castingBody:
          "Lights, booms, waiting, resets. Both dogs know the slow parts of set life, which is usually where time is saved.",
        profilesEyebrow: "Individual files",
        profilesTitle: "Two different temperaments. Same household, same handler.",
        profilesBody:
          "Book them separately or together. Either way, handling, paperwork, and communication stay in one place.",
        talentCard: "Talent card",
        onSet: "On set",
        commands: "Commands",
        environments: "Sets",
        handlerNote: "Handler note",
        duoEyebrow: "Duo file",
        duoTitle: "Together, they fill the frame without forcing it.",
        duoBody:
          "One coat warms the image, the other softens it. On leash and on deck they already share a rhythm, so the camera can stay wide.",
        duoBestFor: "Best when the brief asks for",
        metricsEyebrow: "Reach",
        metricsTitle: "The numbers, without the spin.",
        metricsBody: `Public snapshot for @${instagramProfile.handle}, refreshed at most once every ${publicMetricsMethodology.refreshWindow}. Primary source: ${publicMetricsMethodology.sourceLabel}.`,
        audienceCountries: "Audience · countries",
        audienceCountriesTitle: "Where saves and views come from",
        audienceSplit: "Audience · split",
        audienceSplitTitle: "Who watches",
        highlights: "Highlights",
        topPosts: "Top posts stay in the kit",
        metricsNote:
          "Full cards, saves, and watch-through notes stay in the Not Just Analytics profile. This page mirrors the headline metrics only.",
        metricsMethod:
          "Method: averages use the latest available public posts; geography and audience splits follow Meta/NJA reporting. If scraping fails, the last cached snapshot stays visible.",
      },
      profileFields: {
        sex: "Sex",
        born: "Year of birth",
        weight: "Weight",
        height: "Height",
        coat: "Coat",
        base: "Base location",
        passport: "Passport",
        vaccinations: "Vaccinations",
        temperament: "Temperament",
      },
      contact: {
        eyebrow: "Contact",
        title: "Talk to the handler.",
        body: "Casting decks, rate questions, odd locations, or dates already on the calendar: send them here. No third-party inbox, no pointless forwarding.",
        whatsapp: "Message the boat phone",
        based: "Italy · travel by arrangement",
      },
    };

export const overviewCards = [
  {
    label: "01",
    title: isItalian ? "Contenuti sponsored" : "Sponsored work",
    body: isItalian
      ? "Reel e caroselli dove il prodotto sta in stanze vere, vento vero e cani veri, non in un loft affittato per sembrare spontaneo."
      : "Reels and carousels where the product has to live in real rooms, real wind, and real dogs, not a rented loft pretending to be casual.",
  },
  {
    label: "02",
    title: "Casting & production",
    body: isItalian
      ? "Per call sheet che hanno bisogno di due cani grandi, vaccinati, assicurati e abituati a un set che si muove intorno."
      : "For call sheets that need two large dogs vaccinated, insured, and used to a set moving around them.",
  },
  {
    label: "03",
    title: isItalian ? "Outdoor e barca" : "Outdoor & boat life",
    body: isItalian
      ? "Aria salata, pontili, coperte bagnate, luce bassa. Sono ambienti che conoscono gia, non scenografie da scoprire il giorno dello shooting."
      : "Salt air, wet decks, low light on the pontoon. These are places they already know, not sets they meet for the first time on shoot day.",
  },
  {
    label: "04",
    title: isItalian ? "Singoli o insieme" : "Solo or together",
    body: isItalian
      ? "Godot quando serve peso visivo, Freyja quando serve movimento. Insieme quando il contrasto deve essere naturale."
      : "Godot when the frame needs weight, Freyja when it needs motion. Together when contrast should feel natural.",
  },
  {
    label: "05",
    title: isItalian ? "Un handler" : "One handler",
    body: isItalian
      ? "Niente passaggi di mano casuali. Una voce sola mantiene puliti i cue e piu leggibile il lavoro dei cani."
      : "No random hand-offs. One voice on set keeps cues clean and the dogs easier to read.",
  },
  {
    label: "06",
    title: isItalian ? "Europa prima di tutto" : "Europe-first travel",
    body: isItalian
      ? "Italia come base, documenti UE pronti, trasferte valutate prima. Non si improvvisa la sera prima."
      : "Italy as the base, EU paperwork ready, travel discussed early. No last-minute improvising.",
  },
];

export const brandSubsections = [
  {
    title: "Where they fit",
    body: "Outdoor brands, slow travel, pet accessories with weight, hospitality that still believes in dogs in the lobby — anywhere the frame should feel lived-in.",
  },
  {
    title: "Who watches",
    body: "People who save boat tours they will never book, who buy expensive leashes, who argue about light in the comments. The audience skews toward design and weather, not tricks.",
  },
  {
    title: "How it looks",
    body: "Natural light first, minimal staging, colour that follows the hour of day instead of a LUT someone found on sale.",
  },
  {
    title: "What ships",
    body: "Vertical cuts, story stacks, stills for print, behind-the-scenes for the team chat — delivered with filenames that make editors less angry.",
  },
];

export const castingSubsections = [
  {
    title: "Temperament on the floor",
    body: "Both dogs have been walked through the boring parts of set life — marks, resets, strangers walking past — until it reads as routine, not theatre.",
  },
  {
    title: "Handling",
    body: "One experienced owner-handler on the day. Cues stay consistent, breaks stay honest, and nobody improvises a new command because the clock is loud.",
  },
  {
    title: "Paperwork",
    body: "EU pet passports, vaccination history, insurance, grooming call before camera — the unglamorous stack that keeps production legal and calm.",
  },
  {
    title: "Travel",
    body: "Italy and the wider EU by default; further afield when the schedule and climate make sense for thick coats and long holds.",
  },
];

export const metrics = [
  { label: isItalian ? "Follower Instagram" : "Instagram followers", value: 863, suffix: "" },
  { label: "Engagement rate", value: 12.16, suffix: "%" },
  { label: isItalian ? "Like medi / post" : "Avg. likes / post", value: 74, suffix: "" },
  { label: isItalian ? "Commenti medi / post" : "Avg. comments / post", value: 6, suffix: "" },
  { label: isItalian ? "Post analizzati" : "Posts sampled", value: 25, suffix: "" },
  { label: isItalian ? "Post totali" : "Total posts", value: 91, suffix: "" },
];

export const topCountries = [
  { label: "Italy", value: 62 },
  { label: "United States", value: 7 },
  { label: "Germany", value: 3 },
  { label: "France", value: 2 },
  { label: "United Kingdom", value: 2 },
  { label: "Other", value: 24 },
];

export const languages = [
  { label: isItalian ? "Pubblico femminile" : "Female audience", value: 40 },
  { label: isItalian ? "Pubblico maschile" : "Male audience", value: 32 },
  { label: isItalian ? "Non indicato" : "Undefined / not disclosed", value: 27 },
];

export const partnerships = [
  {
    brand: "Marine safety",
    type: "Concept — life aboard",
    deliverables: "Hero stills · vertical cut · story sequence",
    outcome: "Imagery that treats the boat as workplace, not wallpaper.",
    image: freyjaPhotos.foodBoat,
  },
  {
    brand: "Outdoor kit",
    type: "Concept — gear in use",
    deliverables: "Carousel · packshots on location · UGC pack",
    outcome: "Product held by dogs that already live outside the studio walls.",
    image: godotPhotos.lifeJacket,
  },
  {
    brand: "Travel & family",
    type: "Concept — duo narrative",
    deliverables: "Campaign stills · duo set · vertical cutdown",
    outcome: "Two silhouettes, one scene — contrast without choreography.",
    image: duoPhotos.sunsetBoat,
  },
];

export const galleryItems = [
  { src: duoPhotos.studioTight, category: "Duo", alt: "Godot and Freyja duo portrait in studio" },
  { src: duoPhotos.studioWide, category: "Studio", alt: "Godot and Freyja full-body studio portrait" },
  { src: duoPhotos.sunsetBoat, category: "Boat", alt: "Godot and Freyja aboard the sailboat at sunset" },
  { src: duoPhotos.countryside, category: "Outdoor", alt: "Godot and Freyja in the countryside" },
  { src: duoPhotos.dogRun, category: "Outdoor", alt: "Godot and Freyja in the dog park" },
  { src: duoPhotos.twilightHarbor, category: "Duo", alt: "Godot and Freyja together near the harbor at sunset" },
  { src: duoPhotos.eventPoster, category: "Events", alt: "Godot and Freyja featured at pet event" },
  { src: godotPhotos.editorialWithHandler, category: "Lifestyle", alt: "Godot with handler during golden hour" },
  { src: godotPhotos.bariCloseup, category: "Portraits", alt: "Close portrait of Godot in Bari" },
  { src: godotPhotos.lifeJacket, category: "Boat", alt: "Godot wearing a life jacket on board" },
  { src: godotPhotos.pumpkinPortrait, category: "Seasonal", alt: "Godot posed among pumpkins" },
  { src: godotPhotos.bariPortrait, category: "City", alt: "Godot by the sea in Bari" },
  { src: godotPhotos.seaPose, category: "City", alt: "Godot posed by the sea near a street lamp" },
  { src: godotPhotos.outdoorPortrait, category: "Portraits", alt: "Outdoor portrait of Godot with pumpkins in the background" },
  { src: godotPhotos.pumpkinSide, category: "Seasonal", alt: "Profile portrait of Godot among pumpkins" },
  { src: godotPhotos.atHelm, category: "Boat", alt: "Godot at the helm of the sailboat" },
  { src: godotPhotos.studioRed, category: "Studio", alt: "Godot studio portrait through red paper" },
  { src: godotPhotos.barbieEvent, category: "Events", alt: "Godot on pink carpet at Barbie exhibition" },
  { src: godotPhotos.gangway, category: "Boat", alt: "Godot on the gangway of the boat" },
  { src: freyjaPhotos.brindisi, category: "City", alt: "Freyja in Brindisi at sunset" },
  { src: freyjaPhotos.homePortrait, category: "Portraits", alt: "Portrait of Freyja indoors" },
  { src: freyjaPhotos.waiting, category: "Lifestyle", alt: "Freyja waiting on the sidewalk" },
  { src: freyjaPhotos.benchLook, category: "Lifestyle", alt: "Freyja lying down outdoors" },
  { src: freyjaPhotos.redBackdropWide, category: "Studio", alt: "Freyja portrait through red paper backdrop" },
  { src: freyjaPhotos.wetPortrait, category: "Water", alt: "Wet portrait of Freyja in shallow water" },
  { src: freyjaPhotos.redBackdropPortrait, category: "Studio", alt: "Freyja studio portrait with red backdrop" },
  { src: freyjaPhotos.wetWater, category: "Water", alt: "Freyja standing in the water" },
  { src: freyjaPhotos.foodBoat, category: "Boat", alt: "Freyja aboard the boat looking at food" },
  { src: freyjaPhotos.goldenTongue, category: "Boat", alt: "Close portrait of Freyja during golden hour on the boat" },
  { src: freyjaPhotos.goldenHour, category: "Boat", alt: "Freyja on the boat at golden hour" },
  { src: freyjaPhotos.cutePortrait, category: "Portraits", alt: "Cute close portrait of Freyja" },
  { src: freyjaPhotos.couch, category: "Lifestyle", alt: "Freyja relaxed on the couch" },
  { src: freyjaPhotos.flowersClose, category: "Outdoor", alt: "Freyja among purple flowers" },
  { src: freyjaPhotos.seafront, category: "City", alt: "Freyja by the seafront" },
  { src: freyjaPhotos.wetClose, category: "Water", alt: "Freyja wet and smiling in the water" },
  { src: freyjaPhotos.park, category: "Outdoor", alt: "Freyja in the countryside with a red bandana" },
  { src: freyjaPhotos.cityPortrait, category: "City", alt: "Freyja in Piazza Liberty" },
  { src: freyjaPhotos.flowersField, category: "Outdoor", alt: "Freyja in a field with dandelions" },
  { src: freyjaPhotos.sneeze, category: "Lifestyle", alt: "Freyja sneezing on the boat" },
  { src: freyjaPhotos.lookout, category: "Boat", alt: "Freyja looking out from the boat" },
  { src: freyjaPhotos.beachNight, category: "Water", alt: "Freyja on the beach at night" },
];

export const galleryCategories = [
  "All",
  "Portraits",
  "Studio",
  "Lifestyle",
  "Outdoor",
  "Boat",
  "Water",
  "Duo",
  "City",
  "Seasonal",
  "Events",
] as const;

export const services = [
  { title: isItalian ? "Reel sponsored" : "Sponsored reels", body: isItalian ? "Dal concept al montaggio: vertical first, audio pensato per telefono, ritmo senza effetto spot finto." : "From concept to grade: vertical first, sound built for phones, and pacing that does not feel like a fake ad." },
  { title: isItalian ? "Story arc" : "Story arcs", body: isItalian ? "Sequenze con un inizio e una chiusura, non cinque frame casuali e uno sticker." : "Sequences with a beginning and an end, not five random frames and a sticker." },
  { title: "Carousels", body: isItalian ? "Pacing editoriale per chi guarda con calma e legge ancora le caption." : "Editorial pacing for people who still swipe slowly and read captions." },
  { title: "UGC packs", body: isItalian ? "Cut piu sciolti per canali brand-owned: mano libera, tono onesto, imperfezioni controllate." : "Looser cuts for brand-owned channels: handheld, honest, and intentionally a little imperfect." },
  { title: isItalian ? "Prodotto in scena" : "Product in scene", body: isItalian ? "Gear mostrato dove viene usato davvero: sale, fango, moquette d'hotel, vetroresina di barca." : "Gear shown where it actually gets used: salt, mud, hotel carpet, boat fibreglass." },
  { title: isItalian ? "Giornate campagna" : "Campaign days", body: isItalian ? "Shooting full-day con un handler, pause in scaletta e shot list compatibile con manti importanti." : "Full-day shoots with one handler, scheduled breaks, and a shot list that respects heavy coats." },
  { title: isItalian ? "Still modelling" : "Still modelling", body: isItalian ? "Stills editoriali e commerciali con mark sensati per cani veri, non per pose impossibili." : "Editorial and commercial stills with marks that make sense for real dogs, not impossible poses." },
  { title: isItalian ? "Duo days" : "Duo days", body: isItalian ? "Due cani, una timeline: utile quando luce, styling e gestione devono muoversi insieme." : "Two dogs, one timeline, useful when light, styling, and handling need to move together." },
  { title: isItalian ? "Travel e barca" : "Travel & boat", body: isItalian ? "Location su pontili, deck e strade, con logistica chiara prima che qualcuno prepari il drone." : "Location work on docks, decks, and roads, with logistics clear before anyone packs a drone." },
  { title: isItalian ? "Retainer custom" : "Custom retainers", body: isItalian ? "Architetture piu lunghe per brand che vogliono coerenza di stagione, non un post isolato." : "Longer arcs for brands that want season-long coherence instead of one-off posts." },
];

export const whyPoints = [
  { title: "Silhouette", body: "Two large northern breeds read instantly on a small screen — no explaining the breed in the caption." },
  { title: "Real context", body: "Harbour mornings and apartment evenings are already their default; the camera rarely has to invent a life." },
  { title: "Discipline", body: "Marks, waits, and resets are rehearsed like a craft, not performed like a trick for treats." },
  { title: "Modular booking", body: "Solo days when the script calls for one dog, duo days when contrast carries the scene." },
  { title: "Production hygiene", body: "Paperwork, insurance, grooming windows — handled before the van arrives, not during lunch." },
  { title: "Quiet sets", body: "Temperament that does not need chaos to look interesting — useful when the sound department is already tired." },
];

export const pressKitItems = [
  { title: "Media kit", body: "PDF overview for brands — rates on request inside.", action: "Request media kit" },
  { title: "Casting sheet", body: "Measurements, temperament, travel — formatted for agents.", action: "Request casting sheet" },
  { title: "Rate card", body: "Numbers for budgets that already cleared legal.", action: "Request rate card" },
  { title: "Metrics deck", body: "Followers, saves, geography — refreshed on a fixed cadence.", action: "Request metrics" },
  { title: "Portfolio deck", body: "Selected stills and treatments from recent seasons.", action: "Request portfolio" },
];
