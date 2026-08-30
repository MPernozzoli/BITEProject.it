/**
 * La grammatica dei tracker di sorgente.
 *
 * Due cose vanno tenute ferme, perché sbagliarle non produce un errore ma un
 * report che mente: la **forma** dei valori (`Facebook`, `facebook` e `FB` non
 * devono diventare tre sorgenti) e l'**ordine dei segnali** (un utm esplicito
 * vince sul referrer, altrimenti ogni link condiviso in un gruppo verrebbe
 * attribuito al redirect della piattaforma invece che al gruppo).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTrackedUrl,
  campaignFromUrl,
  classifyReferrer,
  normalizeTrackingToken,
  parseTrackingParams,
  resolveAttribution,
  stripTrackingFromUrl,
} from "@/lib/utm";
import { captureAttribution, getAttribution, getFirstTouchAttribution } from "@/lib/attribution";

const SITE = "https://biteproject.it";

describe("normalizzazione dei valori", () => {
  it("riduce maiuscole, accenti e spazi a una sola forma", () => {
    expect(normalizeTrackingToken("Vela Lenta Mediterraneo")).toBe("vela-lenta-mediterraneo");
    expect(normalizeTrackingToken("Perché No?")).toBe("perche-no");
    expect(normalizeTrackingToken("  --Facebook-- ")).toBe("facebook");
  });

  it("scarta i valori che restano vuoti", () => {
    expect(normalizeTrackingToken("???")).toBe("");
    expect(normalizeTrackingToken(null)).toBe("");
  });
});

describe("costruzione del link", () => {
  it("aggiunge i parametri lasciando intatto il resto dell'indirizzo", () => {
    const url = buildTrackedUrl(`${SITE}/it/logbook/rotta-sud?x=1#nota`, {
      source: "Facebook",
      medium: "group",
      campaign: "Vela Lenta",
    });

    expect(url).toBe(
      `${SITE}/it/logbook/rotta-sud?x=1&utm_source=facebook&utm_medium=group&utm_campaign=vela-lenta#nota`,
    );
  });

  it("senza tracker restituisce l'indirizzo immutato", () => {
    expect(buildTrackedUrl(`${SITE}/it/logbook/rotta-sud`, {})).toBe(`${SITE}/it/logbook/rotta-sud`);
    expect(buildTrackedUrl(`${SITE}/it/logbook/rotta-sud`, null)).toBe(`${SITE}/it/logbook/rotta-sud`);
  });

  it("sovrascrive i tracker già presenti invece di accumularli", () => {
    const once = buildTrackedUrl(`${SITE}/it`, { source: "newsletter", medium: "email" });
    const twice = buildTrackedUrl(once, { source: "instagram", medium: "bio" });

    expect(twice).toBe(`${SITE}/it?utm_source=instagram&utm_medium=bio`);
  });

  it("su un indirizzo illeggibile non rompe nulla", () => {
    expect(buildTrackedUrl("non-un-url", { source: "facebook" })).toBe("non-un-url");
  });

  it("ripulisce utm e click id quando serve l'indirizzo canonico", () => {
    const dirty = `${SITE}/it/logbook/rotta-sud?utm_source=facebook&fbclid=abc&pagina=2`;
    expect(stripTrackingFromUrl(dirty)).toBe(`${SITE}/it/logbook/rotta-sud?pagina=2`);
  });

  it("ricava la campagna dallo slug in coda al percorso", () => {
    expect(campaignFromUrl(`${SITE}/it/logbook/rotta-verso-sud`)).toBe("rotta-verso-sud");
    expect(campaignFromUrl(`${SITE}/it/logbook/story/cronache/`)).toBe("cronache");
  });
});

describe("lettura dei parametri", () => {
  it("legge e normalizza i cinque utm", () => {
    expect(parseTrackingParams("?utm_source=Facebook&utm_medium=Group&utm_campaign=Vela%20Lenta")).toEqual({
      source: "facebook",
      medium: "group",
      campaign: "vela-lenta",
    });
  });
});

describe("classificazione del referrer", () => {
  it("riconosce i motori di ricerca e i social", () => {
    expect(classifyReferrer("https://www.google.it/search?q=vela", "biteproject.it")).toMatchObject({
      source: "google",
      medium: "organic",
    });
    expect(classifyReferrer("https://l.facebook.com/", "biteproject.it")).toMatchObject({
      source: "facebook",
      medium: "social",
    });
  });

  it("conserva l'host per i domini sconosciuti", () => {
    expect(classifyReferrer("https://forum-vela.it/thread/12", "biteproject.it")).toMatchObject({
      source: "forum-vela-it",
      medium: "referral",
      referrerHost: "forum-vela.it",
    });
  });

  it("la navigazione interna non è una sorgente", () => {
    expect(classifyReferrer(`${SITE}/it/logbook`, "biteproject.it")).toBeNull();
    expect(classifyReferrer("https://admin.biteproject.it/admin", "biteproject.it")).toBeNull();
    expect(classifyReferrer("", "biteproject.it")).toBeNull();
  });
});

describe("ordine dei segnali", () => {
  it("l'utm esplicito vince sul referrer della piattaforma", () => {
    expect(
      resolveAttribution({
        href: `${SITE}/it/logbook/rotta-sud?utm_source=facebook&utm_medium=group&utm_campaign=vela-lenta`,
        referrer: "https://l.facebook.com/",
        selfHost: "biteproject.it",
      }),
    ).toMatchObject({ source: "facebook", medium: "group", campaign: "vela-lenta" });
  });

  it("senza utm vale il click id della piattaforma", () => {
    expect(
      resolveAttribution({ href: `${SITE}/it?fbclid=abc123`, referrer: "", selfHost: "biteproject.it" }),
    ).toMatchObject({ source: "facebook", medium: "social" });
  });

  it("senza utm e senza click id vale il referrer", () => {
    expect(
      resolveAttribution({ href: `${SITE}/it`, referrer: "https://duckduckgo.com/", selfHost: "biteproject.it" }),
    ).toMatchObject({ source: "duckduckgo", medium: "organic", referrerHost: "duckduckgo.com" });
  });

  it("senza alcun segnale è traffico diretto", () => {
    expect(resolveAttribution({ href: `${SITE}/it`, referrer: "", selfHost: "biteproject.it" })).toMatchObject({
      source: "direct",
      medium: "none",
    });
  });
});

describe("persistenza per la sessione", () => {
  const land = (href: string, referrer = "") => {
    window.history.replaceState({}, "", href.replace(SITE, ""));
    Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
    return captureAttribution();
  };

  // In questo runtime `window.localStorage` è quello di Node, senza i metodi
  // di Storage: lo si sostituisce con uno in memoria, altrimenti il primo
  // tocco non sarebbe verificabile (nel browser reale il fallback silenzioso
  // di `lib/attribution.ts` è proprio ciò che tiene in piedi la pagina).
  beforeEach(() => {
    window.sessionStorage.clear();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    });
  });

  it("tiene l'attribuzione dell'atterraggio per tutta la sessione", () => {
    land(`${SITE}/it/logbook/rotta-sud?utm_source=newsletter&utm_medium=email&utm_campaign=digest-agosto`);

    expect(getAttribution()).toMatchObject({
      source: "newsletter",
      medium: "email",
      campaign: "digest-agosto",
      landingPath: "/it/logbook/rotta-sud",
    });
  });

  it("una pagina senza segnali non cancella la provenienza della sessione", () => {
    land(`${SITE}/it?utm_source=instagram&utm_medium=bio`);
    land(`${SITE}/it/logbook`);

    expect(getAttribution()).toMatchObject({ source: "instagram", medium: "bio" });
  });

  it("un nuovo segnale esplicito aggiorna l'ultimo tocco ma non il primo", () => {
    land(`${SITE}/it?utm_source=instagram&utm_medium=bio`);
    land(`${SITE}/it/logbook?utm_source=newsletter&utm_medium=email`);

    expect(getAttribution()).toMatchObject({ source: "newsletter" });
    expect(getFirstTouchAttribution()).toMatchObject({ source: "instagram" });
  });

  it("il primo tocco non registra mai un arrivo senza segnali", () => {
    land(`${SITE}/it`);
    expect(getFirstTouchAttribution()).toBeNull();
  });
});
