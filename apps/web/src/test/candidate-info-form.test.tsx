import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import {
  buildCandidateInfoPrefill,
  withPhoneFallback,
  emptyCandidateInfo,
  getCandidateInfoValidationError,
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

  it("validates required candidate info fields before confirmation", () => {
    expect(getCandidateInfoValidationError(emptyCandidateInfo, "it")).toBe(
      "Scegli il prefisso internazionale del tuo telefono.",
    );

    const missingAllergyDetails = {
      ...emptyCandidateInfo,
      phoneCountryCode: "+39",
      phoneNumber: "3331234567",
      sailingKinds: ["sail"],
      navigationRange: "coastal_only",
      ageRange: "25_34",
      languages: ["it"],
      languageLevels: { it: "native" as const },
      workDuringVoyage: "no",
      foodRegimes: ["allergies"],
      motivation: "Vorrei partecipare per imparare la vita a bordo.",
    };
    expect(getCandidateInfoValidationError(missingAllergyDetails, "it")).toBe(
      "Aggiungi i dettagli delle allergie o intolleranze.",
    );

    expect(
      getCandidateInfoValidationError(
        {
          ...missingAllergyDetails,
          allergies: "Noci",
        },
        "it",
      ),
    ).toBeNull();
  });

  it("prefills the phone from the profile, over the one in the last application", () => {
    const prefill = buildCandidateInfoPrefill({
      latestCandidateInfo: { ...emptyCandidateInfo, phoneCountryCode: "+39", phoneNumber: "3330000000" },
      profilePhone: { phone_country_code: "+44", phone_number: "7700900123" },
    });
    expect(prefill.phoneCountryCode).toBe("+44");
    expect(prefill.phoneNumber).toBe("7700900123");
  });

  it("defaults the prefix to +39 only for an Italian-speaking profile with no phone yet", () => {
    expect(buildCandidateInfoPrefill({ preferredLanguage: "it" }).phoneCountryCode).toBe("+39");
    expect(buildCandidateInfoPrefill({ preferredLanguage: "en" }).phoneCountryCode).toBe("");
  });

  it("fills a restored draft without a phone, but never overwrites one being typed", () => {
    const prefill = { ...emptyCandidateInfo, phoneCountryCode: "+39", phoneNumber: "3331234567" };
    expect(withPhoneFallback(emptyCandidateInfo, prefill).phoneNumber).toBe("3331234567");
    const typing = { ...emptyCandidateInfo, phoneCountryCode: "+39", phoneNumber: "" };
    expect(withPhoneFallback(typing, prefill)).toBe(typing);
  });
});
