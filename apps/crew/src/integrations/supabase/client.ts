import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { createSharedSupabaseAuthStorage } from "@/lib/supabase-auth-storage";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: createSharedSupabaseAuthStorage(),
    persistSession: true,
    autoRefreshToken: true,
    experimental: { passkey: true },
  },
});
