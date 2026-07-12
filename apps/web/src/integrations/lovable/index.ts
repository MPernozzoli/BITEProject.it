// Login OAuth diretto via Supabase (il broker Lovable /~oauth/initiate
// esiste solo sull'hosting Lovable e non è disponibile su Vercel).

import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple", opts?: SignInOptions) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: opts?.redirect_uri ?? window.location.origin,
          queryParams: opts?.extraParams,
        },
      });

      if (error) {
        return { error, redirected: false };
      }
      // supabase-js reindirizza il browser alla pagina di consenso Google.
      return { error: null, redirected: true };
    },
  },
};
