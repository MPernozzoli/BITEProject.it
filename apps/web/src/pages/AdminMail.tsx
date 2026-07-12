import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Inbox,
  Mail,
  RefreshCw,
  Reply,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type MailView = "inbox" | "unread" | "starred" | "archived" | "spam" | "sent";

type MailMessage = {
  id: string;
  created_at: string;
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

function brandLabel(brand: MailMessage["brand"]) {
  if (brand === "bite_automatic") return "@mail.biteproject.it";
  if (brand === "newsletter") return "Newsletter";
  if (brand === "transactional") return "Transazionale";
  return "@biteproject.it";
}

function assignmentLabel(message: MailMessage) {
  if (message.assigned_profile) return `Assegnata a ${message.assigned_profile.name || message.assigned_profile.email}`;
  if (message.assignment_reason === "fallback_all_admins") return "Notificata a tutti gli admin";
  if (message.assignment_reason === "ambiguous_alias") return "Alias ambiguo: notificata a tutti";
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function htmlToText(html: string | null, fallback: string | null) {
  if (fallback?.trim()) return fallback;
  if (!html) return "";
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const AdminMail = () => {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<MailView>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<MailboxResponse["counts"]>({});
  const [fromOptions, setFromOptions] = useState<FromOption[]>(fallbackFromOptions);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({
    fromOptionId: fallbackFromOptions[0].id,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
  });
  const [showCcBcc, setShowCcBcc] = useState(false);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  );

  const authHeaders = useCallback(async () => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const loadMailbox = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/email/inbox?view=${view}`, { headers, cache: "no-store" });
      if (response.status === 401) {
        navigate("/login", { state: { from: "/admin/mail" } });
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as MailboxResponse;
      setMessages(data.messages);
      setCounts(data.counts ?? {});
      setFromOptions(data.fromOptions?.length ? data.fromOptions : fallbackFromOptions);
      setSelectedId((current) => (current && data.messages.some((message) => message.id === current) ? current : data.messages[0]?.id ?? null));
    } catch (error) {
      console.error("[AdminMail] load failed", error);
      toast.error("Impossibile caricare la casella mail.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, navigate, session?.access_token, view]);

  useEffect(() => {
    if (authLoading || !session) return;
    void loadMailbox();
  }, [authLoading, loadMailbox, session]);

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
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Email inviata.");
      setCompose({ fromOptionId: compose.fromOptionId, to: "", cc: "", bcc: "", subject: "", body: "" });
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
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-7 md:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link to="/admin" className="mb-4 inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground">
                <ArrowLeft size={16} />
                Dashboard
              </Link>
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Posta admin</p>
              <h1 className="editorial-heading text-4xl md:text-5xl">Mail</h1>
              <p className="mt-3 max-w-2xl text-sm font-sans leading-relaxed text-foreground/70">
                Gestione casella ordinaria @biteproject.it e messaggi automatici/newsletter da @mail.biteproject.it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void loadMailbox()}
                className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
                Aggiorna
              </button>
              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent"
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
                  <div className="p-6 text-sm text-muted-foreground">Nessun messaggio in questa vista.</div>
                ) : (
                  <div className="max-h-[680px] overflow-y-auto">
                    {messages.map((message) => {
                      const selected = selectedMessage?.id === message.id;
                      const sender = view === "sent" ? message.to_addresses.join(", ") : message.from_name || message.from_address;
                      return (
                        <button
                          key={message.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(message.id);
                            if (view !== "sent" && !message.read) void runAction(message.id, "read");
                          }}
                          className={`block w-full border-b border-stone-200/60 px-4 py-4 text-left transition-colors ${
                            selected ? "bg-white/80" : "bg-white/25 hover:bg-white/55"
                          }`}
                        >
                          <span className="mb-2 flex items-start justify-between gap-3">
                            <span className={`truncate text-sm font-sans ${message.read || view === "sent" ? "text-foreground/78" : "font-semibold text-foreground"}`}>
                              {sender}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(message.created_at)}</span>
                          </span>
                          <span className="block truncate text-sm font-sans text-foreground">{message.subject || "(nessun oggetto)"}</span>
                          <span className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {htmlToText(message.html_body, message.text_body)}
                          </span>
                          <span className="mt-3 inline-flex rounded-full border border-stone-200/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {brandLabel(message.brand)}
                          </span>
                          {assignmentLabel(message) && (
                            <span className="ml-2 mt-3 inline-flex rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-accent">
                              {assignmentLabel(message)}
                            </span>
                          )}
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
                        <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{brandLabel(selectedMessage.brand)}</p>
                        <h2 className="editorial-heading text-3xl leading-tight">{selectedMessage.subject || "(nessun oggetto)"}</h2>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {view === "sent" ? "A" : "Da"}{" "}
                          <span className="text-foreground">
                            {view === "sent" ? selectedMessage.to_addresses.join(", ") : selectedMessage.from_name || selectedMessage.from_address}
                          </span>
                        </p>
                        {view === "sent" && selectedMessage.cc_addresses && selectedMessage.cc_addresses.length > 0 && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Cc <span className="text-foreground">{selectedMessage.cc_addresses.join(", ")}</span>
                          </p>
                        )}
                        {view === "sent" && selectedMessage.bcc_addresses && selectedMessage.bcc_addresses.length > 0 && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Ccn <span className="text-foreground">{selectedMessage.bcc_addresses.join(", ")}</span>
                          </p>
                        )}
                        {assignmentLabel(selectedMessage) && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Routing <span className="text-foreground">{assignmentLabel(selectedMessage)}</span>
                          </p>
                        )}
                      </div>
                      {view !== "sent" && (
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

                    <div className="prose prose-stone max-w-none text-sm leading-relaxed">
                      {selectedMessage.html_body ? (
                        <div dangerouslySetInnerHTML={{ __html: selectedMessage.html_body }} />
                      ) : (
                        <p className="whitespace-pre-wrap">{selectedMessage.text_body || "Messaggio senza corpo."}</p>
                      )}
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
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Nuovo messaggio</p>
                <h2 className="editorial-heading text-3xl">Scrivi mail</h2>
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
