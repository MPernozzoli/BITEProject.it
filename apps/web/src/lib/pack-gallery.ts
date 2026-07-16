import { supabase } from "@/integrations/supabase/client";

export const PACK_GALLERY_BUCKET = "pack-gallery";

export type PackGalleryPhoto = {
  id: string;
  storage_path: string;
  category: string;
  alt: string;
  sort_order: number;
  is_published: boolean;
  width: number | null;
  height: number | null;
  created_at: string;
};

// Mirrors galleryCategories in apps/pack/src/data/site.ts, minus the "All" filter chip.
export const PACK_GALLERY_CATEGORIES = [
  "Portraits",
  "Studio",
  "Lifestyle",
  "Outdoor",
  "Boat",
  "Water",
  "Duo",
  "City",
  "Seasonal",
  "Events",
] as const;

export const buildPackGalleryUrl = (storagePath: string): string =>
  supabase.storage.from(PACK_GALLERY_BUCKET).getPublicUrl(storagePath).data.publicUrl;

export const buildPackGalleryObjectPath = (extension = "webp"): string =>
  `gallery/${Date.now()}-${Math.round(performance.now())}.${extension}`;
