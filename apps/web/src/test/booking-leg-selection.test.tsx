import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import UserBookingMatrix from "@/components/booking/UserBookingMatrix";
import {
  emptyLegSelection,
  getLegSelectionHint,
  getLegSelectionRole,
  getSelectionRange,
  selectLegOnTap,
} from "@/lib/booking-leg-selection";
import { getBookingApplicationBlocker } from "@/lib/booking-application-gate";
import { emptyCandidateInfo } from "@/lib/booking-candidate-info";
import type { BookableLeg, BookingWaypoint } from "@/lib/booking-utils";

const ordered = ["a", "b", "c", "d"];

const makeLeg = (id: string, sortOrder: number): BookableLeg => ({
  id,
  voyage_id: "v1",
  from_waypoint_id: `w${sortOrder}`,
  to_waypoint_id: `w${sortOrder + 1}`,
  sort_order: sortOrder,
  starts_at_window_start: null,
  starts_at_window_end: null,
  ends_at_window_start: null,
  ends_at_window_end: null,
  is_bookable: true,
});

const waypointsById: Record<string, BookingWaypoint> = Object.fromEntries(
  [0, 1, 2, 3, 4].map((index) => [
    `w${index}`,
    { id: `w${index}`, name_it: `Porto ${index}`, name_en: `Port ${index}` } as BookingWaypoint,
  ])
);

describe("tap-to-select over the leg chain", () => {
  it("opens a one-leg range on the first tap", () => {
    const next = selectLegOnTap(ordered, emptyLegSelection, "b");
    expect(next.legIds).toEqual(["b"]);
    expect(next.anchorLegId).toBe("b");
  });

  it("closes the range on the second tap, taking every leg in between", () => {
    const first = selectLegOnTap(ordered, emptyLegSelection, "b");
    const second = selectLegOnTap(ordered, first, "d");
    expect(second.legIds).toEqual(["b", "c", "d"]);
    expect(second.anchorLegId).toBeNull();
  });

  it("closes the range the same way when the second tap is before the first", () => {
    const first = selectLegOnTap(ordered, emptyLegSelection, "c");
    const second = selectLegOnTap(ordered, first, "a");
    expect(second.legIds).toEqual(["a", "b", "c"]);
  });

  it("starts a new range once the previous one is closed", () => {
    const closed = { legIds: ["a", "b", "c"], anchorLegId: null };
    const next = selectLegOnTap(ordered, closed, "d");
    expect(next.legIds).toEqual(["d"]);
    expect(next.anchorLegId).toBe("d");
  });

  it("clears the selection when the single selected leg is tapped again", () => {
    const first = selectLegOnTap(ordered, emptyLegSelection, "b");
    expect(selectLegOnTap(ordered, first, "b")).toEqual(emptyLegSelection);
  });

  it("ignores a leg that is not part of the voyage", () => {
    const current = { legIds: ["a"], anchorLegId: "a" };
    expect(selectLegOnTap(ordered, current, "zz")).toBe(current);
  });

  it("reads the range and the role of each leg regardless of the stored order", () => {
    const range = getSelectionRange(ordered, ["c", "a", "b"]);
    expect(range).toEqual({ start: 0, end: 2 });
    expect(getLegSelectionRole(0, range)).toBe("start");
    expect(getLegSelectionRole(1, range)).toBe("middle");
    expect(getLegSelectionRole(2, range)).toBe("end");
    expect(getLegSelectionRole(3, range)).toBe("none");
    expect(getLegSelectionRole(0, getSelectionRange(ordered, ["a"]))).toBe("only");
  });

  it("phrases the hint for the step the traveller is on", () => {
    expect(getLegSelectionHint(0, false, "it")).toContain("imbarcarti");
    expect(getLegSelectionHint(1, true, "it")).toContain("sbarcare");
    expect(getLegSelectionHint(3, false, "it")).toContain("ricominciare");
    expect(getLegSelectionHint(0, false, "en")).toContain("board");
  });
});

describe("UserBookingMatrix selection affordances", () => {
  const legs = [makeLeg("a", 0), makeLeg("b", 1), makeLeg("c", 2)];
  const baseProps = {
    lang: "it" as const,
    legs,
    waypointsById,
    saving: false,
    ownRequest: null,
    ownRequestLegIds: [],
    companions: [],
    onDraftLegIdsChange: () => {},
    onSubmitDraft: () => {},
    onProposeChange: () => {},
    onOpenOwnRequest: () => {},
  };

  it("tells the traveller to tap a leg instead of hiding it behind a double click", () => {
    const markup = renderToStaticMarkup(<UserBookingMatrix {...baseProps} draftLegIds={[]} />);
    expect(markup).toContain("Scegli le tue tratte");
    expect(markup).toContain("Tocca qui sotto la tratta da cui vuoi imbarcarti.");
    expect(markup).toContain("Clicca una tratta qui sopra per iniziare");
    expect(markup).not.toContain("Doppio clic");
    // Every leg is a real control, on the grid and in the mobile list alike.
    expect(markup).toContain('aria-label="Seleziona la tratta Porto 0 → Porto 1"');
  });

  it("confirms the selection and offers a way back once legs are picked", () => {
    const markup = renderToStaticMarkup(
      <UserBookingMatrix {...baseProps} draftLegIds={["a", "b"]} />
    );
    expect(markup).toContain("2 tratte selezionate");
    expect(markup).toContain("Ricomincia");
    expect(markup).toContain("Imbarco");
    expect(markup).toContain("Sbarco");
  });

  it("names the missing step instead of leaving a dead disabled button", () => {
    const blocker = getBookingApplicationBlocker(
      {
        voyageSelected: true,
        voyageStillOpen: true,
        selectedLegIds: [],
        candidateInfo: emptyCandidateInfo,
        partySize: 1,
        maxGuests: 4,
        remainingSeatsByLegId: {},
        legLabelById: {},
      },
      "it"
    );
    const markup = renderToStaticMarkup(
      <UserBookingMatrix {...baseProps} draftLegIds={[]} blocker={blocker} />
    );
    expect(markup).toContain("Manca la scelta delle tratte");
    expect(markup).toContain("tocca qui sopra la tratta da cui vuoi imbarcarti");
    // The submit button stays clickable so the refusal can explain itself.
    expect(markup).not.toContain("disabled=\"\"><svg");
  });

  it("shows how many seats are left on each leg", () => {
    const markup = renderToStaticMarkup(
      <UserBookingMatrix
        {...baseProps}
        draftLegIds={[]}
        remainingSeatsByLegId={{ a: 0, b: 2, c: 2 }}
        partySize={2}
      />
    );
    expect(markup).toContain("Nessun posto libero");
    expect(markup).toContain("2 posti liberi");
  });
});

describe("booking application gate", () => {
  const base = {
    voyageSelected: true,
    voyageStillOpen: true,
    selectedLegIds: ["a"],
    candidateInfo: emptyCandidateInfo,
    partySize: 1,
    maxGuests: 4,
    remainingSeatsByLegId: { a: 4 },
    legLabelById: { a: "Porto 0 → Porto 1" },
  };

  it("asks for the legs before anything else", () => {
    const blocker = getBookingApplicationBlocker({ ...base, selectedLegIds: [] }, "it");
    expect(blocker?.step).toBe("legs");
    expect(blocker?.title).toBe("Manca la scelta delle tratte");
  });

  it("points at the candidate form when the legs are there but the profile is not", () => {
    const blocker = getBookingApplicationBlocker(base, "it");
    expect(blocker?.step).toBe("about");
    expect(blocker?.detail).toBe("Seleziona la tua fascia d'eta.");
  });

  it("names the legs that cannot take the whole party", () => {
    const blocker = getBookingApplicationBlocker(
      {
        ...base,
        candidateInfo: {
          ...emptyCandidateInfo,
          sailingKinds: ["sail"],
          navigationRange: "coastal_only",
          ageRange: "25_34",
          languages: ["it"],
          languageLevels: { it: "native" },
          workDuringVoyage: "no",
          foodRegimes: ["omnivore"],
          motivation: "Vorrei partecipare per imparare la vita a bordo in modo concreto.",
        },
        partySize: 3,
        remainingSeatsByLegId: { a: 1 },
      },
      "it"
    );
    expect(blocker?.step).toBe("legs");
    expect(blocker?.detail).toContain("Porto 0 → Porto 1");
  });

  it("returns null once every step is done", () => {
    const blocker = getBookingApplicationBlocker(
      {
        ...base,
        candidateInfo: {
          ...emptyCandidateInfo,
          sailingKinds: ["sail"],
          navigationRange: "coastal_only",
          ageRange: "25_34",
          languages: ["it"],
          languageLevels: { it: "native" },
          workDuringVoyage: "no",
          foodRegimes: ["omnivore"],
          motivation: "Vorrei partecipare per imparare la vita a bordo in modo concreto.",
        },
      },
      "it"
    );
    expect(blocker).toBeNull();
  });
});
