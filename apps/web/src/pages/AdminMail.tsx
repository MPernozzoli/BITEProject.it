import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Download,
  FileText,
  Inbox,
  Mail,
  Paperclip,
  RefreshCw,
  Reply,
  ReplyAll,
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
  isQuoteIntro,
  mailDisplaySender,
  mailPrimaryPreview,
  quotedLineDepth,
  splitQuotedMailText,
  unquoteLine,
} from "@pynkstudio/mailapp/mailbox";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";
import { fallbackFromOptions, type MailFromOption } from "@/lib/mail-from-options";

type MailView = "inbox" | "unread" | "starred" | "archived" | "spam" | "sent";

type MailMessage = {
  id: string;
  created_at: string;
  source?: "inbound" | "sent";
  message_id?: string | null;
  resend_email_id?: string | null;
  resend_message_id?: string | null;
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
  attachments?: MailAttachment[];
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

type MailAttachment = {
  id?: string;
  filename?: string;
  name?: string;
  size?: number;
  content_type?: string;
  contentType?: string;
  content_disposition?: string;
  content_id?: string;
  download_url?: string;
  expires_at?: string;
};

type ComposeAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  content: string;
};

type FromOption = MailFromOption;

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

const MAX_COMPOSE_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const linkPattern = /(https?:\/\/[^\s<>"')\]]+)/gi;

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

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function uniqueAddresses(addresses: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return addresses
    .map((address) => address?.trim() ?? "")
    .filter(Boolean)
    .filter((address) => {
      const key = extractEmailAddress(address);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function attachmentName(attachment: MailAttachment) {
  return attachment.filename || attachment.name || "Allegato";
}

function attachmentContentType(attachment: MailAttachment) {
  return attachment.content_type || attachment.contentType || "";
}

function isImageAttachment(attachment: MailAttachment) {
  return attachmentContentType(attachment).startsWith("image/");
}

function attachmentUrlIsFresh(attachment: MailAttachment) {
  if (!attachment.download_url) return false;
  if (!attachment.expires_at) return true;
  const expiresAt = Date.parse(attachment.expires_at);
  return Number.isNaN(expiresAt) || expiresAt > Date.now() + 60_000;
}

function attachmentDownloadHref(message: MailMessage, attachment: MailAttachment) {
  if (attachmentUrlIsFresh(attachment)) return attachment.download_url ?? "";
  if (!message.resend_email_id || !attachment.id) return "";
  const params = new URLSearchParams({
    messageId: message.id,
    attachmentId: attachment.id,
  });
  return `/api/email/attachment?${params.toString()}`;
}

function renderLinkedText(text: string) {
  const parts = text.split(linkPattern);
  return parts.map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
    const href = part.replace(/[.,;:!?]+$/, "");
    const suffix = part.slice(href.length);
    return (
      <Fragment key={`${part}-${index}`}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="mail-inline-link">
          {href}
        </a>
        {suffix}
      </Fragment>
    );
  });
}

function fileToComposeAttachment(file: File): Promise<ComposeAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const content = result.includes(",") ? result.split(",").pop() ?? "" : result;
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        content,
      });
    };
    reader.readAsDataURL(file);
  });
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
            className={`mail-body-line ${
              quoted || depth > 0 || isQuoteIntro(line) ? "mail-body-line--quoted" : "mail-body-line--current"
            }`}
            style={depth > 1 ? { marginLeft: `${Math.min(depth - 1, 5) * 14}px` } : undefined}
          >
            {renderLinkedText(content)}
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
    <div className="mail-text-body space-y-3 font-sans">
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
            className="inline-flex min-h-9 items-center rounded-full px-0 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {quotesExpanded ? "Nascondi" : `Mostra di più da ${quoteSender}`}
          </button>

          {quotesExpanded && (
            <blockquote
              id={quoteRegionId}
              className="mail-quote-block m-0 space-y-1 border-l-2 border-stone-300/80 pl-4 text-foreground/62"
            >
              <MailTextLines lines={quotedLines} quoted />
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}

function MailAttachments({
  message,
  onOpen,
}: {
  message: MailMessage;
  onOpen: (message: MailMessage, attachment: MailAttachment) => void;
}) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) return null;

  return (
    <div className="mail-attachments" aria-label="Allegati email">
      <div className="mail-attachments__header">
        <Paperclip size={15} />
        <span>
          {attachments.length} {attachments.length === 1 ? "allegato" : "allegati"}
        </span>
      </div>
      <div className="mail-attachments__grid">
        {attachments.map((attachment, index) => {
          const name = attachmentName(attachment);
          const type = attachmentContentType(attachment);
          const href = attachmentDownloadHref(message, attachment);
          const isImage = isImageAttachment(attachment);
          const freshDownloadUrl = attachmentUrlIsFresh(attachment) ? attachment.download_url : "";
          return (
            <button
              key={`${attachment.id ?? name}-${index}`}
              type="button"
              className="mail-attachment-card"
              onClick={() => onOpen(message, attachment)}
              disabled={!href}
              title={href ? `Apri ${name}` : `Download non disponibile per ${name}`}
            >
              {isImage && freshDownloadUrl ? (
                <img className="mail-attachment-card__preview" src={freshDownloadUrl} alt="" loading="lazy" />
              ) : (
                <span className="mail-attachment-card__icon">
                  <FileText size={18} />
                </span>
              )}
              <span className="mail-attachment-card__body">
                <span className="mail-attachment-card__name">{name}</span>
                <span className="mail-attachment-card__meta">
                  {[type, formatBytes(attachment.size)].filter(Boolean).join(" · ") || "Allegato"}
                </span>
              </span>
              <Download size={15} className="mail-attachment-card__download" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const AdminMail = () => {
  const { session, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMessageId = searchParams.get("message");
  const [view, setView] = useState<MailView>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<MailboxResponse["counts"]>({});
  const [fromOptions, setFromOptions] = useState<FromOption[]>(fallbackFromOptions);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<ComposeAttachment[]>([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
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
    setComposeAttachments([]);
    setComposeOpen(true);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("compose");
    nextSearchParams.delete("to");
    nextSearchParams.delete("subject");
    setSearchParams(nextSearchParams, { replace: true });
  }, [fromOptions, searchParams, setSearchParams]);

  const selectedMessage = useMemo(() => {
    const explicitSelection = messages.find((message) => message.id === selectedId) ?? null;
    return explicitSelection ?? (isMobile ? null : messages[0] ?? null);
  }, [isMobile, messages, selectedId]);
  const selectedThreadMessages = useMemo(() => {
    const thread = selectedMessage?.thread_messages?.length ? selectedMessage.thread_messages : selectedMessage ? [selectedMessage] : [];
    return [...thread].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [selectedMessage]);
  const isMobileMessageOpen = isMobile && !!selectedMessage;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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

  const openAttachment = useCallback(
    async (message: MailMessage, attachment: MailAttachment) => {
      const directUrl = attachmentUrlIsFresh(attachment) ? attachment.download_url : "";
      if (directUrl) {
        window.open(directUrl, "_blank", "noopener,noreferrer");
        return;
      }

      if (!message.resend_email_id || !attachment.id) {
        toast.error("Download allegato non disponibile.");
        return;
      }

      try {
        const headers = await authHeaders();
        const params = new URLSearchParams({ messageId: message.id, attachmentId: attachment.id });
        const response = await fetch(`/api/email/attachment?${params.toString()}`, { headers, cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as { downloadUrl?: string };
        if (!data.downloadUrl) throw new Error("missing_download_url");
        window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        console.error("[AdminMail] attachment open failed", error);
        toast.error("Impossibile aprire l'allegato.");
      }
    },
    [authHeaders],
  );

  const loadMailbox = useCallback(
    async (options?: { background?: boolean }) => {
      if (!session?.access_token) return;
      const background = options?.background ?? false;
      // Only the very first load ever blocks the list with "Caricamento mail...".
      // Every later refresh (poll, manual refresh, view/search change) fetches
      // behind the scenes and swaps data in once ready, so the list stays put.
      if (!hasLoadedRef.current) setLoading(true);
      setRefreshing(true);
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
        hasLoadedRef.current = true;

        setMessages((prev) => {
          if (!background) return data.messages;
          // Background refresh (poll/manual refresh): don't yank the message the
          // user currently has open just because it fell out of this view's filter
          // (e.g. it was marked read while the "unread" view is showing).
          const openId = selectedIdRef.current;
          if (!openId || data.messages.some((message) => message.id === openId)) return data.messages;
          const stillOpen = prev.find((message) => message.id === openId);
          return stillOpen ? [stillOpen, ...data.messages] : data.messages;
        });
        setCounts(data.counts ?? {});
        setFromOptions(data.fromOptions?.length ? data.fromOptions : fallbackFromOptions);
        setSelectedId((current) => {
          if (requestedMessageId && data.messages.some((message) => message.id === requestedMessageId)) return requestedMessageId;
          if (background && current) return current;
          if (current && data.messages.some((message) => message.id === current)) return current;
          return isMobile ? null : data.messages[0]?.id ?? null;
        });
      } catch (error) {
        console.error("[AdminMail] load failed", error);
        toast.error("Impossibile caricare la casella mail.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authHeaders, isMobile, navigate, requestedMessageId, searchQuery, session?.access_token, view],
  );

  const clearSelectedMessage = useCallback(() => {
    setSelectedId(null);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("message");
    setSearchParams(nextSearchParams, { replace: true });
    // Only now does a just-read message actually drop off an "unread" list.
    void loadMailbox({ background: true });
  }, [loadMailbox, searchParams, setSearchParams]);

  const markMessageRead = useCallback(
    (id: string) => {
      setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, read: true } : message)));
      setCounts((prev) => (typeof prev.unread === "number" ? { ...prev, unread: Math.max(0, prev.unread - 1) } : prev));
      void (async () => {
        try {
          const headers = await authHeaders();
          const response = await fetch("/api/email/message", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ id, action: "read" }),
          });
          if (!response.ok) throw new Error(await response.text());
        } catch (error) {
          console.error("[AdminMail] mark read failed", error);
        }
      })();
    },
    [authHeaders],
  );

  // Polling + refresh on focus, entirely in the background: the list never
  // hides behind a loading state while looking for new mail.
  useEffect(() => {
    if (authLoading || !session) return;
    const tick = () => void loadMailbox({ background: true });
    const interval = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
    };
  }, [authLoading, session, loadMailbox]);

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

  const openReply = (message: MailMessage, includeAll = false) => {
    const ownAddresses = new Set(fromOptions.map((option) => extractEmailAddress(option.from)));
    const ccAddresses = includeAll
      ? uniqueAddresses([...(message.to_addresses ?? []), ...(message.cc_addresses ?? [])]).filter((address) => {
          const key = extractEmailAddress(address);
          return key !== extractEmailAddress(message.from_address) && !ownAddresses.has(key);
        })
      : [];

    setCompose({
      fromOptionId: fromOptions.find((option) => option.brand === "bite_ordinary")?.id ?? fromOptions[0]?.id ?? "hello",
      to: message.from_address,
      cc: ccAddresses.join(", "),
      bcc: "",
      subject: message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`,
      body: "",
      replyToMessageId: message.id,
    });
    setShowCcBcc(includeAll && ccAddresses.length > 0);
    setComposeAttachments([]);
    setComposeOpen(true);
  };

  const addComposeFiles = useCallback(
    async (files: FileList | File[]) => {
      const nextFiles = Array.from(files);
      if (nextFiles.length === 0) return;

      const currentBytes = composeAttachments.reduce((sum, attachment) => sum + attachment.size, 0);
      const nextBytes = nextFiles.reduce((sum, file) => sum + file.size, currentBytes);
      if (nextBytes > MAX_COMPOSE_ATTACHMENT_BYTES) {
        toast.error(`Allegati troppo pesanti. Limite totale ${formatBytes(MAX_COMPOSE_ATTACHMENT_BYTES)}.`);
        return;
      }

      try {
        const converted = await Promise.all(nextFiles.map(fileToComposeAttachment));
        setComposeAttachments((current) => [...current, ...converted]);
      } catch (error) {
        console.error("[AdminMail] attachment read failed", error);
        toast.error("Impossibile leggere uno degli allegati.");
      }
    },
    [composeAttachments],
  );

  const removeComposeAttachment = (id: string) => {
    setComposeAttachments((current) => current.filter((attachment) => attachment.id !== id));
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
          attachments: composeAttachments.map(({ filename, content, contentType, size }) => ({
            filename,
            content,
            contentType,
            size,
          })),
          replyToMessageId: compose.replyToMessageId,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Email inviata.");
      setCompose({ fromOptionId: compose.fromOptionId, to: "", cc: "", bcc: "", subject: "", body: "", replyToMessageId: null });
      setShowCcBcc(false);
      setComposeAttachments([]);
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
    <div className="min-h-screen px-4 pb-16 pt-[5.5rem] sm:px-6 md:px-10 lg:pt-24 xl:px-12">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <section className={`glass-panel rounded-[26px] px-5 py-4 md:px-6 ${isMobileMessageOpen ? "hidden md:block" : ""}`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <Link to="/admin" className="inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground">
                <ArrowLeft size={16} />
                Torna alla Dashboard
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
                onClick={() => void loadMailbox({ background: true })}
                className="glass-chip inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 text-sm font-sans text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={16} className={loading || refreshing ? "animate-spin" : undefined} />
                Aggiorna
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompose((current) => ({ ...current, to: "", cc: "", bcc: "", subject: "", body: "", replyToMessageId: null }));
                  setShowCcBcc(false);
                  setComposeAttachments([]);
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

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[248px_minmax(0,1fr)] xl:gap-6">
          <aside className={`glass-panel rounded-[30px] p-4 h-fit ${isMobileMessageOpen ? "hidden md:block" : ""}`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {viewOptions.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                const count = item.id === "unread" ? counts.unread : item.id === "sent" ? counts.sent : item.id === "inbox" ? counts.inbox : undefined;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setView(item.id);
                      if (isMobile) clearSelectedMessage();
                    }}
                    className={`w-full rounded-[20px] px-3 py-3 text-left transition-colors sm:px-4 ${
                      active ? "bg-white/85 border border-stone-200/90" : "glass-panel-soft hover:border-accent"
                    }`}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span className="inline-flex min-w-0 items-center gap-2.5">
                        <Icon size={15} className={active ? "text-accent" : "text-muted-foreground"} />
                        <span className="truncate text-sm font-sans text-foreground">{item.label}</span>
                      </span>
                      {typeof count === "number" && <span className="text-xs font-sans text-muted-foreground">{count}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="mail-workspace glass-panel rounded-[30px] overflow-hidden">
            <div className="grid min-h-[min(720px,calc(100dvh-13rem))] grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
              <div className={`border-b border-stone-200/70 lg:border-b-0 lg:border-r ${isMobileMessageOpen ? "hidden md:block" : ""}`}>
                {loading ? (
                  <div className="p-6 text-sm text-muted-foreground">Caricamento mail...</div>
                ) : messages.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    {searchQuery ? "Nessuna mail trovata per questa ricerca." : "Nessun messaggio in questa vista."}
                  </div>
                ) : (
                  <div className="mail-list-scroll max-h-[48dvh] overflow-y-auto lg:max-h-[min(720px,calc(100dvh-13rem))]">
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
                            if (isMobile) window.scrollTo({ top: 0, behavior: "auto" });
                            if (view !== "sent" && !message.read) markMessageRead(message.id);
                          }}
                          className={`mail-list-item block w-full border-b border-stone-200/60 px-4 py-4 text-left transition-colors sm:px-5 ${
                            selected ? "bg-white/85" : "bg-white/25 hover:bg-white/60"
                          }`}
                        >
                          <span className="mb-1.5 flex items-start justify-between gap-3">
                            <span className={`min-w-0 flex-1 truncate text-[15px] font-sans leading-snug ${message.read || view === "sent" ? "text-foreground/82" : "font-semibold text-foreground"}`}>
                              {sender}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(message.created_at)}</span>
                          </span>
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-sans font-medium text-foreground">
                            {message.subject || "(nessun oggetto)"}
                          </span>
                          <span className="mail-list-preview mt-2 text-[13px] leading-5 text-muted-foreground">
                            {preview || "Messaggio senza anteprima."}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <article
                className={`mail-detail min-w-0 overflow-y-auto p-4 sm:p-5 md:p-7 ${
                  !selectedMessage && isMobile ? "hidden md:block" : ""
                } ${isMobileMessageOpen ? "mail-detail--mobile-open" : ""}`}
              >
                {!selectedMessage ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Seleziona una mail</div>
                ) : (
                  <div className="space-y-6">
                    {isMobileMessageOpen && (
                      <div className="mail-mobile-toolbar md:hidden">
                        <button
                          type="button"
                          onClick={clearSelectedMessage}
                          className="mail-mobile-toolbar__back"
                          aria-label="Torna all'elenco mail"
                        >
                          <ArrowLeft size={17} />
                          Elenco
                        </button>
                        {view !== "sent" && selectedMessage.source !== "sent" && (
                          <div className="mail-mobile-toolbar__actions">
                            <button
                              type="button"
                              className="mail-mobile-toolbar__button"
                              title="Rispondi"
                              aria-label="Rispondi"
                              onClick={() => openReply(selectedMessage)}
                            >
                              <Reply size={16} />
                            </button>
                            <button
                              type="button"
                              className="mail-mobile-toolbar__button"
                              title="Rispondi a tutti"
                              aria-label="Rispondi a tutti"
                              onClick={() => openReply(selectedMessage, true)}
                            >
                              <ReplyAll size={16} />
                            </button>
                            <button
                              type="button"
                              className="mail-mobile-toolbar__button"
                              title="Preferita"
                              aria-label="Preferita"
                              onClick={() => void runAction(selectedMessage.id, selectedMessage.starred ? "unstar" : "star")}
                            >
                              <Star size={16} className={selectedMessage.starred ? "fill-current text-accent" : undefined} />
                            </button>
                            <button
                              type="button"
                              className="mail-mobile-toolbar__button"
                              title="Archivia"
                              aria-label="Archivia"
                              onClick={() => void runAction(selectedMessage.id, selectedMessage.archived ? "restore" : "archive")}
                            >
                              <Archive size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mail-detail-header flex flex-col gap-4 border-b border-stone-200/70 pb-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <h2 className="mail-subject editorial-heading text-[2rem] leading-[1.05] md:text-[2.5rem]">
                          {selectedMessage.subject || "(nessun oggetto)"}
                        </h2>
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
                        <div className="hidden flex-wrap gap-2 md:flex">
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Rispondi" onClick={() => openReply(selectedMessage)}>
                            <Reply size={15} />
                          </button>
                          <button className="glass-chip inline-flex h-10 w-10 items-center justify-center" title="Rispondi a tutti" onClick={() => openReply(selectedMessage, true)}>
                            <ReplyAll size={15} />
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

                    <div className="mail-reader space-y-4">
                      {selectedThreadMessages.map((message) => {
                        const isSent = message.source === "sent";
                        return (
                          <section
                            key={`${message.source ?? "inbound"}-${message.id}`}
                            className={`mail-message-card rounded-[22px] border px-4 py-4 sm:px-5 md:px-6 md:py-5 ${
                              isSent ? "border-teal-100/80 bg-teal-50/55" : "border-stone-200/75 bg-white/72"
                            }`}
                          >
                            <div className="mb-4 flex flex-col gap-1 border-b border-stone-200/60 pb-3 font-sans text-sm sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="break-words font-medium text-foreground">
                                  {isSent ? `A ${message.to_addresses.join(", ")}` : mailDisplaySender(message)}
                                </p>
                                {!isSent && message.from_name?.trim() && message.from_address !== message.from_name && (
                                  <p className="break-words text-xs text-muted-foreground">{message.from_address}</p>
                                )}
                              </div>
                              <p className="shrink-0 text-xs text-muted-foreground">{formatDate(message.created_at)}</p>
                            </div>
                            <div className="mail-body prose prose-stone max-w-none">
                              {message.html_body?.trim() ? (
                                <div className="mail-html-body" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(message.html_body) }} />
                              ) : message.text_body?.trim() ? (
                                <MailTextBody text={message.text_body} />
                              ) : (
                                <p>Messaggio senza corpo.</p>
                              )}
                            </div>
                            <MailAttachments message={message} onOpen={openAttachment} />
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
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/20 p-4 backdrop-blur-sm md:p-8"
          onDragOver={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes("Files")) setDraggingAttachments(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDraggingAttachments(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingAttachments(false);
            void addComposeFiles(event.dataTransfer.files);
          }}
        >
          <div className={`glass-panel w-full max-w-2xl rounded-[30px] p-5 md:p-6 ${draggingAttachments ? "mail-compose--dragging" : ""}`}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  {compose.replyToMessageId ? "Risposta" : "Nuovo messaggio"}
                </p>
                <h2 className="editorial-heading text-3xl">{compose.replyToMessageId ? "Rispondi" : "Scrivi mail"}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(false);
                  setDraggingAttachments(false);
                }}
                className="glass-chip px-3 py-2 text-sm"
              >
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
              <div className="mail-compose-attachments">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files) void addComposeFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="mail-compose-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={16} />
                  <span>
                    Aggiungi allegati
                    <span className="mail-compose-dropzone__hint"> o trascina file qui su desktop</span>
                  </span>
                  <span className="mail-compose-dropzone__limit">max {formatBytes(MAX_COMPOSE_ATTACHMENT_BYTES)}</span>
                </button>
                {composeAttachments.length > 0 && (
                  <div className="mail-compose-attachments__list">
                    {composeAttachments.map((attachment) => (
                      <div key={attachment.id} className="mail-compose-attachment">
                        <FileText size={15} />
                        <span className="mail-compose-attachment__name">{attachment.filename}</span>
                        <span className="mail-compose-attachment__size">{formatBytes(attachment.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeComposeAttachment(attachment.id)}
                          className="mail-compose-attachment__remove"
                          aria-label={`Rimuovi ${attachment.filename}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
