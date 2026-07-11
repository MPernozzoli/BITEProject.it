import { supabase } from "@/integrations/supabase/client";

export interface ProfileCompletenessFields {
  name?: string | null;
  bio?: string | null;
}

/** A profile counts as complete once the user has set a display name and a bio. */
export const isProfileComplete = (profile: ProfileCompletenessFields | null | undefined) =>
  Boolean(profile?.name?.trim() && profile?.bio?.trim());

/** Fresh accounts have no `profiles` row at all until the first save, so this must tolerate a missing row. */
export const fetchIsProfileComplete = async (userId: string) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, bio")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Profile completeness check failed:", error);
    return false;
  }

  return isProfileComplete(data);
};
