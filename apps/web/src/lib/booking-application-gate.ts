import { getCandidateInfoValidationError, type CandidateInfo } from "@/lib/booking-candidate-info";

/**
 * The single place that answers "why can't this application be sent yet?".
 *
 * The form used to hide the answer behind a disabled button: nothing happened on click and
 * nothing said which step was missing. Every gate now names the step it belongs to, so the
 * page can say it inline, scroll to it and still raise the same message as a toast without
 * the two drifting apart.
 */
export type BookingApplicationStep = "voyage" | "legs" | "party" | "about";

export interface BookingApplicationBlocker {
  step: BookingApplicationStep;
  /** Short headline naming the missing step, e.g. "Manca la scelta delle tratte". */
  title: string;
  /** What to actually do about it. Also used as the toast message. */
  detail: string;
}

export interface BookingApplicationGateInput {
  voyageSelected: boolean;
  /** False when the voyage closed to applications while the form was open. */
  voyageStillOpen: boolean;
  selectedLegIds: string[];
  candidateInfo: CandidateInfo;
  partySize: number;
  maxGuests: number;
  /** Seats left per leg; a leg missing from the map is treated as unconstrained. */
  remainingSeatsByLegId: Record<string, number>;
  /** Human leg labels, used to name the legs that are too tight for the party. */
  legLabelById: Record<string, string>;
}

export function getBookingApplicationBlocker(
  input: BookingApplicationGateInput,
  lang: "it" | "en"
): BookingApplicationBlocker | null {
  const it = lang === "it";

  if (!input.voyageSelected) {
    return {
      step: "voyage",
      title: it ? "Scegli il viaggio" : "Pick the voyage",
      detail: it ? "Seleziona prima un viaggio." : "Select a voyage first.",
    };
  }

  if (input.selectedLegIds.length === 0) {
    return {
      step: "legs",
      title: it ? "Manca la scelta delle tratte" : "The legs are still missing",
      detail: it
        ? "Seleziona almeno una tratta: tocca qui sopra la tratta da cui vuoi imbarcarti."
        : "Select at least one leg: tap above the leg you want to board on.",
    };
  }

  if (!input.voyageStillOpen) {
    return {
      step: "voyage",
      title: it ? "Viaggio chiuso alle adesioni" : "Voyage closed to applications",
      detail: it
        ? "Questo viaggio non è più aperto alle adesioni."
        : "This voyage is no longer open to join.",
    };
  }

  const candidateInfoError = getCandidateInfoValidationError(input.candidateInfo, lang);
  if (candidateInfoError) {
    return {
      step: "about",
      title: it ? "Manca qualcosa in «Dicci di te»" : "Something is missing in “Tell us about you”",
      detail: candidateInfoError,
    };
  }

  const maxGuests = Math.max(1, input.maxGuests || 1);
  if (input.partySize > maxGuests) {
    return {
      step: "party",
      title: it ? "Troppe persone" : "Too many people",
      detail: it
        ? `Per questo viaggio puoi richiedere al massimo ${maxGuests} persone.`
        : `You can request at most ${maxGuests} people for this voyage.`,
    };
  }

  // A party only fits where there is room for *all* of it: an application the organiser could
  // never approve as-is is worse than a refusal here, because the contribution is paid first.
  const tooTightLegIds = input.selectedLegIds.filter(
    (legId) =>
      legId in input.remainingSeatsByLegId && input.remainingSeatsByLegId[legId] < input.partySize
  );
  if (tooTightLegIds.length > 0) {
    const labels = tooTightLegIds.map((legId) => input.legLabelById[legId]).filter(Boolean);
    return {
      step: "legs",
      title: it ? "Posti insufficienti su alcune tratte" : "Not enough seats on some legs",
      detail: it
        ? `Non ci sono ${input.partySize} posti liberi su: ${labels.join(", ")}. Riduci il numero di persone o togli queste tratte.`
        : `There aren't ${input.partySize} free seats on: ${labels.join(", ")}. Reduce the party size or remove these legs.`,
    };
  }

  return null;
}
