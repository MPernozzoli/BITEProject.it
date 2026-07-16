import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

const PACK_GALLERY_BUCKET = "pack-gallery";

export type GalleryItem = {
  src: string;
  category: string;
  alt: string;
};

/**
 * The gallery is bucket-only: it renders exactly the published rows of pack_gallery_photos,
 * never a hardcoded list. Managed from the main site admin (/admin/pack-gallery).
 */
export const useGalleryItems = () =>
  useQuery({
    queryKey: ["pack-gallery"],
    queryFn: async (): Promise<GalleryItem[]> => {
      const { data, error } = await supabase
        .from("pack_gallery_photos" as never)
        .select("storage_path,category,alt")
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;

      return ((data ?? []) as unknown as Array<{
        storage_path: string;
        category: string;
        alt: string;
      }>).map((row) => ({
        src: supabase.storage.from(PACK_GALLERY_BUCKET).getPublicUrl(row.storage_path).data
          .publicUrl,
        category: row.category,
        alt: row.alt,
      }));
    },
  });
