import type { Json } from "@/integrations/supabase/types";

type ArticleImage = {
  src: string;
  alt?: string;
  title?: string;
  caption?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeImageSrc = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

export const extractImagesFromRichContent = (content: Json | null | undefined): ArticleImage[] => {
  const images: ArticleImage[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!isRecord(node)) return;

    if (node.type === "image" && isRecord(node.attrs)) {
      const src = normalizeImageSrc(node.attrs.src);
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push({
          src,
          alt: typeof node.attrs.alt === "string" ? node.attrs.alt : undefined,
          title: typeof node.attrs.title === "string" ? node.attrs.title : undefined,
        });
      }
    }

    if (node.type === "mediaFigure" && isRecord(node.attrs) && node.attrs.kind !== "youtube") {
      const src = normalizeImageSrc(node.attrs.src);
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push({
          src,
          alt: typeof node.attrs.alt === "string" ? node.attrs.alt : undefined,
          title: typeof node.attrs.title === "string" ? node.attrs.title : undefined,
          caption: typeof node.attrs.caption === "string" ? node.attrs.caption : undefined,
        });
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(content);

  return images;
};
