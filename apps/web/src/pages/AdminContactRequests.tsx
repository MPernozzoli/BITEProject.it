import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Archive, ArrowLeft, ExternalLink, Inbox, MessageSquare, RefreshCw, Reply, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { fallbackFromOptions, type MailFromOption } from "@/lib/mail-from-options";

/**
 * Contact console. The form on /contact writes each submission straight into the
 * mailbox as a message from the visitor (see supabase/functions/contact-form-submit),
 * so this page reads the same `inbound_emails` rows /admin/mail shows — filtered to
 * `intake_source = 'contact_form'` — and replies through the very same
 * `/api/email/send` route. The recipient is therefore the person who wrote to us.
 */

type ContactRequest = {
  id: string;
  created_at: string;
  from_address: string;
  from_name: string | null;
  subject: string;
  text_body: string | null;
  thread_key: string | null;
  read: boolean;
  archived: boolean;
  headers: unknown;
};

type ContactReply = {
  id: string;
  created_at: string;
  thread_key: string | null;
  from_address: string;
  to_addresses: string[];
  subject: string;
  text_body: string | null;
  sent_by_name: string | null;
};

type ListFilter = "open" | "handled" | "all";

const listFilters: Array<{ id: ListFilter; label: string; icon: typeof Inbox }> = [
  { id: "open", label: "Da gestire", icon: Inbox },
  { id: "handled", label: "Gestite", icon: Archive },
  { id: "all", label: "Tutte", icon: MessageSquare },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** The edge function stores the submission language as an X-BITE-Language header. */
function readLanguage(headers: unknown): string | null {
  if (!Array.isArray(headers)) return null;
  for (const header of headers) {
    if (!header || typeof header !== "object") continue;
    const { name, value } = header as { name?: unknown; value?: unknown };
    if (typeof name === "string" && name.toLowerCase() === "x-bite-language" && typeof value === "string") {
      return value.trim().toUpperCase() || null;
    }
  }
  return null;
}

function replySubject(subject: string) {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function quoteOriginal(request: ContactRequest) {
  const lines = (request.text_body ?? "").split("\n").map((line) => `> ${line}`);
  return [
    "",
    "",
    `Il ${formatDate(request.created_at)}, ${request.from_name || request.from_address} ha scritto:`,
    ...lines,
  ].join("\n");
}

const AdminContactRequests = () => {
  const { session, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  // Push notifications for a new contact message link here with ?message=<id>
  // (see supabase/functions/contact-form-submit), so the click opens that request.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMessageId = searchParams.get("message");
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [replies, setReplies] = useState<ContactReply[]>([]);
  const [filter, setFilter] = useState<ListFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState({ fromOptionId: fallbackFromOptions[0].id, subject: "", body: "" });
  const hasLoadedRef = useRef(false);

  const authHeaders = useCallback(() => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    if (!hasLoadedRef.current) setLoading(true);
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("inbound_emails")
        .select("id, created_at, from_address, from_name, subject, text_body, thread_key, read, archived, headers")
        .eq("intake_source", "contact_form")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = (data ?? []) as ContactRequest[];
      setRequests(rows);
      hasLoadedRef.current = true;

      const threadKeys = rows.map((row) => row.thread_key).filter((key): key is string => Boolean(key));
      if (threadKeys.length === 0) {
        setReplies([]);
        return;
      }

      const { data: replyRows, error: replyError } = await supabase
        .from("sent_emails")
        .select("id, created_at, thread_key, from_address, to_addresses, subject, text_body, sent_by_name")
        .in("thread_key", threadKeys)
        .order("created_at", { ascending: true });
      if (replyError) throw replyError;
      setReplies((replyRows ?? []) as ContactReply[]);
    } catch (error) {
      console.error("[AdminContactRequests] load failed", error);
      toast.error("Impossibile caricare le richieste di contatto.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (authLoading || !session) return;
    void load();
  }, [authLoading, load, session]);

  const repliesByThread = useMemo(() => {
    const map: Record<string, ContactReply[]> = {};
    replies.forEach((item) => {
      if (!item.thread_key) return;
      if (!map[item.thread_key]) map[item.thread_key] = [];
      map[item.thread_key].push(item);
    });
    return map;
  }, [replies]);

  const repliesFor = useCallback(
    (request: ContactRequest | null) => (request?.thread_key ? repliesByThread[request.thread_key] ?? [] : []),
    [repliesByThread],
  );

  // A deep-linked request may be archived or already answered, so widen the view
  // to "all" rather than opening on an empty list.
  useEffect(() => {
    if (!requestedMessageId) return;
    setFilter("all");
    setSelectedId(requestedMessageId);
  }, [requestedMessageId]);

  const visibleRequests = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((request) => {
      const handled = request.archived || repliesFor(request).length > 0;
      return filter === "handled" ? handled : !handled;
    });
  }, [filter, repliesFor, requests]);

  const openCount = useMemo(
    () => requests.filter((request) => !request.archived && repliesFor(request).length === 0).length,
    [repliesFor, requests],
  );

  const selectedRequest = useMemo(() => {
    const explicit = visibleRequests.find((request) => request.id === selectedId) ?? null;
    return explicit ?? (isMobile ? null : visibleRequests[0] ?? null);
  }, [isMobile, selectedId, visibleRequests]);

  const selectedReplies = repliesFor(selectedRequest);

  const runMessageAction = useCallback(
    async (id: string, action: "read" | "archive" | "restore") => {
      try {
        const response = await fetch("/api/email/message", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (response.status === 401) {
          navigate("/login", { state: { from: "/admin/contatti" } });
          return false;
        }
        if (!response.ok) throw new Error(await response.text());
        return true;
      } catch (error) {
        console.error("[AdminContactRequests] action failed", error);
        toast.error("Azione non completata.");
        return false;
      }
    },
    [authHeaders, navigate],
  );

  // Opening a request marks it read, exactly as it would in the mail console.
  useEffect(() => {
    if (!selectedRequest || selectedRequest.read) return;
    const id = selectedRequest.id;
    setRequests((current) => current.map((request) => (request.id === id ? { ...request, read: true } : request)));
    void runMessageAction(id, "read");
  }, [runMessageAction, selectedRequest]);

  useEffect(() => {
    setReplyOpen(false);
  }, [selectedRequest?.id]);

  const openReply = (request: ContactRequest) => {
    setReply({
      fromOptionId: fallbackFromOptions[0].id,
      subject: replySubject(request.subject),
      body: quoteOriginal(request),
    });
    setReplyOpen(true);
  };

  const sendReply = async () => {
    if (!selectedRequest) return;
    if (!reply.subject.trim() || !reply.body.trim()) {
      toast.error("Oggetto e messaggio sono obbligatori.");
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOptionId: reply.fromOptionId,
          to: selectedRequest.from_address,
          subject: reply.subject,
          text: reply.body,
          replyToMessageId: selectedRequest.id,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success(`Risposta inviata a ${selectedRequest.from_address}.`);
      setReplyOpen(false);
      await load();
    } catch (error) {
      console.error("[AdminContactRequests] reply failed", error);
      toast.error("Invio della risposta non riuscito.");
    } finally {
      setSending(false);
    }
  };

  const toggleArchive = async (request: ContactRequest) => {
    const action = request.archived ? "restore" : "archive";
    const ok = await runMessageAction(request.id, action);
    if (!ok) return;
    setRequests((current) =>
      current.map((item) => (item.id === request.id ? { ...item, archived: !request.archived } : item)),
    );
  };

  if (authLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  const isMobileDetailOpen = isMobile && !!selectedRequest;

  return (
    <div className="min-h-screen px-4 pb-16 pt-[5.5rem] sm:px-6 md:px-10 lg:pt-24 xl:px-12">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <section className={`glass-panel rounded-[26px] px-5 py-4 md:px-6 ${isMobileDetailOpen ? "hidden md:block" : ""}`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <Link to="/admin" className="inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground">
                <ArrowLeft size={16} />
                Torna alla Dashboard
              </Link>
              <h1 className="editorial-heading mt-3 text-3xl md:text-4xl">Richieste di contatto</h1>
              <p className="mt-1 max-w-2xl text-sm font-sans text-muted-foreground">
                Arrivano dal form di /contact. Le candidature ai viaggi non passano di qui: si gestiscono in{" "}
                <Link to="/admin/bookings" className="text-accent hover:underline">
                  Booking
                </Link>
                . Rispondendo scrivi direttamente al mittente, e la risposta finisce anche in{" "}
                <Link to="/admin/mail" className="text-accent hover:underline">
                  Mail
                </Link>
                .
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="glass-chip px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                {openCount} da gestire
              </span>
              <button
                type="button"
                onClick={() => void load()}
                className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-sm font-sans text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />
                Aggiorna
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {listFilters.map((option) => {
              const Icon = option.icon;
              const active = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setFilter(option.id);
                    setSelectedId(null);
                    if (requestedMessageId) {
                      const next = new URLSearchParams(searchParams);
                      next.delete("message");
                      setSearchParams(next, { replace: true });
                    }
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-sans transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-foreground"
                  }`}
                >
                  <Icon size={15} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[0.8fr_1.6fr]">
          <div className={`glass-panel rounded-[30px] p-3 md:p-4 ${isMobileDetailOpen ? "hidden md:block" : ""}`}>
            {loading ? (
              <p className="p-4 text-sm font-sans text-muted-foreground animate-pulse">Caricamento richieste...</p>
            ) : visibleRequests.length === 0 ? (
              <p className="p-4 text-sm font-sans text-muted-foreground">Nessuna richiesta in questa vista.</p>
            ) : (
              <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
                {visibleRequests.map((request) => {
                  const answered = repliesFor(request).length > 0;
                  const active = selectedRequest?.id === request.id;
                  return (
                    <li key={request.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(request.id)}
                        className={`w-full rounded-[22px] border px-4 py-3 text-left transition-colors ${
                          active ? "border-accent bg-accent/10" : "border-border/70 bg-background/40 hover:border-accent/50"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`truncate text-sm font-sans ${request.read ? "text-foreground" : "font-semibold text-foreground"}`}>
                            {request.from_name || request.from_address}
                          </span>
                          <span className="shrink-0 text-[10px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                            {formatDate(request.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm font-sans text-foreground/80">{request.subject}</p>
                        <p className="mt-1 truncate text-xs font-sans text-muted-foreground">{request.text_body}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {!request.read && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.14em] text-accent">
                              Nuova
                            </span>
                          )}
                          {answered && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.14em] text-emerald-800">
                              Risposta inviata
                            </span>
                          )}
                          {request.archived && (
                            <span className="rounded-full bg-stone-200/70 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.14em] text-stone-700">
                              Archiviata
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={`glass-panel rounded-[30px] p-5 md:p-7 ${isMobile && !selectedRequest ? "hidden" : ""}`}>
            {!selectedRequest ? (
              <p className="text-sm font-sans text-muted-foreground">Seleziona una richiesta per leggerla e rispondere.</p>
            ) : (
              <div className="space-y-6">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft size={16} />
                    Tutte le richieste
                  </button>
                )}

                <header className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="editorial-heading text-2xl md:text-3xl">{selectedRequest.subject}</h2>
                    {readLanguage(selectedRequest.headers) && (
                      <span className="glass-chip px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                        {readLanguage(selectedRequest.headers)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-sans text-muted-foreground">
                    {selectedRequest.from_name || "Senza nome"} ·{" "}
                    <a href={`mailto:${selectedRequest.from_address}`} className="text-accent hover:underline">
                      {selectedRequest.from_address}
                    </a>{" "}
                    · {formatDate(selectedRequest.created_at)}
                  </p>
                </header>

                <div className="glass-panel-soft rounded-[24px] p-5">
                  <p className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground">
                    {selectedRequest.text_body || "(messaggio vuoto)"}
                  </p>
                </div>

                {selectedReplies.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      Risposte inviate
                    </p>
                    {selectedReplies.map((item) => (
                      <div key={item.id} className="rounded-[24px] border border-emerald-200/70 bg-emerald-50/50 p-5">
                        <p className="text-xs font-sans text-emerald-900/80">
                          {item.from_address} → {item.to_addresses.join(", ")} · {formatDate(item.created_at)}
                          {item.sent_by_name ? ` · ${item.sent_by_name}` : ""}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground">
                          {item.text_body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openReply(selectedRequest)}
                    className="glass-button inline-flex items-center gap-2 px-5 py-2.5 text-sm font-sans font-medium"
                  >
                    <Reply size={16} />
                    Rispondi a {selectedRequest.from_address}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleArchive(selectedRequest)}
                    className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground"
                  >
                    {selectedRequest.archived ? <Undo2 size={15} /> : <Archive size={15} />}
                    {selectedRequest.archived ? "Ripristina" : "Archivia"}
                  </button>
                  <Link
                    to={`/admin/mail?message=${selectedRequest.id}`}
                    className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={15} />
                    Apri in Mail
                  </Link>
                </div>

                {replyOpen && (
                  <div className="space-y-4 rounded-[26px] border border-border/70 bg-background/50 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                          Da
                        </span>
                        <select
                          value={reply.fromOptionId}
                          onChange={(event) => setReply((current) => ({ ...current, fromOptionId: event.target.value }))}
                          className="w-full rounded-[18px] border border-border/70 bg-background/70 px-4 py-2.5 text-sm font-sans text-foreground focus:outline-none"
                        >
                          {fallbackFromOptions.map((option: MailFromOption) => (
                            <option key={option.id} value={option.id}>
                              {option.from}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                          A
                        </span>
                        <input
                          value={selectedRequest.from_address}
                          readOnly
                          className="w-full rounded-[18px] border border-border/70 bg-background/40 px-4 py-2.5 text-sm font-sans text-muted-foreground focus:outline-none"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                        Oggetto
                      </span>
                      <input
                        value={reply.subject}
                        onChange={(event) => setReply((current) => ({ ...current, subject: event.target.value }))}
                        className="w-full rounded-[18px] border border-border/70 bg-background/70 px-4 py-2.5 text-sm font-sans text-foreground focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                        Messaggio
                      </span>
                      <textarea
                        rows={10}
                        value={reply.body}
                        onChange={(event) => setReply((current) => ({ ...current, body: event.target.value }))}
                        className="w-full resize-y rounded-[22px] border border-border/70 bg-background/70 px-4 py-3 text-sm font-sans leading-relaxed text-foreground focus:outline-none"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => void sendReply()}
                        className="glass-button inline-flex items-center gap-2 px-6 py-2.5 text-sm font-sans font-medium disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <Send size={16} />
                        {sending ? "Invio..." : "Invia risposta"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplyOpen(false)}
                        className="glass-chip px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminContactRequests;
