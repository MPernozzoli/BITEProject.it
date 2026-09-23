/**
 * Caricamento immagini nel bucket `logbook-media`.
 *
 * Stessa destinazione dell'upload manuale nell'editor articoli e nel composer
 * newsletter (`storage.from("logbook-media").upload(...)`): un'immagine
 * caricata da qui è indistinguibile da una caricata a mano, con lo stesso
 * bucket pubblico e la stessa convenzione di percorso.
 *
 * Un agente non ha un form multipart: le strade per fargli arrivare un file
 * sono tre, e servono tutte.
 *
 * 1. **URL https** (`uploadImageFromUrl`): un'immagine già online viene
 *    scaricata server-side e ripubblicata qui, invece di lasciare l'articolo a
 *    puntare — ed essere fragile — verso un dominio esterno.
 * 2. **Base64 inline** (`uploadImageFromBase64`): il modello ha i byte (una
 *    foto allegata in chat, un file generato) e li passa nel tool. Il limite è
 *    basso perché l'intera richiesta JSON-RPC passa dalla function Vercel, che
 *    rifiuta corpi oltre 4,5MB: 3MB decodificati diventano ~4MB di base64.
 * 3. **Upload firmato** (`createImageUploadSlot` + `verifyUploadedImage`): per
 *    file più grandi, o quando l'agente ha una shell e un file su disco, si
 *    rilascia un URL di upload firmato di Supabase Storage e i byte non passano
 *    affatto dalla function. Il bucket non ha limiti di tipo o peso, quindi il
 *    controllo si fa dopo, scaricando il file prima di collegarlo a un articolo.
 *
 * In tutti e tre i casi il formato si decide dai *byte* (magic number), non da
 * ciò che dichiara il chiamante: un content-type sbagliato o un base64 che non
 * è un'immagine vengono rifiutati prima di finire nello storage pubblico.
 */
import { McpToolError, type McpContext } from "./context.js";

export const MEDIA_BUCKET = "logbook-media";
const MAX_BYTES = 12 * 1024 * 1024;
export const INLINE_MAX_BYTES = 3 * 1024 * 1024;
const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const FORMATS_LABEL = "JPG, PNG, WEBP, GIF, AVIF";

/** Cartelle ammesse: le stesse che usa l'editor (`covers`, `articles`, `instagram-stories/*`, `newsletter`, `voyages`). */
const FOLDER_RE = /^[a-z0-9][a-z0-9/_-]{0,60}$/i;

function assertFolder(folder: string): void {
  if (!FOLDER_RE.test(folder) || folder.includes("..")) {
    throw new McpToolError("bad_request", `Cartella non valida: "${folder}". Usa lettere, numeri, - _ e /.`);
  }
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/** Riconosce il formato dai primi byte del file. `null` se non è un'immagine ammessa. */
export function sniffImageType(buffer: Uint8Array): string | null {
  const at = (offset: number, bytes: number[]) => bytes.every((value, index) => buffer[offset + index] === value);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((char) => char.charCodeAt(0)));
  if (buffer.length < 12) return null;
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftypavif") || ascii(4, "ftypavis")) return "image/avif";
  return null;
}

function newPath(folder: string, contentType: string): string {
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${EXTENSION_BY_TYPE[contentType]}`;
}

export interface UploadedImage {
  url: string;
  path: string;
  bytes: number;
  contentType: string;
}

async function storeImage(ctx: McpContext, buffer: Buffer, contentType: string, folder: string): Promise<UploadedImage> {
  const path = newPath(folder, contentType);
  const { error: uploadError } = await ctx.service.storage.from(MEDIA_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (uploadError) {
    throw new McpToolError("upload_failed", `Caricamento fallito: ${uploadError.message}`);
  }
  const { data } = ctx.service.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, bytes: buffer.byteLength, contentType };
}

export async function uploadImageFromUrl(
  ctx: McpContext,
  params: { sourceUrl: string; folder: string },
): Promise<UploadedImage> {
  assertFolder(params.folder);

  let parsed: URL;
  try {
    parsed = new URL(params.sourceUrl);
  } catch {
    throw new McpToolError("bad_request", "source_url non è un URL valido.");
  }
  if (parsed.protocol !== "https:") {
    throw new McpToolError("bad_request", "source_url deve essere https.");
  }

  let response: Response;
  try {
    response = await fetch(parsed.toString());
  } catch (error) {
    throw new McpToolError("fetch_failed", `Impossibile scaricare l'immagine: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new McpToolError("fetch_failed", `L'URL ha risposto ${response.status}.`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
    throw new McpToolError("too_large", `Immagine troppo pesante: limite ${megabytes(MAX_BYTES)}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new McpToolError("too_large", `Immagine troppo pesante: limite ${megabytes(MAX_BYTES)}.`);
  }
  if (buffer.byteLength === 0) {
    throw new McpToolError("fetch_failed", "L'URL ha restituito un file vuoto.");
  }

  // I byte hanno l'ultima parola; l'header del server remoto resta solo come
  // ripiego per formati che il riconoscimento non copre.
  const headerType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const contentType = sniffImageType(buffer) ?? (EXTENSION_BY_TYPE[headerType] ? headerType : null);
  if (!contentType) {
    throw new McpToolError(
      "unsupported_type",
      `Formato non supportato (${headerType || "sconosciuto"}). Ammessi: ${FORMATS_LABEL}.`,
    );
  }

  return storeImage(ctx, buffer, contentType, params.folder);
}

/** Accetta base64 puro o un data URL (`data:image/png;base64,...`). */
export async function uploadImageFromBase64(
  ctx: McpContext,
  params: { data: string; folder: string },
): Promise<UploadedImage> {
  assertFolder(params.folder);

  const payload = params.data.trim().replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  if (!payload || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(payload)) {
    throw new McpToolError("bad_request", "data_base64 non è base64 valido.");
  }
  const buffer = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (buffer.byteLength === 0) {
    throw new McpToolError("bad_request", "data_base64 è vuoto.");
  }
  if (buffer.byteLength > INLINE_MAX_BYTES) {
    throw new McpToolError(
      "too_large",
      `Oltre ${megabytes(INLINE_MAX_BYTES)} il file non può viaggiare inline: usa article_media_upload_url per ottenere un URL di upload diretto.`,
    );
  }

  const contentType = sniffImageType(buffer);
  if (!contentType) {
    throw new McpToolError("unsupported_type", `I byte ricevuti non sono un'immagine riconosciuta. Ammessi: ${FORMATS_LABEL}.`);
  }
  return storeImage(ctx, buffer, contentType, params.folder);
}

export interface ImageUploadSlot {
  upload_url: string;
  path: string;
  public_url: string;
  expires_in_seconds: number;
}

/** Riserva un percorso nel bucket e rilascia un URL firmato su cui fare PUT dei byte. */
export async function createImageUploadSlot(
  ctx: McpContext,
  params: { folder: string; contentType: string },
): Promise<ImageUploadSlot> {
  assertFolder(params.folder);
  if (!EXTENSION_BY_TYPE[params.contentType]) {
    throw new McpToolError("unsupported_type", `Formato non supportato (${params.contentType}). Ammessi: ${FORMATS_LABEL}.`);
  }

  const path = newPath(params.folder, params.contentType);
  const { data, error } = await ctx.service.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new McpToolError("upload_failed", `URL di upload non disponibile: ${error?.message ?? "risposta vuota"}`);
  }
  const { data: publicData } = ctx.service.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return {
    upload_url: data.signedUrl,
    path,
    public_url: publicData.publicUrl,
    expires_in_seconds: SIGNED_UPLOAD_TTL_SECONDS,
  };
}

/**
 * Percorso nel bucket di un URL pubblico di `logbook-media`, o `null` se l'URL
 * punta altrove. Serve a distinguere "già nostro" da "da ripubblicare".
 */
export function bucketPathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
  return path && !path.includes("..") ? path : null;
}

/**
 * Controlla un file arrivato nel bucket senza passare da qui (upload firmato):
 * deve esistere, pesare entro il limite ed essere davvero un'immagine. Con
 * `removeIfInvalid` un file che non passa viene rimosso, perché il bucket è
 * pubblico e nessun altro lo farebbe — ma solo per i percorsi appena
 * rilasciati da `createImageUploadSlot`, mai per un URL qualsiasi del bucket
 * che potrebbe essere usato altrove.
 */
export async function verifyUploadedImage(
  ctx: McpContext,
  path: string,
  options: { removeIfInvalid?: boolean } = {},
): Promise<UploadedImage> {
  const { data, error } = await ctx.service.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) {
    throw new McpToolError(
      "not_found",
      `Nessun file in ${path}: il PUT sull'URL firmato non è andato a buon fine, o l'URL è scaduto.`,
    );
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = sniffImageType(buffer);
  if (!contentType || buffer.byteLength > MAX_BYTES) {
    if (options.removeIfInvalid) await ctx.service.storage.from(MEDIA_BUCKET).remove([path]);
    const removed = options.removeIfInvalid ? " Il file è stato rimosso." : "";
    throw new McpToolError(
      contentType ? "too_large" : "unsupported_type",
      contentType
        ? `Immagine troppo pesante: limite ${megabytes(MAX_BYTES)}.${removed}`
        : `Il file non è un'immagine riconosciuta (${FORMATS_LABEL}).${removed}`,
    );
  }
  const { data: publicData } = ctx.service.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: publicData.publicUrl, path, bytes: buffer.byteLength, contentType };
}

/**
 * Un'unica porta d'ingresso per i tool: esattamente una fra `source_url` e
 * `data_base64`. Un URL che punta già al nostro bucket non viene riscaricato,
 * solo verificato.
 */
export async function uploadImageFromInput(
  ctx: McpContext,
  input: { source_url?: string; data_base64?: string },
  folder: string,
): Promise<UploadedImage> {
  const sources = [input.source_url, input.data_base64].filter((value) => typeof value === "string" && value.length > 0);
  if (sources.length !== 1) {
    throw new McpToolError("bad_request", "Passa esattamente uno fra source_url e data_base64.");
  }
  if (input.data_base64) return uploadImageFromBase64(ctx, { data: input.data_base64, folder });
  const ownPath = bucketPathFromUrl(input.source_url!);
  if (ownPath) return verifyUploadedImage(ctx, ownPath);
  return uploadImageFromUrl(ctx, { sourceUrl: input.source_url!, folder });
}
