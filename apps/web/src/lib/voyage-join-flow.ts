/**
 * The wording and the button state of the "partecipa" flow that now runs on the voyage page
 * itself, instead of handing the traveller over to /bookings.
 *
 * Everything here is a pure function on purpose: the section, the sticky bar and the tests all
 * have to say exactly the same thing about which of the three steps you are on, what to touch
 * next and what the button is about to do. The moment two of them disagree, the flow stops
 * being obvious — and "obvious" is the whole point of doing this in place.
 */

export type VoyageJoinStage =
  /** Legs are shown read-only; the CTA opens the selection. */
  | "intro"
  /** Legs are tappable and the CTA carries the selection forward. */
  | "picking";

export type VoyageJoinStepNumber = 1 | 2 | 3;
export type VoyageJoinStepState = "done" | "active" | "todo";

export interface VoyageJoinStep {
  number: VoyageJoinStepNumber;
  title: string;
  detail: string;
  state: VoyageJoinStepState;
}

/**
 * The three steps, always all visible, so the traveller can see where they are and how much is
 * left — a progress bar made of sentences rather than a bar.
 */
export function getVoyageJoinSteps(
  activeNumber: VoyageJoinStepNumber,
  lang: "it" | "en"
): VoyageJoinStep[] {
  const it = lang === "it";
  const definitions: { number: VoyageJoinStepNumber; title: string; detail: string }[] = [
    {
      number: 1,
      title: it ? "Scegli le tratte" : "Pick your legs",
      detail: it
        ? "Tocca la tratta da cui vuoi imbarcarti e quella in cui vuoi sbarcare."
        : "Tap the leg you want to board on and the one you want to get off at.",
    },
    {
      number: 2,
      title: it ? "Dicci di te" : "Tell us about you",
      detail: it
        ? "Quante persone siete e qualche informazione utile per la vita a bordo."
        : "How many of you there are, plus a few things that matter for life on board.",
    },
    {
      number: 3,
      title: it ? "Conferma e paga" : "Confirm and pay",
      detail: it
        ? "Accetti le condizioni e versi il contributo: solo allora la candidatura parte."
        : "You accept the conditions and pay the contribution: only then is the application sent.",
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    state:
      definition.number < activeNumber ? "done" : definition.number === activeNumber ? "active" : "todo",
  }));
}

export interface VoyageJoinCta {
  /** What pressing the button does next — the panel maps this onto the actual handler. */
  kind: "start" | "continue" | "closed";
  label: string;
  /** The line under the button: what happens right after the tap. Never left empty. */
  helper: string;
  enabled: boolean;
}

export interface VoyageJoinCtaInput {
  stage: VoyageJoinStage;
  selectedCount: number;
  /** True while a first leg has been tapped and the range is still open on it. */
  anchorOpen: boolean;
  /** False when the voyage has no leg anyone could still book. */
  hasSelectableLegs: boolean;
}

const legCountLabel = (count: number, lang: "it" | "en") =>
  lang === "it"
    ? `${count} ${count === 1 ? "tratta" : "tratte"}`
    : `${count} ${count === 1 ? "leg" : "legs"}`;

/**
 * The sticky button, which is the only control the traveller ever has to find. It is never
 * silently dead: when it can't move forward it still says, in the helper line, what is missing.
 */
export function getVoyageJoinCta(input: VoyageJoinCtaInput, lang: "it" | "en"): VoyageJoinCta {
  const it = lang === "it";

  if (!input.hasSelectableLegs) {
    return {
      kind: "closed",
      label: it ? "Adesioni chiuse" : "Applications closed",
      helper: it
        ? "Al momento non ci sono tratte su cui imbarcarsi."
        : "There are no legs open to board right now.",
      enabled: false,
    };
  }

  if (input.stage === "intro") {
    return {
      kind: "start",
      label: it ? "Partecipa" : "Join this voyage",
      helper: it
        ? "Primo passo: scegli qui sotto le tratte che vuoi navigare."
        : "First step: pick below the legs you want to sail.",
      enabled: true,
    };
  }

  if (input.selectedCount === 0) {
    return {
      kind: "continue",
      label: it ? "Avanti" : "Next",
      helper: it
        ? "Prima tocca qui sopra la tratta da cui vuoi imbarcarti."
        : "First tap above the leg you want to board on.",
      enabled: false,
    };
  }

  if (input.anchorOpen) {
    return {
      kind: "continue",
      label: it
        ? `Avanti con ${legCountLabel(input.selectedCount, lang)}`
        : `Next with ${legCountLabel(input.selectedCount, lang)}`,
      helper: it
        ? "Oppure tocca la tratta in cui vuoi sbarcare: prendiamo anche quelle in mezzo."
        : "Or tap the leg you want to get off at — everything in between comes with it.",
      enabled: true,
    };
  }

  return {
    kind: "continue",
    label: it
      ? `Avanti · ${legCountLabel(input.selectedCount, lang)}`
      : `Next · ${legCountLabel(input.selectedCount, lang)}`,
    helper: it
      ? "Ti chiediamo quante persone siete e qualche informazione su di te."
      : "We'll ask how many of you there are and a few things about you.",
    enabled: true,
  };
}

export interface LegSelectionSummary {
  count: number;
  /** Where the traveller boards, and where they leave — the two names that matter. */
  fromLabel: string | null;
  toLabel: string | null;
  nauticalMiles: number;
}

/**
 * Reduces a selection to the one line that belongs on the sticky bar: "Atene → Siracusa",
 * plus the figures the bar shows next to it. Order comes from the leg list, not from the tap
 * order, so a range picked backwards still reads in the direction of travel.
 */
export function summarizeLegSelection<
  Leg extends { id: string; from_waypoint_id: string; to_waypoint_id: string; planned_nautical_miles?: number | null }
>(
  orderedLegs: Leg[],
  selectedLegIds: string[],
  waypointLabel: (waypointId: string) => string
): LegSelectionSummary {
  const selected = orderedLegs.filter((leg) => selectedLegIds.includes(leg.id));
  if (selected.length === 0) return { count: 0, fromLabel: null, toLabel: null, nauticalMiles: 0 };

  const nauticalMiles = selected.reduce((total, leg) => {
    const nm = Number(leg.planned_nautical_miles ?? 0);
    return total + (Number.isFinite(nm) && nm > 0 ? nm : 0);
  }, 0);

  return {
    count: selected.length,
    fromLabel: waypointLabel(selected[0].from_waypoint_id),
    toLabel: waypointLabel(selected[selected.length - 1].to_waypoint_id),
    nauticalMiles: Math.round(nauticalMiles),
  };
}
