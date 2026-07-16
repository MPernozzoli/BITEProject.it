import { supabase } from "@/integrations/supabase/client";

export const LOGBOOK_PHOTO_BUCKET = "logbook-media";
export const LOGBOOK_PHOTO_FOLDER = "logbook-points";

export type LogbookPhotoPoint = {
  id: string;
  voyage_id: string | null;
  voyage_is_manual: boolean;
  taken_at: string;
  lat: number;
  lng: number;
  coordinates_source: "exif" | "manual";
  title_it: string;
  title_en: string;
  description_it: string | null;
  description_en: string | null;
  storage_path: string;
  width: number | null;
  height: number | null;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const buildPhotoPointUrl = (storagePath: string): string =>
  supabase.storage.from(LOGBOOK_PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl;

/**
 * Strips the characters that make an object path awkward to handle, keeping the name
 * recognisable. Mirrors pathSafePart() in AdminMedia.
 */
export const photoPathSafePart = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

export const buildPhotoObjectPath = (file: File, index = 0): string => {
  const safeName = photoPathSafePart(file.name) || `photo-${index}`;
  return `${LOGBOOK_PHOTO_FOLDER}/${Date.now()}-${index}-${safeName}`;
};

/**
 * Asks the database which voyage a capture instant falls into. Admin-only RPC wrapping
 * resolve_voyage_for_timestamp, which is revoked from `authenticated` directly.
 * Returns null when the timestamp sits outside every voyage window — the correct answer,
 * not a failure.
 */
export const resolveVoyageForPhoto = async (takenAt: Date): Promise<string | null> => {
  const { data, error } = await supabase.rpc("resolve_voyage_for_photo" as never, {
    taken_at: takenAt.toISOString(),
  } as never);
  if (error) {
    console.error("Could not resolve the voyage for this photo", error);
    return null;
  }
  return (data as string | null) ?? null;
};
