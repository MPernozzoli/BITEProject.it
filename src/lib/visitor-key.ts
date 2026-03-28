const VISITOR_KEY_STORAGE = "bite.visitor-key";

let memoryVisitorKey: string | null = null;

function createVisitorKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateVisitorKey() {
  if (typeof window === "undefined") {
    return memoryVisitorKey;
  }

  try {
    const stored = window.localStorage.getItem(VISITOR_KEY_STORAGE);
    if (stored) {
      memoryVisitorKey = stored;
      return stored;
    }

    const next = memoryVisitorKey ?? createVisitorKey();
    window.localStorage.setItem(VISITOR_KEY_STORAGE, next);
    memoryVisitorKey = next;
    return next;
  } catch {
    memoryVisitorKey = memoryVisitorKey ?? createVisitorKey();
    return memoryVisitorKey;
  }
}
