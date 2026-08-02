/**
 * Caricamento immagini nel bucket `logbook-media`.
 *
 * Stessa destinazione dell'upload manuale nell'editor articoli e nel composer
 * newsletter (`storage.from("logbook-media").upload(...)`): un'immagine
 * caricata da qui è indistinguibile da una caricata a mano, con lo stesso
 * bucket pubblico e la stessa convenzione di percorso.
 *
 * Un agente non ha un file su disco da mandare in multipart: riceve un URL
 * (un'immagine generata altrove, o indicata dall'admin) e questo modulo la
 * scarica server-side e la ripubblica nello storage BITE, invece di lasciare
 * l'articolo o la newsletter a puntare — ed essere fragile — verso un dominio
 * esterno.
 */
import { McpToolError, type McpContext } from "./context.js";

const BUCKET = "logbook-media";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Cartelle ammesse: le stesse che usa l'editor (`covers`, `articles`, `instagram-stories/*`, `newsletter`). */
const FOLDER_RE = /^[a-z0-9][a-z0-9/_-]{0,60}$/i;

function extensionFor(contentType: string, sourceUrl: string): string | null {
  const known = ALLOWED_CONTENT_TYPES[contentType.toLowerCase()];
  if (known) return known;
  const fromUrl = sourceUrl.split("?")[0].split(".").pop()?.toLowerCase();
  if (fromUrl && ["jpg", "jpeg", "png", "webp", "gif"].includes(fromUrl)) return fromUrl === "jpeg" ? "jpg" : fromUrl;
  return null;
}

export interface UploadedImage {
  url: string;
  path: string;
  bytes: number;
  contentType: string;
}

export async function uploadImageFromUrl(
  ctx: McpContext,
  params: { sourceUrl: string; folder: string },
): Promise<UploadedImage> {
  if (!FOLDER_RE.test(params.folder)) {
    throw new McpToolError("bad_request", `Cartella non valida: "${params.folder}". Usa lettere, numeri, - _ e /.`);
  }

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

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = extensionFor(contentType, parsed.pathname);
  if (!extension) {
    throw new McpToolError(
      "unsupported_type",
      `Formato non supportato (${contentType || "sconosciuto"}). Ammessi: JPG, PNG, WEBP, GIF.`,
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
    throw new McpToolError("too_large", `Immagine troppo pesante: limite ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new McpToolError("too_large", `Immagine troppo pesante: limite ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
  }
  if (buffer.byteLength === 0) {
    throw new McpToolError("fetch_failed", "L'URL ha restituito un file vuoto.");
  }

  const path = `${params.folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const { error: uploadError } = await ctx.service.storage.from(BUCKET).upload(path, buffer, {
    contentType: contentType || `image/${extension === "jpg" ? "jpeg" : extension}`,
    upsert: false,
  });
  if (uploadError) {
    throw new McpToolError("upload_failed", `Caricamento fallito: ${uploadError.message}`);
  }

  const { data } = ctx.service.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, bytes: buffer.byteLength, contentType };
}
