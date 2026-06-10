import { freyjaPhotos, godotPhotos } from "@/data/photos";
import { isItalian } from "@/data/site";

export type DogProfile = {
  id: "godot" | "freyja";
  name: string;
  breed: string;
  sex: string;
  born: string;
  weight: string;
  height: string;
  coat: string;
  base: string;
  passport: string;
  vaccinations: string;
  temperament: string;
  strengths: string[];
  commands: string[];
  environments: string[];
  handlerNotes: string;
  image: string;
};

export const profiles: DogProfile[] = [
  {
    id: "godot",
    name: "Godot",
    breed: "American Akita",
    sex: isItalian ? "Maschio" : "Male",
    born: "2022",
    weight: "48 kg",
    height: "68 cm at withers",
    coat: isItalian ? "Avorio chic, doppio manto fitto" : "Chic ivory, dense double coat",
    base: isItalian ? "Italia · trasferte UE standard" : "Italy · EU travel by default",
    passport: isItalian ? "Passaporto europeo, pronto per viaggiare" : "EU pet passport, travel-ready",
    vaccinations: isItalian ? "Vaccinazioni aggiornate; documenti veterinari su richiesta" : "Current schedule; vet records on request",
    temperament: isItalian
      ? "Osservatore, poco vocale, lavora meglio con una sola voce chiara"
      : "Observant, low chatter, works best with one clear voice",
    strengths: [
      isItalian
        ? "Resta sul mark anche con troupe in movimento dietro di lui: registra il passaggio come sfondo, non come problema."
        : "Settles on a mark while crew crosses behind him; movement reads as background, not a problem.",
      isItalian
        ? "Tiene lo sguardo senza dover trasformare ogni take in una pioggia di premietti."
        : "Holds eye-line without turning every take into a treat negotiation.",
      isItalian
        ? "Accetta grooming e piccoli aggiustamenti di styling se l'handler resta vicino."
        : "Tolerates grooming passes and small styling tweaks when the handler stays close.",
      isItalian
        ? "Fa capire la stanchezza in modo leggibile, prima che diventi un rallentamento per tutti."
        : "Shows fatigue clearly before it becomes a slowdown for everyone.",
    ],
    commands: isItalian
      ? ["Seduto", "Resta", "Terra", "Posto", "Mark", "Piede", "Aspetta", "Guarda", "Tieni"]
      : ["Sit", "Stay", "Down", "Place", "Mark", "Heel", "Wait", "Look", "Hold"],
    environments: isItalian
      ? ["Studio", "Nature", "Mountain", "Urban", "Interni"]
      : ["Studio", "Nature", "Mountain", "Urban", "Interior sets"],
    handlerNotes:
      isItalian
        ? "Godot rende meglio quando una persona sola dà i cue. Tre voci diverse lo sporcano più di quanto lo aiutino. Con pause vere in scaletta, soprattutto per manto e taglia, arriva all'ultima ora ancora composto."
        : "Godot works cleanest when one person gives cues. Three voices make the take messier, not faster. Build real recovery breaks into the schedule, especially for coat and size, and he gives you the last hour looking as composed as the first.",
    image: godotPhotos.studioRed,
  },
  {
    id: "freyja",
    name: "Freyja",
    breed: "Alaskan Malamute",
    sex: isItalian ? "Femmina" : "Female",
    born: "2022",
    weight: "30 kg",
    height: "62 cm at withers",
    coat: isItalian ? "Grigio lupo e bianco, doppio manto morbido" : "Wolf-grey and white, plush double coat",
    base: isItalian ? "Italia · trasferte UE standard" : "Italy · EU travel by default",
    passport: isItalian ? "Passaporto europeo, pronta per viaggiare" : "EU pet passport, travel-ready",
    vaccinations: isItalian ? "Vaccinazioni aggiornate; documenti veterinari su richiesta" : "Current schedule; vet records on request",
    temperament: isItalian
      ? "Affettuosa con le persone, molto espressiva, più felice quando l'aria è fresca"
      : "Warm with people, expressive eyes, happiest when the air is cool",
    strengths: [
      isItalian
        ? "Trova la lente senza dover recitare: utile nei ritratti e negli spazi stretti."
        : "Finds the lens without being asked to perform, useful for portraits and tight rooms.",
      isItalian
        ? "Si muove bene: camminate, corse leggere, salite e discese da pontili o barche."
        : "Comfortable in motion: walking shots, gentle running, docks, and boat boarding.",
      isItalian
        ? "Morbida con persone e bambini quando il set resta ordinato."
        : "Soft around talent and children when the set stays calm.",
      isItalian
        ? "Tiene colore anche con luce piatta; il manto resta leggibile quando il cielo non aiuta."
        : "Carries colour in flat light; the coat still reads when the sky refuses to help.",
    ],
    commands: isItalian
      ? ["Seduta", "Resta", "Terra", "Posto", "Gira", "Piede", "Aspetta", "Touch", "Parla"]
      : ["Sit", "Stay", "Down", "Place", "Spin", "Heel", "Wait", "Touch", "Speak"],
    environments: isItalian
      ? ["Studio", "Natura", "Freddo / neve", "Mare e barca", "Interni"]
      : ["Studio", "Nature", "Snow & cold", "Beach & boat", "Interior sets"],
    handlerNotes:
      isItalian
        ? "Freyja è chiara sulla temperatura: gli esterni estivi a mezzogiorno si valutano, non si danno per scontati. Viaggia bene in auto e in treno; i voli si discutono caso per caso. Con rinforzo positivo resta veloce e presente."
        : "Freyja is honest about temperature. Summer midday exteriors are discussed, not assumed. She travels well by car and train; flights are case by case. Positive reinforcement keeps her quick and present.",
    image: freyjaPhotos.homePortrait,
  },
];
