import { useState, useEffect, useRef, createContext, useContext, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import {
  deferSupabaseAuthWork,
  getSupabaseAuthStorageKey,
  validateSessionOrSignOut,
} from "@/lib/supabase-auth";

interface AuthContext {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  /** Rivalida JWT col server; se invalido esegue logout. */
  revalidateSession: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext>({
  session: null,
  isAdmin: false,
  loading: true,
  revalidateSession: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const authBootstrapDoneRef = useRef(false);
  const authStateVersionRef = useRef(0);

  const checkAdmin = useCallback(async (userId: string, version: number) => {
    try {
      const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (version !== authStateVersionRef.current) return;
      if (error) {
        console.error("Failed to resolve admin role", error);
        setIsAdmin(false);
        return;
      }
      setIsAdmin(!!data);
    } catch (error) {
      if (version !== authStateVersionRef.current) return;
      console.error("Failed to resolve admin role", error);
      setIsAdmin(false);
    }
  }, []);

  const applySession = useCallback(
    (next: Session | null) => {
      const version = ++authStateVersionRef.current;
      setSession(next);
      if (next?.user) {
        setIsAdmin(false);
        void checkAdmin(next.user.id, version);
      } else {
        setIsAdmin(false);
      }
    },
    [checkAdmin]
  );

  const revalidateSession = useCallback(async () => {
    try {
      const { session: next } = await validateSessionOrSignOut();
      applySession(next);
    } catch (error) {
      console.error("Session revalidation failed", error);
      applySession(null);
    }
  }, [applySession]);

  useEffect(() => {
    const clearEphemeralSession = () => {
      if (!localStorage.getItem("bite_ephemeral_session")) return;
      const key = getSupabaseAuthStorageKey();
      if (key) localStorage.removeItem(key);
    };

    window.addEventListener("beforeunload", clearEphemeralSession);
    window.addEventListener("pagehide", clearEphemeralSession);

    return () => {
      window.removeEventListener("beforeunload", clearEphemeralSession);
      window.removeEventListener("pagehide", clearEphemeralSession);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authBootstrapDoneRef.current = false;

    const bootstrap = async () => {
      setLoading(true);
      try {
        const { session: next } = await validateSessionOrSignOut();
        if (cancelled) return;
        applySession(next);
      } catch (error) {
        console.error("Auth bootstrap failed", error);
        if (cancelled) return;
        applySession(null);
      } finally {
        authBootstrapDoneRef.current = true;
        if (!cancelled) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, next) => {
        // Evita di applicare subito la sessione da storage prima della validazione JWT (stato “loggato” fantasma).
        if (!authBootstrapDoneRef.current && event === "INITIAL_SESSION") return;
        deferSupabaseAuthWork(() => {
          if (cancelled) return;
          applySession(next);
          if (authBootstrapDoneRef.current) setLoading(false);
        });
      }
    );

    void bootstrap();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        if (!authBootstrapDoneRef.current) return;
        const { data: { session: cur } } = await supabase.auth.getSession();
        if (!cur) return;
        try {
          const { session: next } = await validateSessionOrSignOut();
          if (!cancelled) applySession(next);
        } catch (error) {
          console.error("Visibility session revalidation failed", error);
          if (!cancelled) applySession(null);
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      authBootstrapDoneRef.current = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySession]);

  return (
    <AuthCtx.Provider value={{ session, isAdmin, loading, revalidateSession }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
