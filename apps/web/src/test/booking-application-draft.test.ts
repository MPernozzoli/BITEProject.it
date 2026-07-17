import { describe, expect, it, beforeEach } from "vitest";
import {
  buildBookingApplicationDraft,
  clearLocalBookingApplicationDraft,
  getLocalBookingApplicationDraft,
  isBookingApplicationDraftEmpty,
  saveLocalBookingApplicationDraft,
} from "@/lib/booking-application-draft";
import { emptyCandidateInfo } from "@/lib/booking-candidate-info";

describe("booking application drafts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and clears a local draft per voyage", () => {
    const draft = buildBookingApplicationDraft({
      voyageId: "voyage-1",
      selectedLegIds: ["leg-1", "leg-2"],
      partySize: "2",
      message: "Preferiamo la seconda tratta",
      candidateInfo: {
        ...emptyCandidateInfo,
        motivation: "Vorrei partecipare per imparare la vita a bordo in modo concreto.",
      },
    });

    saveLocalBookingApplicationDraft(draft);

    expect(getLocalBookingApplicationDraft("voyage-1")).toMatchObject({
      voyageId: "voyage-1",
      selectedLegIds: ["leg-1", "leg-2"],
      partySize: "2",
      message: "Preferiamo la seconda tratta",
    });
    expect(getLocalBookingApplicationDraft("other-voyage")).toBeNull();

    clearLocalBookingApplicationDraft("voyage-1");
    expect(getLocalBookingApplicationDraft("voyage-1")).toBeNull();
  });

  it("treats the untouched default form as empty", () => {
    expect(
      isBookingApplicationDraftEmpty({
        selectedLegIds: [],
        partySize: "1",
        message: "",
        candidateInfo: emptyCandidateInfo,
      })
    ).toBe(true);
  });
});
