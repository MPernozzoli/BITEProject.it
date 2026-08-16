import { describe, expect, it, beforeEach } from "vitest";
import { createSharedSupabaseAuthStorage } from "@shared/supabase/auth-storage";

const createStorageMock = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
};

const clearCookies = () => {
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  });
};

describe("shared Supabase auth storage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
    clearCookies();
  });

  it("migrates existing localStorage sessions into cookies", () => {
    const key = "sb-test-auth-token";
    const value = JSON.stringify({ access_token: "local-session" });
    window.localStorage.setItem(key, value);

    const storage = createSharedSupabaseAuthStorage();

    expect(storage.getItem(key)).toBe(value);
    expect(document.cookie).toContain(`${key}=`);
  });

  it("round-trips large sessions through chunked cookies", () => {
    const key = "sb-test-auth-token";
    const value = JSON.stringify({
      access_token: "a".repeat(4000),
      refresh_token: "r".repeat(4000),
    });

    const storage = createSharedSupabaseAuthStorage();
    storage.setItem(key, value);

    expect(storage.getItem(key)).toBe(value);
    expect(document.cookie).toContain(`${key}=chunked%3A`);
  });
});
