import { beforeEach, describe, expect, it } from "vitest";
import {
  detectPreferredLang,
  hasManualLangPreference,
  persistLangPreference,
} from "@/lib/seo";

const clearCookie = (name: string) => {
  document.cookie = `${name}=; path=/; max-age=0`;
};

describe("language preference persistence", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    clearCookie("bite-lang");
    clearCookie("bite-lang-source");
  });

  it("marks explicit language choices as manual overrides", () => {
    persistLangPreference("en");

    expect(detectPreferredLang()).toBe("en");
    expect(hasManualLangPreference()).toBe(true);
    expect(window.localStorage.getItem("bite-lang-source")).toBe("manual");
  });

  it("does not treat profile-derived language as a manual override", () => {
    persistLangPreference("it", "profile");

    expect(detectPreferredLang()).toBe("it");
    expect(hasManualLangPreference()).toBe(false);
  });

  it("keeps legacy stored language preferences as manual overrides", () => {
    window.localStorage.setItem("bite-lang", "en");

    expect(hasManualLangPreference()).toBe(true);
  });
});
