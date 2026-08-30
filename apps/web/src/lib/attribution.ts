/**
 * Da dove arriva chi sta leggendo, lato browser.
 *
 * I tracker vivono nell'URL solo per un istante: appena il lettore clicca un
 * link interno l'indirizzo cambia e `utm_source` sparisce. Qui li si raccoglie
 * al primo atterraggio e li si tiene da parte per tutta la sessione, così ogni
 * evento successivo — la lettura di un articolo, una condivisione, domani una
 * richiesta di imbarco — può dire da dove veniva quella persona.
 *
 * Due orizzonti, volutamente diversi:
 * - **sessione** (`sessionStorage`): l'ultimo tocco. È quello che si allega
 *   agli eventi di lettura, perché risponde a "questa visita da dove arriva".
 * - **primo tocco** (`localStorage`): come questa persona ha conosciuto il
 *   sito la prima volta. Non si sovrascrive mai; serve alle conversioni lente,
 *   dove fra la scoperta e l'azione passano settimane.
 *
 * Nessun cookie e nessun identificatore nuovo: si riusa `visitor-key`, che il
 * sito già assegna. La grammatica dei valori sta in `lib/utm.ts`.
 */
import {
  DIRECT_SOURCE,
  resolveAttribution,
  type AttributionFacts,
} from "@/lib/utm";

const SESSION_KEY = "bite:attribution:v1";
const FIRST_TOUCH_KEY = "bite:attribution:first:v1";

export interface StoredAttribution extends AttributionFacts {
  /** Path su cui la persona è atterrata, senza query. */
  landingPath?: string | null;
  /** ISO della cattura. */
  capturedAt: string;
}

function readStore(storage: Storage | null, key: string): StoredAttribution | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    return parsed && typeof parsed === "object" && parsed.source ? parsed : null;
  } catch {
    return null;
  }
}

function writeStore(storage: Storage | null, key: string, value: StoredAttribution): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage pieno o disabilitato: l'attribuzione è un di più, non un requisito.
  }
}

function safeStorage(kind: "session" | "local"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Legge l'URL corrente e decide se aggiornare l'attribuzione di sessione.
 *
 * Un atterraggio senza alcun segnale (nessun UTM, nessun referrer esterno) non
 * sovrascrive quello che c'era: dentro una sessione, tornare sul sito da un
 * bookmark non cancella il fatto che la sessione era cominciata da Facebook.
 */
export function captureAttribution(): StoredAttribution | null {
  if (typeof window === "undefined") return null;

  const session = safeStorage("session");
  const existing = readStore(session, SESSION_KEY);

  const facts = resolveAttribution({
    href: window.location.href,
    referrer: typeof document !== "undefined" ? document.referrer : null,
    selfHost: window.location.hostname,
  });

  const hasSignal = !!facts.source && facts.source !== DIRECT_SOURCE;
  if (!hasSignal && existing) return existing;

  const captured: StoredAttribution = {
    ...facts,
    landingPath: window.location.pathname || null,
    capturedAt: new Date().toISOString(),
  };

  writeStore(session, SESSION_KEY, captured);

  // Il primo tocco si scrive una volta sola, e solo se c'è davvero un segnale:
  // registrare "direct" al primo giro renderebbe il dato inutile per sempre.
  const local = safeStorage("local");
  if (hasSignal && !readStore(local, FIRST_TOUCH_KEY)) {
    writeStore(local, FIRST_TOUCH_KEY, captured);
  }

  return captured;
}

/** L'attribuzione della sessione corrente, se è stata catturata. */
export function getAttribution(): StoredAttribution | null {
  return readStore(safeStorage("session"), SESSION_KEY);
}

/** Come questa persona ha trovato il sito la prima volta. */
export function getFirstTouchAttribution(): StoredAttribution | null {
  return readStore(safeStorage("local"), FIRST_TOUCH_KEY);
}

/**
 * I parametri nella forma attesa dalle RPC di tracking, già troncati.
 * Restituisce un oggetto vuoto quando non c'è niente da mandare.
 */
export function attributionRpcArgs(): {
  _source?: string;
  _medium?: string;
  _campaign?: string;
  _content?: string;
  _referrer_host?: string;
} {
  const a = getAttribution();
  if (!a) return {};
  const args: Record<string, string> = {};
  if (a.source) args._source = a.source;
  if (a.medium) args._medium = a.medium;
  if (a.campaign) args._campaign = a.campaign;
  if (a.content) args._content = a.content;
  if (a.referrerHost) args._referrer_host = a.referrerHost;
  return args;
}
