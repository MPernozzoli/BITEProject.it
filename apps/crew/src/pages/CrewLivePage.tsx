import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Bell, BellRing, CalendarClock, Lock, MessageCircle, Radio, Send } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunityLiveEvent,
  CommunityLiveMessage,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  liveStatusFor,
  liveStatusLabel,
  type CommunitySubscription,
} from "@/lib/community";

const LivekitRoomPanel = lazy(() => import("@/components/LivekitRoomPanel"));

const CrewLivePage = () => {
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState<CommunityLiveEvent[]>([]);
  const [messages, setMessages] = useState<CommunityLiveMessage[]>([]);
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [livekitSession, setLivekitSession] = useState<{ url: string; token: string; roomName: string; canPublish: boolean } | null>(null);
  const [livekitBusy, setLivekitBusy] = useState(false);
  const [reminderIds, setReminderIds] = useState<Record<string, string>>({});
  const [reminderBusy, setReminderBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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
    setSelectedId((current) => current ?? searchParams.get("event") ?? nextEvents[0]?.id ?? null);
  };

  const loadReminders = async (profileId: string) => {
    const { data, error } = await supabase
      .from("community_live_event_reminders")
      .select("id, live_event_id")
      .eq("profile_id", profileId);

    if (error) {
      console.error(error);
      return;
    }

    setReminderIds(
      Object.fromEntries((data ?? []).map((row) => [row.live_event_id, row.id])),
    );
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
      await loadEvents();
      if (membership.session?.user.id) await loadReminders(membership.session.user.id);
      setLoading(false);
    };
    void load();

    const channel = supabase
      .channel("community-live-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_live_events" }, () => void loadEvents())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_live_event_reminders" }, () => {
        if (userId) void loadReminders(userId);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [searchParams, userId]);

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

  const hideMessage = async (id: string) => {
    const { error } = await supabase.from("community_live_messages").update({ status: "hidden" }).eq("id", id);
    if (error) toast.error("Moderazione non riuscita.");
  };

  const toggleReminder = async () => {
    if (!selected) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin(window.location.href);
      return;
    }

    setReminderBusy(true);
    const existingId = reminderIds[selected.id];
    if (existingId) {
      const { error } = await supabase.from("community_live_event_reminders").delete().eq("id", existingId);
      if (error) {
        toast.error("Promemoria non rimosso.");
      } else {
        setReminderIds((current) => {
          const next = { ...current };
          delete next[selected.id];
          return next;
        });
        toast.success("Promemoria rimosso.");
      }
    } else {
      const { data, error } = await supabase
        .from("community_live_event_reminders")
        .insert({
          live_event_id: selected.id,
          profile_id: session.user.id,
          remind_before_minutes: 10,
        })
        .select("id")
        .single();

      if (error || !data?.id) {
        toast.error(error?.message.includes("row-level") ? "Serve l'accesso a questa live per attivare il promemoria." : "Promemoria non attivato.");
      } else {
        setReminderIds((current) => ({ ...current, [selected.id]: data.id }));
        toast.success("Ti avvisiamo 10 minuti prima e quando inizia.");
      }
    }
    setReminderBusy(false);
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
            {events.map((event) => {
              const status = liveStatusFor(event);
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedId(event.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition-colors ${selected?.id === event.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200/80 bg-white/68 text-slate-950"}`}
                >
                  <span className="flex items-center justify-between gap-2 text-xs opacity-70">
                    <span className="inline-flex items-center gap-2">
                      {event.visibility !== "public" && <Lock size={12} />}
                      {event.visibility === "tier" ? event.membership_tiers?.name : event.visibility}
                    </span>
                    <span className={status === "live" ? "font-semibold text-[hsl(var(--teal))]" : ""}>{liveStatusLabel(status)}</span>
                  </span>
                  <span className="mt-2 block font-serif text-xl">{event.title}</span>
                  <span className="mt-1 block text-xs opacity-70">{formatDateTime(event.starts_at)}</span>
                </button>
              );
            })}
            {!events.length && <p className="text-sm text-slate-600">Nessun live programmato.</p>}
          </div>
        </section>

        <div className="crew-panel rounded-[2rem] p-5">
          <h2 className="font-serif text-2xl text-slate-950">Crea dal feed</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Le live si aprono dal riquadro in cima al feed, nello stesso composer usato per testo, link e poll. Questa pagina resta dedicata a room e thread.
          </p>
          <Link to="/feed" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
            Apri composer
          </Link>
        </div>
      </aside>

      <section className="crew-panel flex min-h-[36rem] flex-col rounded-[2rem] p-5 md:p-6">
        {selected ? (
          <>
            <header className="border-b border-slate-200/80 pb-4">
              {(() => {
                const selectedStatus = liveStatusFor(selected);
                return (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <CalendarClock size={13} />
                    {formatDateTime(selected.starts_at)}
                  </div>
                  <h2 className="mt-2 font-serif text-4xl text-slate-950">{selected.title}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${selectedStatus === "live" ? "bg-[hsl(var(--teal))] text-white" : "bg-slate-100 text-slate-600"}`}>
                    {liveStatusLabel(selectedStatus)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{messages.length} messaggi</span>
                  <button
                    type="button"
                    onClick={() => void toggleReminder()}
                    disabled={reminderBusy || new Date(selected.starts_at).getTime() <= Date.now()}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-xs font-medium disabled:opacity-45 ${
                      reminderIds[selected.id] ? "bg-[hsl(var(--teal))] text-white" : "bg-white text-slate-950 ring-1 ring-slate-200"
                    }`}
                  >
                    {reminderIds[selected.id] ? <BellRing size={14} /> : <Bell size={14} />}
                    {reminderIds[selected.id] ? "Avviso attivo" : "Avvisami"}
                  </button>
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
                );
              })()}
            </header>

            <div className="mt-5 grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-4">
                {livekitSession ? (
                  <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-950">
                    <Suspense fallback={<div className="flex min-h-[24rem] items-center justify-center text-sm text-white/70">Caricamento room...</div>}>
                      <LivekitRoomPanel
                        serverUrl={livekitSession.url}
                        token={livekitSession.token}
                        video={selected.livekit_mode !== "audio"}
                        canPublish={livekitSession.canPublish}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-[1.5rem] border border-slate-200 bg-slate-950 p-6 text-center text-white">
                    <Radio size={28} className="text-[hsl(var(--teal))]" />
                    <p className="mt-4 max-w-md font-serif text-3xl">Room pronta per il live</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/68">
                      Entra per vedere e ascoltare. Solo gli admin possono condividere videocamera, microfono e schermo.
                    </p>
                  </div>
                )}
                <p className="rounded-3xl border border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-600">
                  La chat resta accanto alla diretta: chi partecipa può scrivere nel thread, mentre la regia audio/video è riservata agli admin.
                </p>
              </div>

              <aside className="flex min-h-[32rem] flex-col rounded-[1.5rem] border border-slate-200 bg-white/70">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-sm font-medium text-slate-950">Chat live</p>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.map((item) => (
                    <article key={item.id} className="rounded-3xl border border-slate-200/80 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 overflow-hidden rounded-full bg-slate-200">
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

                <form className="border-t border-slate-200 p-4" onSubmit={submitMessage}>
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
              </aside>
            </div>
          </>
        ) : (
          <div className="flex min-h-[28rem] items-center justify-center text-center text-sm text-slate-500">Nessun live disponibile.</div>
        )}
      </section>
    </div>
  );
};

export default CrewLivePage;
