import { useEffect, useMemo, useState } from "react";
import { Award, Sparkles, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface BadgeRow {
  id: string;
  profile_id: string;
  badge_name: string;
  badge_icon: string | null;
  awarded_at: string;
}

interface ProfileRow {
  id: string | null;
  name: string | null;
}

const AdminBadgeManager = () => {
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBadges = async () => {
      setLoading(true);

      const [{ data: badgeData, error: badgeError }, { data: profileData, error: profileError }] = await Promise.all([
        supabase.from("profile_badges").select("id, profile_id, badge_name, badge_icon, awarded_at").order("awarded_at", { ascending: false }),
        supabase.from("public_profiles").select("id, name"),
      ]);

      if (badgeError) {
        console.error("Badge dashboard load failed", badgeError);
      } else {
        setBadges((badgeData || []) as BadgeRow[]);
      }

      if (profileError) {
        console.error("Badge profile lookup failed", profileError);
      } else {
        const profileMap = ((profileData || []) as ProfileRow[]).reduce<Record<string, string>>((acc, profile) => {
          if (profile.id) {
            acc[profile.id] = profile.name || "Utente senza nome";
          }
          return acc;
        }, {});
        setProfiles(profileMap);
      }

      setLoading(false);
    };

    void loadBadges();
  }, []);

  const groupedBadges = useMemo(() => {
    const counts = new Map<string, number>();

    for (const badge of badges) {
      const key = `${badge.badge_icon || ""}::${badge.badge_name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([key, count]) => {
        const [badge_icon, badge_name] = key.split("::");
        return {
          badge_icon: badge_icon || null,
          badge_name,
          count,
        };
      })
      .sort((a, b) => b.count - a.count || a.badge_name.localeCompare(b.badge_name));
  }, [badges]);

  const uniqueProfiles = useMemo(() => new Set(badges.map((badge) => badge.profile_id)).size, [badges]);

  if (loading) {
    return <div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading badges...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-panel-soft rounded-[26px] p-5">
          <div className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground mb-4">
            <Award size={16} />
          </div>
          <p className="editorial-heading text-3xl leading-none mb-2">{badges.length}</p>
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Badge assegnati</p>
        </div>

        <div className="glass-panel-soft rounded-[26px] p-5">
          <div className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground mb-4">
            <Sparkles size={16} />
          </div>
          <p className="editorial-heading text-3xl leading-none mb-2">{groupedBadges.length}</p>
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Tipologie badge</p>
        </div>

        <div className="glass-panel-soft rounded-[26px] p-5">
          <div className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground mb-4">
            <UserRound size={16} />
          </div>
          <p className="editorial-heading text-3xl leading-none mb-2">{uniqueProfiles}</p>
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Profili con badge</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="glass-panel-soft rounded-[28px] p-6">
          <div className="mb-4">
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Distribuzione</p>
            <h3 className="editorial-heading text-2xl">Badge disponibili</h3>
          </div>

          {groupedBadges.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">Nessun badge assegnato al momento.</p>
          ) : (
            <div className="space-y-3">
              {groupedBadges.map((badge) => (
                <div key={`${badge.badge_icon || ""}-${badge.badge_name}`} className="flex items-center justify-between rounded-[22px] border border-stone-200/80 bg-white/60 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg leading-none">{badge.badge_icon || "🏷️"}</span>
                    <span className="font-sans text-sm text-foreground truncate">{badge.badge_name}</span>
                  </div>
                  <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                    {badge.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-panel-soft rounded-[28px] p-6">
          <div className="mb-4">
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Assegnazioni</p>
            <h3 className="editorial-heading text-2xl">Badge recenti</h3>
          </div>

          {badges.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">Nessuna assegnazione recente.</p>
          ) : (
            <div className="space-y-3">
              {badges.map((badge) => (
                <article key={badge.id} className="rounded-[22px] border border-stone-200/80 bg-white/60 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg leading-none">{badge.badge_icon || "🏷️"}</span>
                        <p className="font-sans text-sm text-muted-foreground">Assegnato a {profiles[badge.profile_id] || "Profilo sconosciuto"}</p>
                      </div>
                      <h4 className="font-serif text-xl leading-tight text-foreground">{badge.badge_name}</h4>
                    </div>
                    <span className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground whitespace-nowrap">
                      {new Date(badge.awarded_at).toLocaleDateString("it-IT")}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminBadgeManager;
