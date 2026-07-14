import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import {
  buildCandidateInfoPrefill,
  emptyCandidateInfo,
  normalizeCandidateInfo,
} from "@/lib/booking-candidate-info";

describe("CandidateInfoForm workRole field", () => {
  it("renders the optional profession field with its placeholder and value", () => {
    const markupIt = renderToStaticMarkup(
      <CandidateInfoForm
        value={{ ...emptyCandidateInfo, workRole: "sviluppatore software" }}
        onChange={() => {}}
        lang="it"
      />,
    );
    expect(markupIt).toContain("Che lavoro fai? (facoltativo)");
    expect(markupIt).toContain("Es. sviluppatore, medico, insegnante...");
    expect(markupIt).toContain("sviluppatore software");

    const markupEn = renderToStaticMarkup(
      <CandidateInfoForm value={emptyCandidateInfo} onChange={() => {}} lang="en" />,
    );
    expect(markupEn).toContain("What do you do for work? (optional)");
  });

  it("keeps workRole through normalization (persisted as jsonb)", () => {
    const normalized = normalizeCandidateInfo({ workRole: "medico" });
    expect(normalized.workRole).toBe("medico");
  });

  it("prefills workRole from the latest candidate info", () => {
    const prefill = buildCandidateInfoPrefill({
      latestCandidateInfo: { ...emptyCandidateInfo, workRole: "insegnante" },
    });
    expect(prefill.workRole).toBe("insegnante");
  });
});
