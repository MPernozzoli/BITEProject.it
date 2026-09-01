// Le foto caricate dall'admin finiscono nello storage Supabase alla risoluzione
// originale: uno scatto da telefono sono 3-4 MB e 4000px di lato. Servirle così
// com'è a una miniatura da 38px significa scaricare mille volte i pixel che
// servono — su rete mobile è la differenza fra una pagina che apre e una che no.
//
// Supabase espone accanto a /object/public/ un endpoint /render/image/public/
// che ridimensiona al volo e negozia WebP dall'header Accept. Queste funzioni
// riscrivono l'una nell'altra: l'originale non viene toccato, cambia solo
// l'indirizzo da cui la pagina lo chiede.
//
// Vale solo per lo storage Supabase. Asset locali, blob:, data: e URL esterni
// tornano indietro immutati, così i chiamanti possono passare qualunque cosa.

const OBJECT_MARKER = "/storage/v1/object/public/";
const RENDER_MARKER = "/storage/v1/render/image/public/";

/** Limite del trasformatore Supabase; oltre risponde 400. */
const MAX_TRANSFORM_WIDTH = 2500;

/** Formati che il trasformatore non gestisce: vanno lasciati passare interi. */
const UNTRANSFORMABLE = /\.(svg|gif)(?:$|\?)/i;

export type StorageImageOptions = {
  /** Larghezza richiesta in pixel reali (non CSS). */
  width: number;
  /** 20-100. Default 72: sotto si vedono gli artefatti sulle foto di mare. */
  quality?: number;
  /**
   * Con `height`: `cover` (default) riempie il riquadro ritagliando, `contain`
   * entra tutto. Senza `height` si usa sempre `contain` (proporzionale), a
   * prescindere da questo valore: vedi la nota nel corpo di `storageImage`.
   */
  resize?: "cover" | "contain" | "fill";
  height?: number;
};

const clampWidth = (width: number) =>
  Math.max(16, Math.min(MAX_TRANSFORM_WIDTH, Math.round(width)));

/**
 * Riscrive una URL dello storage Supabase perché venga servita ridimensionata.
 * Restituisce l'input immutato se non è una URL trasformabile.
 */
export const storageImage = (
  url: string | null | undefined,
  options: StorageImageOptions
): string | undefined => {
  const raw = url?.trim();
  if (!raw) return undefined;
  if (!raw.includes(OBJECT_MARKER)) return raw;
  if (UNTRANSFORMABLE.test(raw)) return raw;

  const [base, existingQuery] = raw.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("width", String(clampWidth(options.width)));
  if (options.height) {
    params.set("height", String(clampWidth(options.height)));
    if (options.resize) params.set("resize", options.resize);
  } else {
    // Senza height il default del trasformatore ("cover") non scala l'altro lato:
    // lo ritaglia lasciando l'altezza originale intatta, producendo una fetta
    // strettissima dell'immagine invece di un ridimensionamento proporzionale.
    // "contain" è l'unica modalità che, con un solo lato specificato, calcola
    // l'altro mantenendo le proporzioni.
    params.set("resize", options.resize ?? "contain");
  }
  params.set("quality", String(options.quality ?? 72));

  return `${base.replace(OBJECT_MARKER, RENDER_MARKER)}?${params.toString()}`;
};

const isTransformable = (url: string | null | undefined) =>
  Boolean(url && url.includes(OBJECT_MARKER) && !UNTRANSFORMABLE.test(url));

/**
 * Props per un'immagine di dimensione fissa nota via CSS (miniature, avatar).
 * Genera 1x e 2x: il browser sceglie in base al DPR senza che serva `sizes`.
 *
 *   <img {...storageImageProps(article.cover_image, 48)} alt="" />
 */
export const storageImageProps = (
  url: string | null | undefined,
  cssWidth: number,
  options?: Omit<StorageImageOptions, "width">
) => {
  const raw = url?.trim();
  if (!raw) return { src: undefined as string | undefined };
  if (!isTransformable(raw)) return { src: raw };

  const at = (scale: number) =>
    storageImage(raw, { ...options, width: cssWidth * scale })!;

  return {
    src: at(1),
    srcSet: `${at(1)} 1x, ${at(2)} 2x`,
  };
};

/**
 * Props per un'immagine che cambia larghezza col viewport (copertine, hero).
 * Descrittori `w` più `sizes`, così il browser sceglie sapendo quanto spazio
 * occuperà davvero — su un telefono scarica la variante piccola.
 *
 *   <img {...storageImageResponsiveProps(cover, [480, 960, 1440], "100vw")} />
 */
export const storageImageResponsiveProps = (
  url: string | null | undefined,
  widths: number[],
  sizes: string,
  options?: Omit<StorageImageOptions, "width">
) => {
  const raw = url?.trim();
  if (!raw) return { src: undefined as string | undefined };
  if (!isTransformable(raw)) return { src: raw };

  const sorted = [...widths].sort((a, b) => a - b);
  const srcSet = sorted
    .map((w) => `${storageImage(raw, { ...options, width: w })} ${clampWidth(w)}w`)
    .join(", ");

  return {
    src: storageImage(raw, { ...options, width: sorted[sorted.length - 1] })!,
    srcSet,
    sizes,
  };
};
