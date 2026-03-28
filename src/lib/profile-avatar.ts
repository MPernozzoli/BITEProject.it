import { supabase } from "@/integrations/supabase/client";

const PROFILE_AVATAR_BUCKET = "logbook-media";
const STORAGE_PUBLIC_PREFIX = `storage/v1/object/public/${PROFILE_AVATAR_BUCKET}/`;

export const resolveProfileAvatarUrl = (avatarUrl?: string | null) => {
  const raw = avatarUrl?.trim();
  if (!raw) return undefined;

  if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (/^[a-z][a-z\d+\-.]*:/i.test(raw)) return raw;

  if (raw.startsWith("/storage/v1/object/") || raw.startsWith("storage/v1/object/")) {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
    if (!baseUrl) return raw.startsWith("/") ? raw : `/${raw}`;
    const pathname = raw.startsWith("/") ? raw : `/${raw}`;
    return new URL(pathname, baseUrl).toString();
  }

  let storagePath = raw.replace(/^\/+/, "");
  if (storagePath.startsWith(STORAGE_PUBLIC_PREFIX)) {
    storagePath = storagePath.slice(STORAGE_PUBLIC_PREFIX.length);
  }
  if (storagePath.startsWith(`${PROFILE_AVATAR_BUCKET}/`)) {
    storagePath = storagePath.slice(PROFILE_AVATAR_BUCKET.length + 1);
  }

  const { data } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
};
