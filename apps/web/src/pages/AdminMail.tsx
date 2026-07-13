import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Inbox,
  Mail,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  isQuoteIntro,
  mailDisplaySender,
  mailPrimaryPreview,
  quotedLineDepth,
  splitQuotedMailText,
  unquoteLine,
} from "@/lib/mail-display";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";

type MailView = "inbox" | "unread" | "starred" | "archived" | "spam" | "sent";

type MailMessage = {
  id: string;
  created_at: string;
  source?: "inbound" | "sent";
  message_id?: string | null;
  thread_key?: string | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses?: string[];
  bcc_addresses?: string[];
  subject: string;
  text_body: string | null;
  html_body: string | null;
  brand: "bite_ordinary" | "bite_automatic" | "newsletter" | "transactional";
  read?: boolean;
  starred?: boolean;
  archived?: boolean;
  spam?: boolean;
  status?: string;
  assigned_to_profile_id?: string | null;
  assignment_reason?: "alias_match" | "fallback_all_admins" | "ambiguous_alias" | string | null;
  assigned_profile?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  thread_messages?: MailMessage[];
};

type FromOption = {
  id: string;
  label: string;
  from: string;
  brand: MailMessage["brand"];
};

type MailboxResponse = {
  view: MailView;
  messages: MailMessage[];
  total: number;
  counts: {
    inbox?: number;
    unread?: number;
    sent?: number;
  };
  fromOptions: FromOption[];
};

const fallbackFromOptions: FromOption[] = [
  { id: "hello", label: "Hello", from: "BITE <hello@biteproject.it>", brand: "bite_ordinary" },
  { id: "massimo", label: "Massimo", from: "Massimo <massimo@biteproject.it>", brand: "bite_ordinary" },
  { id: "sami", label: "Sami", from: "Sami <sami@biteproject.it>", brand: "bite_ordinary" },
  { id: "pack", label: "Pack", from: "Pack <pack@biteproject.it>", brand: "bite_ordinary" },
  { id: "viaggi", label: "Viaggi", from: "Viaggi <viaggi@biteproject.it>", brand: "bite_ordinary" },
  { id: "support", label: "Support", from: "Support <support@biteproject.it>", brand: "bite_ordinary" },
];

const viewOptions: Array<{ id: MailView; label: string; icon: typeof Inbox }> = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "unread", label: "Non lette", icon: Mail },
  { id: "starred", label: "Preferite", icon: Star },
  { id: "sent", label: "Inviate", icon: Send },
  { id: "archived", label: "Archivio", icon: Archive },
  { id: "spam", label: "Spam", icon: ShieldAlert },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function MailTextLines({ lines, quoted = false }: { lines: string[]; quoted?: boolean }) {
  return (
    <>
      {lines.map((line, index) => {
        const depth = quotedLineDepth(line);
        const content = depth > 0 ? unquoteLine(line, depth) : line;
        if (!content.trim()) return <div key={index} className="h-3" />;

        return (
          <p
            key={index}
            className={`my-0 whitespace-pre-wrap break-words py-0.5 ${
              quoted || depth > 0 || isQuoteIntro(line) ? "text-foreground/62" : "text-foreground"
            }`}
            style={depth > 1 ? { marginLeft: `${Math.min(depth - 1, 5) * 14}px` } : undefined}
          >
            {content}
          </p>
        );
      })}
    </>
  );
}

function MailTextBody({ text }: { text: string }) {
  const quoteRegionId = useId();
  const [quotesExpanded, setQuotesExpanded] = useState(false);
  const { visibleLines, quoteIntroLine, quotedLines, quotedSender } = useMemo(() => splitQuotedMailText(text), [text]);
  const hasQuotedContent = quotedLines.some((line) => line.trim());
  const quoteSender = quotedSender || "mittente";

  useEffect(() => {
    setQuotesExpanded(false);
  }, [text]);

  return (
    <div className="space-y-3 font-sans text-[15px] leading-7">
      <div className="space-y-1">
        <MailTextLines lines={visibleLines} />
      </div>

      {hasQuotedContent && (
        <div className="space-y-3">
          {quoteIntroLine && <MailTextLines lines={[quoteIntroLine]} quoted />}
          <button
            type="button"
            aria-expanded={quotesExpanded}
            aria-controls={quoteRegionId}
            onClick={() => setQuotesExpanded((current) => !current)}
            className="inline-flex min-h-8 items-center rounded-full px-0 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {quotesExpanded ? "Nascondi" : `Mostra di più da ${quoteSender}`}
          </button>

          {quotesExpanded && (
            <blockquote
              id={quoteRegionId}
              className="m-0 space-y-1 border-l-2 border-stone-300/80 pl-4 text-foreground/62"
            >
              <MailTextLines lines={quotedLines} quoted />
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}

const AdminMail = () => {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMessageId = searchParams.get("message");
  const [view, setView] = useState<MailView>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<MailboxResponse["counts"]>({});
  const [fromOptions, setFromOptions] = useState<FromOption[]>(fallbackFromOptions);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [compose, setCompose] = useState({
    fromOptionId: fallbackFromOptions[0].id,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    replyToMessageId: null as string | null,
  });
  const [showCcBcc, setShowCcBcc] = useState(false);

  useEffect(() => {
    if (searchParams.get("compose") !== "1") return;

    const to = searchParams.get("to") ?? "";
    const subject = searchParams.get("subject") ?? "";
    setCompose((current) => ({
      ...current,
      fromOptionId:
        fromOptions.find((option) => option.brand === "bite_ordinary")?.id ??
        fromOptions[0]?.id ??
        current.fromOptionId,
      to,
      cc: "",
      bcc: "",
      subject,
      body: "",
      replyToMessageId: null,
    }));
    setShowCcBcc(false);
    setComposeOpen(true);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("compose");
    nextSearchParams.delete("to");
    nextSearchParams.delete("subject");
    setSearchParams(nextSearchParams, { replace: true });
  }, [fromOptions, searchParams, setSearchParams]);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  );
  const selectedThreadMessages = useMemo(() => {
    const thread = selectedMessage?.thread_messages?.length ? selectedMessage.thread_messages : selectedMessage ? [selectedMessage] : [];
    return [...thread].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [selectedMessage]);

  useEffect(() => {
    if (!requestedMessageId) return;
    if (messages.some((message) => message.id === requestedMessageId)) {
      setSelectedId(requestedMessageId);
    }
  }, [messages, requestedMessageId]);

  const authHeaders = useCallback(async () => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const loadMailbox = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams({ view });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const response = await fetch(`/api/email/inbox?${params.toString()}`, { headers, cache: "no-store" });
      if (response.status === 401) {
        navigate("/login", { state: { from: "/admin/mail" } });
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as MailboxResponse;
      setMessages(data.messages);
      setCounts(data.counts ?? {});
      setFromOptions(data.fromOptions?.length ? data.fromOptions : fallbackFromOptions);
      setSelectedId((current) => {
        return current && data.messages.some((message) => message.id === current) ? current : data.messages[0]?.id ?? null;
      });
    } catch (error) {
      console.error("[AdminMail] load failed", error);
      toast.error("Impossibile caricare la casella mail.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, navigate, searchQuery, session?.access_token, view]);

  useEffect(() => {
    if (authLoading || !session) return;
    void loadMailbox();
  }, [authLoading, loadMailbox, session]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const runAction = async (id: string, action: string) => {
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/email/message", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadMailbox();
    } catch (error) {
      console.error("[AdminMail] action failed", error);
      toast.error("Azione non completata.");
    }
  };

  const openReply = (message: MailMessage) => {
    setCompose({
      fromOptionId: fromOptions.find((option) => option.brand === "bite_ordinary")?.id ?? fromOptions[0]?.id ?? "hello",
      to: message.from_address,
      cc: "",
      bcc: "",
      subject: message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`,
      body: "",
      replyToMessageId: message.id,
    });
    setShowCcBcc(false);
    setComposeOpen(true);
  };

  const sendMessage = async () => {
    setSending(true);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOptionId: compose.fromOptionId,
          to: compose.to,
          cc: compose.cc,
          bcc: compose.bcc,
          subject: compose.subject,
          text: compose.body,
          replyToMessageId: compose.replyToMessageId,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Email inviata.");
      setCompose({ fromOptionId: compose.fromOptionId, to: "", cc: "", bcc: "", subject: "", body: "", replyToMessageId: null });
      setShowCcBcc(false);
      setComposeOpen(false);
      if (view === "sent") await loadMailbox();
    } catch (error) {
      console.error("[AdminMail] send failed", error);
      toast.error("Invio email non riuscito.");
    } finally {
      setSending(false);
    }
  };

  if (authLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pb-16 pt-24 md:px-12">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="glass-panel rounded-[26px] px-5 py-4 md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <Link to="/admin" className="inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground">
                <ArrowLeft size={16} />
                Dashboard
              </Link>
              <h1 className="editorial-heading text-3xl leading-none md:text-4xl">Mail</h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:min-w-[620px]">
              <div className="relative min-w-0 flex-1">
                <label htmlFor="mail-search" className="sr-only">
                  Cerca mail per mittente, destinatario, corpo o data
                </label>
                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="mail-search"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Cerca mittente, destinatario, corpo o data"
                  className="h-11 w-full rounded-full border border-stone-200/80 bg-white/70 pl-11 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                    className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-stone-100 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label="Svuota ricerca mail"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadMailbox()}
                className="glass-chip inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 text-sm font-sans text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
                Aggiorna
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompose((current) => ({ ...current, to: "", cc: "", bcc: "", subject: "", body: "", replyToMessageId: null }));
                  setShowCcBcc(false);
                  setComposeOpen(true);
                }}
                className="glass-chip inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 text-sm font-sans text-foreground hover:text-accent"
              >
                <Send size={16} />
                Scrivi
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="glass-panel rounded-[30px] p-4 h-fit">
            <div className="space-y-2">
              {viewOptions.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                const count = item.id === "unread" ? counts.unread : item.id === "sent" ? counts.sent : item.id === "inbox" ? counts.inbox : undefined;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={`w-full rounded-[20px] px-4 py-3 text-left transition-colors ${
                      active ? "bg-white/85 border border-stone-200/90" : "glass-panel-soft hover:border-accent"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-3">
                        <Icon size={15} className={active ? "text-accent" : "text-muted-foreground"} />
                        <span className="text-sm font-sans text-foreground">{item.label}</span>
                      </span>
                      {typeof count === "number" && <span className="text-xs font-sans text-muted-foreground">{count}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="glass-panel rounded-[30px] overflow-hidden">
            <div className="grid min-h-[680px] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="border-b border-stone-200/70 lg:border-b-0 lg:border-r">
                {loading ? (
                  <div className="p-6 text-sm text-muted-foreground">Caricamento mail...</div>
                ) : messages.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    {searchQuery ? "Nessuna mail trovata per questa ricerca." : "Nessun messaggio in questa vista."}
                  </div>
                ) : (
                  <div className="max-h-[680px] overflow-y-auto">
                    {messages.map((message) => {
                      const selected = selectedMessage?.id === message.id;
                      const sender = view === "sent" ? message.to_addresses.join(", ") : mailDisplaySender(message);
                      const preview = mailPrimaryPreview(message);
                      return (
                        <button
                          key={message.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(message.id);
                            const nextSearchParams = new URLSearchParams(searchParams);
                            nextSearchParams.set("message", message.id);
                            setSearchParams(nextSearchParams, { replace: true });
                            if (view !== "sent" && !message.read) void runAction(message.id, "read");
                          }}
                          className={`block w-full border-b border-stone-200/60 px-4 py-4 text-left transition-colors ${
                            selected ? "bg-white/80" : "bg-white/25 hover:bg-white/55"
                          }`}
                        >
                          <span className="mb-1.5 flex items-start justify-between gap-3">
                            <span className={`min-w-0 flex-1 truncate text-[15px] font-sans leading-snug ${message.read || view === "sent" ? "text-foreground/82" : "font-semibold text-foreground"}`}>
                              {sender}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(message.created_at)}</span>
                          </span>
                          <span className="block truncate text-sm font-sans font-medium text-foreground">{message.subject || "(nessun oggetto)"}</span>
                          <span className="mt-2 block line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                            {preview || "Messaggio senza anteprima."}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <article className="min-w-0 p-5 md:p-7">
                {!selectedMessage ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Seleziona una mail</div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 border-b border-stone-200/70 pb-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <h2 className="editorial-heading text-3xl leading-tight">{selectedMessage.subject || "(nessun oggetto)"}</h2>
                        {selectedThreadMessages.length > 1 && (
                          <p className="mt-2 text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">
                            {selectedThreadMessages.length} messaggi nella conversazione
                          </p>
                        )}
                        <div className="mt-4 space-y-1.5 font-sans text-sm leading-relaxed">
                          <p className="grid gap-1 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                            <span className="text-muted-foreground">{selectedMessage.source === "sent" || view === "sent" ? "A" : "Da"}</span>
                            <span className="min-w-0 break-words text-foreground">
                              {selectedMessage.source === "sent" || view === "sent" ? selectedMessage.to_addresses.join(", ") : mailDisplaySender(selectedMessage)}
                            </span>
                          </p>
                          {selectedMessage.source !== "sent" && view !== "sent" && selectedMessage.from_name?.trim() && selectedMessage.from_address !== selectedMessage.from_name && (
                            <p className="grid gap-1 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                              <span className="text-muted-foreground">Mail</span>
                              <span className="min-w-0 break-words text-foreground/78">{selectedMessage.from_address}</span>
                            </p>
                          )}
                        </div>
                        {view === "sent" && selectedMessage.cc_addresses && selectedMessage.cc_addresses.length > 0 && (
                          <p className="mt-1 grid gap-1 font-sans text-sm leading-relaxed sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                            <span className="text-muted-foreground">Cc</span>
                            <span className="min-w-0 break-words text-foreground">{selectedMessage.cc_addresses.join(", ")}</span>
                          </p>
                        )}
                        {view === "sent" && selectedMessage.bcc_addresses && selectedMessage.bcc_addresses.length > 0 && (
                          <p className="mt-1 grid gap-1 font-sans text-sm leading-relaxed sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                            <span className="text-muted-foreground">Ccn</span>
                            <span className="min-w-0 break-words text-foreground">{selectedMessage.bcc_addresses.join(", ")}</span>
                          </p>
                        )}
                      </div>
                      {view !== "sent" && selectedMessage.source !== "sent" && (
                        <div className="flex flex-wrap gap-2">
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Rispondi" onClick={() => openReply(selectedMessage)}>
                            <Reply size={15} />
                          </button>
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Preferita" onClick={() => void runAction(selectedMessage.id, selectedMessage.starred ? "unstar" : "star")}>
                            <Star size={15} className={selectedMessage.starred ? "fill-current text-accent" : undefined} />
                          </button>
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Archivia" onClick={() => void runAction(selectedMessage.id, selectedMessage.archived ? "restore" : "archive")}>
                            <Archive size={15} />
                          </button>
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Spam" onClick={() => void runAction(selectedMessage.id, selectedMessage.spam ? "not_spam" : "spam")}>
                            <ShieldAlert size={15} />
                          </button>
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Elimina" onClick={() => void runAction(selectedMessage.id, "delete")}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      {selectedThreadMessages.map((message) => {
                        const isSent = message.source === "sent";
                        return (
                          <section
                            key={`${message.source ?? "inbound"}-${message.id}`}
                            className={`rounded-[24px] border px-4 py-4 md:px-5 ${
                              isSent ? "border-teal-100/80 bg-teal-50/45" : "border-stone-200/75 bg-white/45"
                            }`}
                          >
                            <div className="mb-3 flex flex-col gap-1 border-b border-stone-200/60 pb-3 font-sans text-sm sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">
                                  {isSent ? `A ${message.to_addresses.join(", ")}` : mailDisplaySender(message)}
                                </p>
                                {!isSent && message.from_name?.trim() && message.from_address !== message.from_name && (
                                  <p className="break-words text-xs text-muted-foreground">{message.from_address}</p>
                                )}
                              </div>
                              <p className="shrink-0 text-xs text-muted-foreground">{formatDate(message.created_at)}</p>
                            </div>
                            <div className="prose prose-stone max-w-none text-sm leading-relaxed">
                              {message.text_body?.trim() ? (
                                <MailTextBody text={message.text_body} />
                              ) : message.html_body ? (
                                <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(message.html_body) }} />
                              ) : (
                                <p>Messaggio senza corpo.</p>
                              )}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>
            </div>
          </main>
        </section>
      </div>

      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/20 p-4 backdrop-blur-sm md:p-8">
          <div className="glass-panel w-full max-w-2xl rounded-[30px] p-5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  {compose.replyToMessageId ? "Risposta" : "Nuovo messaggio"}
                </p>
                <h2 className="editorial-heading text-3xl">{compose.replyToMessageId ? "Rispondi" : "Scrivi mail"}</h2>
              </div>
              <button type="button" onClick={() => setComposeOpen(false)} className="glass-chip px-3 py-2 text-sm">
                Chiudi
              </button>
            </div>
            <div className="space-y-3">
              <select
                value={compose.fromOptionId}
                onChange={(event) => setCompose((current) => ({ ...current, fromOptionId: event.target.value }))}
                className="w-full rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-accent"
              >
                {fromOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} - {option.from}
                  </option>
                ))}
              </select>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={compose.to}
                    onChange={(event) => setCompose((current) => ({ ...current, to: event.target.value }))}
                    placeholder="destinatario@email.it"
                    className="w-full rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-accent"
                  />
                  {!showCcBcc && (
                    <button
                      type="button"
                      onClick={() => setShowCcBcc(true)}
                      className="shrink-0 whitespace-nowrap text-xs font-sans text-muted-foreground hover:text-accent"
                    >
                      Cc/Ccn
                    </button>
                  )}
                </div>
                {showCcBcc && (
                  <>
                    <input
                      value={compose.cc}
                      onChange={(event) => setCompose((current) => ({ ...current, cc: event.target.value }))}
                      placeholder="Cc: destinatario@email.it"
                      className="w-full rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-accent"
                    />
                    <input
                      value={compose.bcc}
                      onChange={(event) => setCompose((current) => ({ ...current, bcc: event.target.value }))}
                      placeholder="Ccn: destinatario@email.it"
                      className="w-full rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-accent"
                    />
                  </>
                )}
              </div>
              <input
                value={compose.subject}
                onChange={(event) => setCompose((current) => ({ ...current, subject: event.target.value }))}
                placeholder="Oggetto"
                className="w-full rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-accent"
              />
              <textarea
                value={compose.body}
                onChange={(event) => setCompose((current) => ({ ...current, body: event.target.value }))}
                placeholder="Scrivi il messaggio..."
                rows={12}
                className="w-full resize-none rounded-[18px] border border-stone-200 bg-white/80 px-4 py-3 text-sm leading-relaxed outline-none focus:border-accent"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={sending}
                  className="glass-chip inline-flex items-center gap-2 px-5 py-3 text-sm font-sans text-foreground hover:text-accent disabled:opacity-60"
                >
                  <Send size={16} />
                  {sending ? "Invio..." : "Invia"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMail;
