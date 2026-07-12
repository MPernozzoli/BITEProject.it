import type { Language } from "./language.js";
import type { BookingSettings } from "./booking-utils.js";

export type BookingBriefingKey = "first" | "second";

const FIRST_BRIEFING_IT = `Benvenuto a bordo. Questo primo briefing arriva appena la tua partecipazione e confermata: contiene le informazioni pratiche da considerare prima di organizzare gli spostamenti e preparare il bagaglio.

Spostamenti da/per l'imbarco: pianifica con mezzi modificabili quando possibile. Se acquisti biglietti non flessibili, valuta una assicurazione viaggio che consenta rimborso o cambio data in caso di variazioni operative.

Bagaglio: in barca non si portano valigie rigide, trolley o simili. Scegli una sacca morbida o uno zaino di medie dimensioni: si stiva meglio e in cabina occupa meno spazio.

Cosa portare: anche se si va per mare, alcune navigazioni sono notturne o al largo e puo fare fresco. Porta almeno una camicia pesante, un pile o una giacca antivento. A bordo non si usano scarpe con suola scura: consigliamo scarpe adatte all'acqua e dedicate solo alla barca.

Saponi, detersivi e crema solare: non serve portare saponi o detersivi da casa, che comunque non si possono usare a bordo per ragioni ambientali. La crema solare e gia in barca.`;

const FIRST_BRIEFING_EN = `Welcome aboard. This first briefing is sent as soon as your participation is confirmed: it covers the practical information to consider before booking transfers and packing.

Travel to/from the embarkation point: plan with flexible transport where possible. If you buy non-flexible tickets, consider travel insurance that allows refund or date changes in case the operational plan changes.

Luggage: hard suitcases, trolleys and similar rigid luggage cannot be brought aboard. Choose a soft duffel or a medium backpack: it is easier to stow and takes less cabin space.

What to bring: even though this is a sea voyage, some passages happen at night or offshore and it can get cool. Bring at least a warm shirt, fleece or windbreaker. Dark-soled shoes cannot be used aboard: we recommend water-friendly shoes dedicated only to boat use.

Soap, detergents and sunscreen: there is no need to bring household soap or detergents, which cannot be used aboard for environmental reasons. Sunscreen is already on board.`;

const SECOND_BRIEFING_IT = `Secondo briefing operativo: qui raccogliamo le informazioni utili per vivere bene la barca durante il viaggio.

Lavaggio e abbigliamento: a bordo non c'e una lavatrice. I vestiti si lavano a mano in un secchio, quindi porta capi semplici da lavare e asciugare. Le cose in barca si consumano facilmente e non sono previste sfilate: la maglietta della salute batte il vestito di marca.

Intrattenimento: la barca ha Starlink per una connessione veloce e illimitata, radio con casse interne ed esterne e un proiettore per i film serali. Non serve portare casse Bluetooth o altra attrezzatura.

Tecnologia: a bordo trovi prese elettriche tipo L e tipo F, piu prese USB-A e USB-C per ricaricare i dispositivi.

Cibo e frigo: ci sono due frigoriferi con un piccolo congelatore, quindi niente ghiaccio in quantita. Puoi portare pietanze che vorresti mangiare o condividere, ma considera spazio, tempi e conservazione.

Posti ed esperienze: sentiti libero di proporre luoghi da vedere, soste o esperienze lungo la rotta. Le migliori idee entrano nel piano quando meteo, tempi e sicurezza lo permettono.`;

const SECOND_BRIEFING_EN = `Second operational briefing: this collects useful information for living aboard during the voyage.

Laundry and clothing: there is no washing machine aboard. Clothes are washed by hand in a bucket, so bring items that are easy to wash and dry. Things wear out quickly on a boat and there are no fashion shows underway: practical beats branded.

Entertainment: the boat has Starlink for fast unlimited internet, radio with indoor and outdoor speakers, and a projector for evening movies. You do not need to bring Bluetooth speakers or extra gear.

Technology: aboard you will find Type L and Type F power sockets, plus USB-A and USB-C charging ports.

Food and fridge space: there are two fridges with a small freezer, so no large amounts of ice. You can bring food you would like to eat or share, but consider space, timing and storage.

Places and experiences: feel free to suggest places to see, stops or experiences along the route. The best ideas enter the plan when weather, timing and safety allow it.`;

export const DEFAULT_BOOKING_BRIEFINGS = {
  first: {
    it: FIRST_BRIEFING_IT,
    en: FIRST_BRIEFING_EN,
  },
  second: {
    it: SECOND_BRIEFING_IT,
    en: SECOND_BRIEFING_EN,
  },
} as const;

export function getBookingBriefingContent(
  settings: BookingSettings | null | undefined,
  key: BookingBriefingKey,
  lang: Language | "it" | "en"
) {
  const primary = lang === "it" ? "it" : "en";
  const secondary = primary === "it" ? "en" : "it";
  const firstIt = settings?.first_briefing_content_it || settings?.briefing_content_it;
  const firstEn = settings?.first_briefing_content_en || settings?.briefing_content_en;
  const secondIt = settings?.second_briefing_content_it;
  const secondEn = settings?.second_briefing_content_en;
  const content = {
    first: { it: firstIt, en: firstEn },
    second: { it: secondIt, en: secondEn },
  }[key];

  return content[primary] || content[secondary] || DEFAULT_BOOKING_BRIEFINGS[key][primary];
}
