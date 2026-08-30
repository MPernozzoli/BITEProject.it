/**
 * La regola dei tracker vive due volte: in `lib/utm.ts` per il sito e i tool
 * MCP, e in `supabase/functions/_shared/tracking.ts` per le Edge Function, che
 * girano in Deno e non possono importare dal bundle.
 *
 * Due copie divergono sempre, prima o poi, e divergono in silenzio: nessuno se
 * ne accorge finché in un report la newsletter non compare come due sorgenti
 * diverse. Questo test le tiene incollate — se una delle due cambia
 * comportamento, qui si rompe.
 */
import { describe, expect, it } from "vitest";
import { buildTrackedUrl as buildClient, normalizeTrackingToken as normalizeClient } from "@/lib/utm";
import {
  EMAIL_TRACKING,
  buildTrackedUrl as buildDeno,
  normalizeTrackingToken as normalizeDeno,
} from "../../supabase/functions/_shared/tracking";

const SITE = "https://biteproject.it";

const TOKENS = [
  "Facebook",
  "Vela Lenta Mediterraneo",
  "Perché No?",
  "  --newsletter-- ",
  "digest-2026-08-30",
  "",
  "???",
  "a".repeat(80),
  "Città di Bari",
];

const URLS = [
  `${SITE}/it/logbook/rotta-sud`,
  `${SITE}/it/logbook/rotta-sud?pagina=2#nota`,
  `${SITE}/en/voyages/heading-south`,
  `${SITE}/it/logbook/rotta-sud?utm_source=vecchio&utm_medium=vecchio`,
  "non-un-url",
];

const TRACKINGS = [
  { source: "newsletter", medium: "email", campaign: "digest-2026-08-30" },
  { source: "Notification", medium: "Push", campaign: "Nuovo Capitolo", content: "CTA Fondo" },
  { source: "facebook", medium: "group", campaign: "Vela Lenta Mediterraneo" },
  {},
  { campaign: "solo-campagna" },
];

describe("parità fra client e Edge Function", () => {
  it("normalizza i valori nello stesso modo", () => {
    for (const token of TOKENS) {
      expect(normalizeDeno(token), `token: ${JSON.stringify(token)}`).toBe(normalizeClient(token));
    }
  });

  it("costruisce gli stessi link", () => {
    for (const url of URLS) {
      for (const tracking of TRACKINGS) {
        expect(buildDeno(url, tracking), `${url} + ${JSON.stringify(tracking)}`).toBe(
          buildClient(url, tracking),
        );
      }
    }
  });

  it("un tracking assente lascia il link com'era, da entrambe le parti", () => {
    expect(buildDeno(`${SITE}/it`, null)).toBe(`${SITE}/it`);
    expect(buildClient(`${SITE}/it`, null)).toBe(`${SITE}/it`);
  });

  it("i preset delle email usano il vocabolario condiviso", () => {
    expect(EMAIL_TRACKING.newsletter).toEqual({ source: "newsletter", medium: "email" });
    expect(EMAIL_TRACKING.notification).toEqual({ source: "notification", medium: "email" });
    // Stessa notifica, mezzo diverso: è ciò che permette di confrontare email e push.
    expect(EMAIL_TRACKING.push.source).toBe(EMAIL_TRACKING.notification.source);
    expect(EMAIL_TRACKING.push.medium).toBe("push");
  });
});
