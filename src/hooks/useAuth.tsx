import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { validateSessionOrSignOut } from "@/lib/supabase-auth";

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

  const checkAdmin = useCallback(async (userId: string) => {
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    setIsAdmin(!!data);
  }, []);

  const applySession = useCallback(
    async (next: Session | null) => {
      setSession(next);
      if (next?.user) {
        await checkAdmin(next.user.id);
      } else {
        setIsAdmin(false);
      }
    },
    [checkAdmin]
  );

  const revalidateSession = useCallback(async () => {
    const { session: next } = await validateSessionOrSignOut();
    await applySession(next);
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoading(true);
      const { session: next } = await validateSessionOrSignOut();
      if (cancelled) return;
      await applySession(next);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      void applySession(next);
      if (!cancelled) setLoading(false);
    });

    void bootstrap();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        const { data: { session: cur } } = await supabase.auth.getSession();
        if (!cur) return;
        const { session: next } = await validateSessionOrSignOut();
        if (!cancelled) await applySession(next);
      })();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
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
