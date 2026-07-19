import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { CalendarClock, Lock, MessageCircle, Radio, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunityLiveEvent,
  CommunityLiveMessage,
  MembershipTier,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  type CommunitySubscription,
} from "@/lib/community";

const LivekitRoomPanel = lazy(() => import("@/components/LivekitRoomPanel"));

const CrewLivePage = () => {
  const [events, setEvents] = useState<CommunityLiveEvent[]>([]);
  const [messages, setMessages] = useState<CommunityLiveMessage[]>([]);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [livekitSession, setLivekitSession] = useState<{ url: string; token: string; roomName: string; canPublish: boolean } | null>(null);
  const [livekitBusy, setLivekitBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newEvent, setNewEvent] = useState({
    title: "",
    starts_at: new Date().toISOString().slice(0, 16),
    ends_at: "",
    visibility: "members" as "public" | "members" | "tier",
    min_tier_id: "",
    livekit_mode: "video" as "video" | "audio" | "stage" | "off",
  });

  const selected = useMemo(() => events.find((event) => event.id === selectedId) ?? events[0] ?? null, [events, selectedId]);
  const canWrite = isAdmin || isActiveSubscription(subscription);

  const loadEvents = async () => {
    const { data } = await supabase
      .from("community_live_events")
      .select("*, membership_tiers(name, slug, tier_order)")
      .order("starts_at", { ascending: false })
      .limit(20);
    const nextEvents = (data ?? []) as CommunityLiveEvent[];
    setEvents(nextEvents);
    setSelectedId((current) => current ?? nextEvents[0]?.id ?? null);
  };

  const loadMessages = async (eventId: string) => {
    const { data, error } = await supabase
      .from("community_live_messages")
      .select("*, profiles:public_profiles(name, avatar_url)")
      .eq("live_event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error(error);
      return;
    }
    setMessages((data ?? []) as CommunityLiveMessage[]);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const membership = await loadMembership();
      setSubscription(membership.subscription);
      setIsAdmin(membership.isAdmin);
      setIsModerator(membership.isModerator);
      setUserId(membership.session?.user.id ?? null);
      const tierRes = await supabase.from("membership_tiers").select("*").eq("is_active", true).order("tier_order", { ascending: true });
      setTiers((tierRes.data ?? []) as MembershipTier[]);
      await loadEvents();
      setLoading(false);
    };
    void load();

    const channel = supabase
      .channel("community-live-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_live_events" }, () => void loadEvents())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    setLivekitSession(null);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      return;
    }

    void loadMessages(selected.id);
    const channel = supabase
      .channel(`community-live:${selected.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "community_live_messages", filter: `live_event_id=eq.${selected.id}` }, () => void loadMessages(selected.id))
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selected?.id]);

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (!content || !selected) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin();
      return;
    }

    setBusy(true);
    const { error } = await supabase.from("community_live_messages").insert({
      live_event_id: selected.id,
      profile_id: session.user.id,
      content,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("row-level") ? "Serve un Crew Pass attivo per scrivere nel live." : "Messaggio non inviato.");
      return;
    }
    setMessage("");
  };

  const joinLivekit = async () => {
    if (!selected) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      redirectToLogin();
      return;
    }

    setLivekitBusy(true);
    try {
      const response = await fetch("/api/community/livekit-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ eventId: selected.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "livekit_join_failed");
      setLivekitSession({
        url: body.url,
        token: body.token,
        roomName: body.roomName,
        canPublish: Boolean(body.canPublish),
      });
    } catch (error) {
      console.error(error);
      toast.error("LiveKit non disponibile per questo live.");
    } finally {
      setLivekitBusy(false);
    }
  };

  const createEvent = async (event: FormEvent) => {
    event.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin();
      return;
    }
    if (!newEvent.title.trim()) return;
    if (newEvent.visibility === "tier" && !newEvent.min_tier_id) {
      toast.error("Scegli il tier minimo.");
      return;
    }

    const { error } = await supabase.from("community_live_events").insert({
      title: newEvent.title.trim(),
      starts_at: new Date(newEvent.starts_at).toISOString(),
      ends_at: newEvent.ends_at ? new Date(newEvent.ends_at).toISOString() : null,
      visibility: newEvent.visibility,
      min_tier_id: newEvent.visibility === "tier" ? newEvent.min_tier_id : null,
      livekit_mode: newEvent.livekit_mode,
      metadata: { source: "crew_studio" },
    });
    if (error) {
      toast.error("Live non creato.");
      return;
    }
    toast.success("Live creato.");
    setNewEvent({ title: "", starts_at: new Date().toISOString().slice(0, 16), ends_at: "", visibility: "members", min_tier_id: "", livekit_mode: "video" });
    await loadEvents();
  };

  const hideMessage = async (id: string) => {
    const { error } = await supabase.from("community_live_messages").update({ status: "hidden" }).eq("id", id);
    if (error) toast.error("Moderazione non riuscita.");
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-slate-500">Caricamento live...</div>;
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-16 pt-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="space-y-5">
        <section className="crew-panel rounded-[2rem] p-5">
          <div className="flex items-center gap-3">
            <Radio size={20} className="text-[hsl(var(--teal))]" />
            <div>
              <h1 className="font-serif text-3xl text-slate-950">Live</h1>
              <p className="text-sm text-slate-600">Thread realtime per navigazioni, Q&A e aggiornamenti.</p>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => setSelectedId(event.id)}
                className={`w-full rounded-3xl border p-4 text-left transition-colors ${selected?.id === event.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200/80 bg-white/68 text-slate-950"}`}
              >
                <span className="flex items-center gap-2 text-xs opacity-70">
                  {event.visibility !== "public" && <Lock size={12} />}
                  {event.visibility === "tier" ? event.membership_tiers?.name : event.visibility}
                </span>
                <span className="mt-2 block font-serif text-xl">{event.title}</span>
                <span className="mt-1 block text-xs opacity-70">{formatDateTime(event.starts_at)}</span>
              </button>
            ))}
            {!events.length && <p className="text-sm text-slate-600">Nessun live programmato.</p>}
          </div>
        </section>

        {isAdmin && (
          <form className="crew-panel rounded-[2rem] p-5" onSubmit={createEvent}>
            <h2 className="font-serif text-2xl text-slate-950">Nuovo live</h2>
            <div className="mt-4 space-y-3">
              <label className="space-y-2">
                <span className="crew-label">Titolo</span>
                <input className="crew-field" value={newEvent.title} onChange={(event) => setNewEvent((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label className="space-y-2">
                <span className="crew-label">Inizio</span>
                <input type="datetime-local" className="crew-field" value={newEvent.starts_at} onChange={(event) => setNewEvent((current) => ({ ...current, starts_at: event.target.value }))} required />
              </label>
              <label className="space-y-2">
                <span className="crew-label">Fine</span>
                <input type="datetime-local" className="crew-field" value={newEvent.ends_at} onChange={(event) => setNewEvent((current) => ({ ...current, ends_at: event.target.value }))} />
              </label>
              <label className="space-y-2">
                <span className="crew-label">Visibilità</span>
                <select className="crew-field" value={newEvent.visibility} onChange={(event) => setNewEvent((current) => ({ ...current, visibility: event.target.value as typeof newEvent.visibility }))}>
                  <option value="public">Pubblico</option>
                  <option value="members">Membri</option>
                  <option value="tier">Tier specifico</option>
                </select>
              </label>
              {newEvent.visibility === "tier" && (
                <label className="space-y-2">
                  <span className="crew-label">Tier minimo</span>
                  <select className="crew-field" value={newEvent.min_tier_id} onChange={(event) => setNewEvent((current) => ({ ...current, min_tier_id: event.target.value }))} required>
                    <option value="">Scegli tier</option>
                    {tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                  </select>
                </label>
              )}
              <label className="space-y-2">
                <span className="crew-label">LiveKit</span>
                <select className="crew-field" value={newEvent.livekit_mode} onChange={(event) => setNewEvent((current) => ({ ...current, livekit_mode: event.target.value as typeof newEvent.livekit_mode }))}>
                  <option value="video">Video room</option>
                  <option value="audio">Audio room</option>
                  <option value="stage">Stage</option>
                  <option value="off">Solo thread</option>
                </select>
              </label>
              <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
                Crea live
              </button>
            </div>
          </form>
        )}
      </aside>

      <section className="crew-panel flex min-h-[36rem] flex-col rounded-[2rem] p-5 md:p-6">
        {selected ? (
          <>
            <header className="border-b border-slate-200/80 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <CalendarClock size={13} />
                    {formatDateTime(selected.starts_at)}
                  </div>
                  <h2 className="mt-2 font-serif text-4xl text-slate-950">{selected.title}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{messages.length} messaggi</span>
                  {selected.livekit_mode !== "off" && (
                    <button
                      type="button"
                      onClick={() => void joinLivekit()}
                      disabled={livekitBusy}
                      className="inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {livekitBusy ? "Connessione..." : livekitSession ? "Riconnetti room" : "Entra in room"}
                    </button>
                  )}
                </div>
              </div>
            </header>

            {livekitSession && (
              <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-950">
                <Suspense fallback={<div className="flex min-h-[24rem] items-center justify-center text-sm text-white/70">Caricamento room...</div>}>
                  <LivekitRoomPanel
                    serverUrl={livekitSession.url}
                    token={livekitSession.token}
                    video={selected.livekit_mode !== "audio"}
                  />
                </Suspense>
              </div>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-5">
              {messages.map((item) => (
                <article key={item.id} className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-slate-200">
                      {item.profiles?.avatar_url && <img src={item.profiles.avatar_url} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-950">{item.profiles?.name || "Membro"}</span>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{item.status === "hidden" ? "Messaggio nascosto." : item.content}</p>
                      {(isAdmin || isModerator) && item.status === "visible" && (
                        <button type="button" onClick={() => void hideMessage(item.id)} className="mt-2 text-xs text-slate-500 hover:text-slate-950">
                          Nascondi
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {!messages.length && (
                <div className="flex min-h-64 flex-col items-center justify-center text-center text-sm text-slate-500">
                  <MessageCircle size={26} />
                  <p className="mt-3">Nessun messaggio. Apri il thread quando parte il live.</p>
                </div>
              )}
            </div>

            <form className="border-t border-slate-200/80 pt-4" onSubmit={submitMessage}>
              {canWrite ? (
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor="live-message">Messaggio live</label>
                  <input
                    id="live-message"
                    className="crew-field min-h-12 flex-1"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    required
                  />
                  <button type="submit" disabled={busy} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white disabled:opacity-50">
                    <Send size={16} />
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Serve un Crew Pass attivo per scrivere nel live.</p>
              )}
            </form>
          </>
        ) : (
          <div className="flex min-h-[28rem] items-center justify-center text-center text-sm text-slate-500">Nessun live disponibile.</div>
        )}
      </section>
    </div>
  );
};

export default CrewLivePage;
