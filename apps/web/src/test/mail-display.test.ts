import { describe, expect, it } from "vitest";
import { mailDisplaySender, mailPrimaryPreview, splitQuotedMailText } from "@/lib/mail-display";

const baseMessage = {
  from_address: "massimo.pernozzoli@gmail.com",
  from_name: null,
  html_body: null,
};

describe("mail display helpers", () => {
  it("uses from_name before inferred sender names", () => {
    expect(
      mailDisplaySender({
        ...baseMessage,
        from_name: "Massimo Gmail",
        text_body: "Ciao\n\nMassimo Pernozzoli",
      }),
    ).toBe("Massimo Gmail");
  });

  it("infers a sender name from the new-message signature before falling back to the address", () => {
    expect(
      mailDisplaySender({
        ...baseMessage,
        text_body: "Prova prova\n\nMassimo Pernozzoli\nPerito ed Urbanista\nmpernozzoli@icloud.com",
      }),
    ).toBe("Massimo Pernozzoli");
  });

  it("keeps preview text limited to the new message before quoted replies", () => {
    const text =
      "Prova prova\n\nMassimo Pernozzoli\n\nIl giorno 12 lug 2026, alle ore 15:45, BITE <hello@biteproject.it> ha scritto:\n\nProva";

    expect(mailPrimaryPreview({ ...baseMessage, text_body: text })).toBe("Prova prova Massimo Pernozzoli");
  });

  it("splits quoted email text and extracts the quoted sender", () => {
    const split = splitQuotedMailText(
      "Risposta\n\nIl giorno 12 lug 2026, alle ore 15:45, BITE <hello@biteproject.it> ha scritto:\n\n> Messaggio precedente",
    );

    expect(split.visibleLines.join("\n")).toBe("Risposta\n");
    expect(split.quotedSender).toBe("BITE");
    expect(split.quotedLines.join("\n")).toContain("Messaggio precedente");
  });
});
