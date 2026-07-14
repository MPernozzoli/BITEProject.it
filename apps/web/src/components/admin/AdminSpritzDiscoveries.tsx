import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles, UserRound, Wine } from "lucide-react";
import { toast } from "sonner";

import ProfileAvatar from "@/components/ProfileAvatar";
import { supabase } from "@/integrations/supabase/client";

type DiscoveryRow = {
  id: string;
  user_id: string | null;
  visitor_key: string | null;
  discovered_at: string;
  last_played_at: string;
  play_count: number;
};

type DiscovererProfile = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

const untypedSupabase = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => Promise<{ data: DiscoveryRow[] | null; error: { message: string } | null }>;
      in: (
        column: string,
        values: string[],
      ) => Promise<{ data: DiscovererProfile[] | null; error: { message: string } | null }>;
    };
  };
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const AdminSpritzDiscoveries = () => {
  const [rows, setRows] = useState<DiscoveryRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, DiscovererProfile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const discoveriesRes = await untypedSupabase
      .from("spritz_easter_egg_discoveries")
      .select("id,user_id,visitor_key,discovered_at,last_played_at,play_count")
      .order("discovered_at", { ascending: false });

    if (discoveriesRes.error) {
      toast.error(discoveriesRes.error.message || "Impossibile caricare le scoperte");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const loaded = discoveriesRes.data ?? [];
    const profileIds = [...new Set(loaded.map((row) => row.user_id).filter((id): id is string => !!id))];

    let profileMap: Record<string, DiscovererProfile> = {};
    if (profileIds.length) {
      const profilesRes = await untypedSupabase
        .from("profiles")
        .select("id,name,email,avatar_url")
        .in("id", profileIds);

      if (profilesRes.error) {
        toast.error(profilesRes.error.message || "Impossibile caricare i profili");
      } else {
        profileMap = Object.fromEntries((profilesRes.data ?? []).map((profile) => [profile.id, profile]));
      }
    }

    setRows(loaded);
    setProfiles(profileMap);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const registeredCount = useMemo(() => rows.filter((row) => row.user_id).length, [rows]);
  const anonymousCount = rows.length - registeredCount;

  if (loading) {
    return (
      <div className="glass-panel rounded-[32px] px-6 py-16 flex items-center justify-center">
        <span className="inline-flex items-center gap-3 text-sm font-sans text-muted-foreground">
          <Loader2 size={18} className="animate-spin" />
          Carico le scoperte...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Scoperte totali", value: rows.length, icon: Sparkles },
          { label: "Utenti registrati", value: registeredCount, icon: UserRound },
          { label: "Visitatori anonimi", value: anonymousCount, icon: Wine },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="glass-panel-soft rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-3">
                <Icon size={14} />
                {stat.label}
              </div>
              <p className="editorial-heading text-4xl">{stat.value}</p>
            </div>
          );
        })}
      </div>

      <div className="glass-panel rounded-[32px] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
            Chi ha trovato Spritz
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />
            Aggiorna
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-sans text-muted-foreground">
              Nessuno ha ancora scoperto l'easter egg. Digita <span className="font-medium text-foreground">spritz</span> sul sito per essere il primo.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Scopritore</th>
                  <th className="px-6 py-3 font-medium">Prima apertura</th>
                  <th className="px-6 py-3 font-medium">Ultima partita</th>
                  <th className="px-6 py-3 font-medium text-right">Partite</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const profile = row.user_id ? profiles[row.user_id] : undefined;
                  const displayName = profile?.name || profile?.email || "Utente registrato";
                  return (
                    <tr key={row.id} className="border-t border-white/8">
                      <td className="px-6 py-4">
                        {row.user_id ? (
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted/40 flex items-center justify-center">
                              <ProfileAvatar
                                name={displayName}
                                avatarUrl={profile?.avatar_url}
                                fallback={<UserRound size={16} className="text-muted-foreground" />}
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{displayName}</p>
                              {profile?.email && profile?.name ? (
                                <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 shrink-0 rounded-full bg-muted/40 flex items-center justify-center">
                              <Wine size={16} className="text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">Visitatore anonimo</p>
                              <p className="truncate text-xs text-muted-foreground font-mono">
                                {row.visitor_key ? row.visitor_key.slice(0, 8) : "—"}
                              </p>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-foreground/80 whitespace-nowrap">{formatDateTime(row.discovered_at)}</td>
                      <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">{formatDateTime(row.last_played_at)}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-foreground/80">{row.play_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSpritzDiscoveries;
