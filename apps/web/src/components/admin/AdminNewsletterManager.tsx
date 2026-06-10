/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  Eye,
  Globe2,
  ImagePlus,
  Layers3,
  Link2,
  Mail,
  MousePointerClick,
  Pause,
  PenSquare,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { ALL_LANGUAGES, type ExtendedLanguage } from "@/lib/i18n";
import {
  NEWSLETTER_MERGE_TAGS,
  normalizeOptionalSelectResult,
  type NewsletterBodyMode,
  buildNewsletterPreviewVariables,
  renderNewsletterMergeTags,
} from "@/lib/newsletter";

type NewsletterKind = "campaign" | "automation";
type AutomationTrigger = "subscribed" | "unsubscribed";
type ComposerTab = "overview" | "campaigns" | "automations" | "editor";

type TranslationStringMap = Record<ExtendedLanguage, string>;
type TranslationJsonMap = Record<ExtendedLanguage, Json | null>;
type TranslationBodyModeMap = Record<ExtendedLanguage, NewsletterBodyMode>;

type NewsletterMessage = {
  id: string;
  name: string;
  kind: NewsletterKind;
  status: string;
  from_name: string | null;
  scheduled_at: string | null;
  automation_trigger: AutomationTrigger | null;
  automation_delay_minutes: number | null;
  subject_translations: Json;
  preheader_translations: Json;
  body_html_translations: Json;
  body_json_translations: Json;
  body_mode_translations: Json;
  updated_at?: string | null;
};

type NewsletterDelivery = {
  id: string;
  newsletter_message_id: string | null;
  status: string;
  open_count: number;
  click_count: number;
  queued_at: string;
};

type NewsletterEvent = {
  id: string;
  email: string;
  event_type: string;
  occurred_at: string;
  processed_at: string | null;
};

type NewsletterUnsubscribeFeedback = {
  id: string;
  email: string;
  reason_code: string | null;
  reason_text: string | null;
  source: string | null;
  created_at: string;
  unsubscribe_scope: {
    newsletter_enabled?: boolean;
    digest_enabled?: boolean;
    story_notifications_enabled?: boolean;
  } | null;
};

type SystemEmailAutomation = {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at?: string | null;
  last_sent_at?: string | null;
};

type NewsletterSubscriber = Database["public"]["Tables"]["newsletter_subscribers"]["Row"] & {
  preferred_language?: string | null;
  source?: string | null;
};

interface UploadedNewsletterAsset {
  name: string;
  url: string;
  kind: "image" | "file";
}

interface NewsletterFormState {
  id: string | null;
  name: string;
  kind: NewsletterKind;
  fromName: string;
  scheduledAt: string;
  automationTrigger: AutomationTrigger;
  automationDelayMinutes: number;
  automationActive: boolean;
  subjectTranslations: TranslationStringMap;
  preheaderTranslations: TranslationStringMap;
  bodyHtmlTranslations: TranslationStringMap;
  bodyJsonTranslations: TranslationJsonMap;
  bodyModeTranslations: TranslationBodyModeMap;
}

const languageCodes = ALL_LANGUAGES.map((language) => language.code);
const requiredLanguages: ExtendedLanguage[] = ["it", "en"];
const optionalLanguages = ALL_LANGUAGES.filter(
  (language) => !requiredLanguages.includes(language.code)
);

const createEmptyStringTranslations = (): TranslationStringMap =>
  Object.fromEntries(languageCodes.map((code) => [code, ""])) as TranslationStringMap;

const createEmptyJsonTranslations = (): TranslationJsonMap =>
  Object.fromEntries(languageCodes.map((code) => [code, null])) as TranslationJsonMap;

const createEmptyBodyModes = (): TranslationBodyModeMap =>
  Object.fromEntries(languageCodes.map((code) => [code, "richtext"])) as TranslationBodyModeMap;

const emptyFormState = (): NewsletterFormState => ({
  id: null,
  name: "",
  kind: "campaign",
  fromName: "BITE",
  scheduledAt: "",
  automationTrigger: "subscribed",
  automationDelayMinutes: 0,
  automationActive: true,
  subjectTranslations: createEmptyStringTranslations(),
  preheaderTranslations: createEmptyStringTranslations(),
  bodyHtmlTranslations: createEmptyStringTranslations(),
  bodyJsonTranslations: createEmptyJsonTranslations(),
  bodyModeTranslations: createEmptyBodyModes(),
});

const parseStringTranslations = (value: Json): TranslationStringMap => {
  const next = createEmptyStringTranslations();
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;

  for (const code of languageCodes) {
    const maybeValue = (value as Record<string, unknown>)[code];
    if (typeof maybeValue === "string") next[code] = maybeValue;
  }

  return next;
};

const parseJsonTranslations = (value: Json): TranslationJsonMap => {
  const next = createEmptyJsonTranslations();
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;

  for (const code of languageCodes) {
    const maybeValue = (value as Record<string, Json | null>)[code];
    if (maybeValue) next[code] = maybeValue;
  }

  return next;
};

const parseBodyModes = (
  value: Json,
  bodyJsonTranslations: TranslationJsonMap,
  bodyHtmlTranslations: TranslationStringMap
): TranslationBodyModeMap => {
  const next = createEmptyBodyModes();

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const code of languageCodes) {
      const maybeValue = (value as Record<string, unknown>)[code];
      if (maybeValue === "html" || maybeValue === "richtext") {
        next[code] = maybeValue;
      }
    }
  }

  for (const code of languageCodes) {
    if (next[code] === "richtext" && !bodyJsonTranslations[code] && bodyHtmlTranslations[code].trim()) {
      next[code] = "html";
    }
  }

  return next;
};

const compactStringTranslations = (value: TranslationStringMap) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry.trim().length > 0));

const compactJsonTranslations = (value: TranslationJsonMap) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => Boolean(entry)));

const getLanguageLabel = (language: ExtendedLanguage) =>
  ALL_LANGUAGES.find((entry) => entry.code === language)?.label ?? language.toUpperCase();

const formatDateTimeLocal = (value: string | null) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";

const getCampaignStatusLabel = (status: string) => {
  if (status === "scheduled") return "Programmato";
  if (status === "sent") return "Inviato";
  if (status === "sending") return "In coda";
  return "Bozza";
};

const getAutomationStatusLabel = (status: string) =>
  status === "active" ? "Attiva" : "Pausa";

const getReadableEvent = (eventType: string) =>
  eventType === "subscribed" ? "Iscrizione" : "Disiscrizione";

const resolvePreviewValue = (
  values: TranslationStringMap,
  selectedLanguage: ExtendedLanguage
) =>
  values[selectedLanguage] ||
  values.it ||
  values.en ||
  Object.values(values).find(Boolean) ||
  "";

const hasJsonValue = (value: Json | null) =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);

const hasBodyForLanguage = (
  bodyHtmlTranslations: TranslationStringMap,
  bodyJsonTranslations: TranslationJsonMap,
  language: ExtendedLanguage
) =>
  bodyHtmlTranslations[language].trim().length > 0 || hasJsonValue(bodyJsonTranslations[language]);

const MetricCard = ({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) => (
  <div className="glass-panel-soft rounded-[28px] border border-border/70 p-5">
    <div className="mb-4 flex items-center justify-between">
      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground">
        {label}
      </p>
      <span className="text-muted-foreground">{icon}</span>
    </div>
    <p className="editorial-heading text-3xl">{value}</p>
    <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
  </div>
);

const StatusPill = ({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-sans uppercase tracking-[0.2em] ${
      ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700"
    }`}
  >
    {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
    {label}
  </span>
);

const defaultSystemAutomations: Record<string, SystemEmailAutomation> = {
  "newsletter-confirmation": {
    key: "newsletter-confirmation",
    enabled: true,
    config: {
      resend_cooldown_minutes: 15,
      token_ttl_hours: 72,
    },
    last_run_at: null,
    last_sent_at: null,
  },
  "newsletter-welcome": {
    key: "newsletter-welcome",
    enabled: true,
    config: {},
    last_run_at: null,
    last_sent_at: null,
  },
  "newsletter-weekly-digest": {
    key: "newsletter-weekly-digest",
    enabled: true,
    config: {
      timezone: "Europe/Rome",
      weekday: 2,
      hour_local: 7,
      minute_local: 0,
    },
    last_run_at: null,
    last_sent_at: null,
  },
  "story-new-article-notification": {
    key: "story-new-article-notification",
    enabled: true,
    config: {},
    last_run_at: null,
    last_sent_at: null,
  },
};

const AdminNewsletterManager = () => {
  const [tab, setTab] = useState<ComposerTab>("overview");
  const [messages, setMessages] = useState<NewsletterMessage[]>([]);
  const [deliveries, setDeliveries] = useState<NewsletterDelivery[]>([]);
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([]);
  const [events, setEvents] = useState<NewsletterEvent[]>([]);
  const [unsubscribeFeedback, setUnsubscribeFeedback] = useState<NewsletterUnsubscribeFeedback[]>([]);
  const [systemAutomations, setSystemAutomations] = useState<SystemEmailAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<ExtendedLanguage>("it");
  const [showOptionalLanguages, setShowOptionalLanguages] = useState(false);
  const [form, setForm] = useState<NewsletterFormState>(emptyFormState);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedNewsletterAsset[]>([]);
  const [uploadingAssets, setUploadingAssets] = useState(false);

  const fetchNewsletterData = async (withLoader = false) => {
    if (withLoader) setLoading(true);
    setRefreshing(true);

    const [
      rawMessagesRes,
      rawDeliveriesRes,
      subscribersRes,
      rawEventsRes,
      rawFeedbackRes,
      rawSystemAutomationsRes,
    ] =
      await Promise.all([
        (supabase as any).from("newsletter_messages").select("*").order("updated_at", { ascending: false }),
        (supabase as any)
          .from("newsletter_deliveries")
          .select("id, newsletter_message_id, status, open_count, click_count, queued_at")
          .order("queued_at", { ascending: false })
          .limit(300),
        supabase
          .from("newsletter_subscribers")
          .select("id, email, subscribed, profile_id, created_at, updated_at")
          .order("updated_at", { ascending: false }),
        (supabase as any)
          .from("newsletter_events")
          .select("id, email, event_type, occurred_at, processed_at")
          .order("occurred_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("newsletter_unsubscribe_feedback")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any).from("system_email_automations").select("*").order("key", { ascending: true }),
      ]);

    const messagesRes = normalizeOptionalSelectResult<NewsletterMessage>(rawMessagesRes);
    const deliveriesRes = normalizeOptionalSelectResult<NewsletterDelivery>(rawDeliveriesRes);
    const eventsRes = normalizeOptionalSelectResult<NewsletterEvent>(rawEventsRes);
    const feedbackRes = normalizeOptionalSelectResult<NewsletterUnsubscribeFeedback>(rawFeedbackRes);
    const systemAutomationsRes = normalizeOptionalSelectResult<SystemEmailAutomation>(rawSystemAutomationsRes);

    if (
      messagesRes.error ||
      deliveriesRes.error ||
      subscribersRes.error ||
      eventsRes.error ||
      feedbackRes.error ||
      systemAutomationsRes.error
    ) {
      console.error("Newsletter dashboard load failed", {
        messages: messagesRes.error,
        deliveries: deliveriesRes.error,
        subscribers: subscribersRes.error,
        events: eventsRes.error,
        feedback: feedbackRes.error,
        systemAutomations: systemAutomationsRes.error,
      });
      toast.error("Impossibile caricare i dati newsletter.");
    } else {
      setMessages(messagesRes.data);
      setDeliveries(deliveriesRes.data);
      setSubscribers((subscribersRes.data ?? []) as NewsletterSubscriber[]);
      setEvents(eventsRes.data);
      setUnsubscribeFeedback(feedbackRes.data);

      const rows = systemAutomationsRes.data;
      const merged = Object.values(defaultSystemAutomations).map((automation) => {
        const override = rows.find((row) => row.key === automation.key);
        return override
          ? { ...automation, ...override, config: { ...automation.config, ...(override.config || {}) } }
          : automation;
      });
      setSystemAutomations(merged);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    void fetchNewsletterData(true);
  }, []);

  const campaignMessages = useMemo(
    () => messages.filter((message) => message.kind === "campaign"),
    [messages]
  );
  const automationMessages = useMemo(
    () => messages.filter((message) => message.kind === "automation"),
    [messages]
  );

  const stats = useMemo(() => {
    const activeSubscribers = subscribers.filter((subscriber) => subscriber.subscribed);
    const sentDeliveries = deliveries.filter((delivery) => ["sent", "opened", "clicked"].includes(delivery.status));
    const openedDeliveries = deliveries.filter((delivery) => delivery.open_count > 0);
    const clickedDeliveries = deliveries.filter((delivery) => delivery.click_count > 0);

    return {
      totalSubscribers: activeSubscribers.length,
      totalUnsubscribed: subscribers.filter((subscriber) => !subscriber.subscribed).length,
      totalDrafts: campaignMessages.filter((message) => message.status === "draft").length,
      totalSent: sentDeliveries.length,
      openRate: sentDeliveries.length ? Math.round((openedDeliveries.length / sentDeliveries.length) * 100) : 0,
      clickRate: sentDeliveries.length ? Math.round((clickedDeliveries.length / sentDeliveries.length) * 100) : 0,
      waitingAutomations: events.filter((event) => !event.processed_at).length,
      unsubscribeFeedbackCount: unsubscribeFeedback.length,
    };
  }, [campaignMessages, deliveries, events, subscribers, unsubscribeFeedback]);

  const unsubscribeReasonSummary = useMemo(() => {
    const labels: Record<string, string> = {
      too_many_emails: "Troppe email",
      content_not_relevant: "Contenuti poco rilevanti",
      prefer_social: "Preferisce social",
      temporary_pause: "Pausa",
      signed_up_by_mistake: "Iscrizione per errore",
      mailbox_one_click: "One-click mailbox",
      mailbox_provider_unsubscribe: "Unsubscribe provider",
      other: "Altro",
    };

    return Object.entries(
      unsubscribeFeedback.reduce<Record<string, number>>((accumulator, item) => {
        const key = item.reason_code || "other";
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
      }, {})
    )
      .map(([key, count]) => ({ key, count, label: labels[key] || key }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
  }, [unsubscribeFeedback]);

  const updateSystemAutomation = async (
    key: string,
    updater: (current: SystemEmailAutomation) => SystemEmailAutomation
  ) => {
    const current = systemAutomations.find((automation) => automation.key === key);
    if (!current) return;

    const next = updater(current);
    setSystemAutomations((items) => items.map((item) => (item.key === key ? next : item)));

    const { error } = await (supabase as any).from("system_email_automations").upsert({
      key: next.key,
      enabled: next.enabled,
      config: next.config,
      last_run_at: next.last_run_at ?? null,
      last_sent_at: next.last_sent_at ?? null,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("System automation update failed", error);
      toast.error("Impossibile aggiornare l'automazione di sistema.");
      await fetchNewsletterData();
      return;
    }

    toast.success("Automazione di sistema aggiornata.");
  };

  const populateForm = (message?: NewsletterMessage) => {
    if (!message) {
      setForm(emptyFormState());
      setSelectedLanguage("it");
      setUploadedAssets([]);
      setShowOptionalLanguages(false);
      return;
    }

    const bodyJsonTranslations = parseJsonTranslations(message.body_json_translations);
    const bodyHtmlTranslations = parseStringTranslations(message.body_html_translations);

    setForm({
      id: message.id,
      name: message.name,
      kind: message.kind,
      fromName: message.from_name || "BITE",
      scheduledAt: formatDateTimeLocal(message.scheduled_at),
      automationTrigger: message.automation_trigger || "subscribed",
      automationDelayMinutes: message.automation_delay_minutes ?? 0,
      automationActive: message.status === "active",
      subjectTranslations: parseStringTranslations(message.subject_translations),
      preheaderTranslations: parseStringTranslations(message.preheader_translations),
      bodyHtmlTranslations,
      bodyJsonTranslations,
      bodyModeTranslations: parseBodyModes(
        message.body_mode_translations,
        bodyJsonTranslations,
        bodyHtmlTranslations
      ),
    });
    setSelectedLanguage("it");
    setUploadedAssets([]);
  };

  const openComposer = (message?: NewsletterMessage, nextKind?: NewsletterKind) => {
    populateForm(message);
    if (!message && nextKind) {
      setForm((prev) => ({ ...prev, kind: nextKind }));
    }
    setTab("editor");
  };

  const updateSubject = (language: ExtendedLanguage, value: string) => {
    setForm((prev) => ({
      ...prev,
      subjectTranslations: { ...prev.subjectTranslations, [language]: value },
    }));
  };

  const updatePreheader = (language: ExtendedLanguage, value: string) => {
    setForm((prev) => ({
      ...prev,
      preheaderTranslations: { ...prev.preheaderTranslations, [language]: value },
    }));
  };

  const updateBodyHtml = (language: ExtendedLanguage, value: string) => {
    setForm((prev) => ({
      ...prev,
      bodyHtmlTranslations: { ...prev.bodyHtmlTranslations, [language]: value },
    }));
  };

  const updateBodyJson = (language: ExtendedLanguage, value: Json | null) => {
    setForm((prev) => ({
      ...prev,
      bodyJsonTranslations: { ...prev.bodyJsonTranslations, [language]: value },
    }));
  };

  const setBodyMode = (language: ExtendedLanguage, mode: NewsletterBodyMode) => {
    if (mode === form.bodyModeTranslations[language]) return;

    if (
      mode === "richtext" &&
      !form.bodyJsonTranslations[language] &&
      form.bodyHtmlTranslations[language].trim()
    ) {
      toast.message(`Passaggio a rich text (${language.toUpperCase()})`, {
        description:
          "L'HTML esistente resta salvato, ma non viene convertito automaticamente in blocchi TipTap.",
      });
    }

    setForm((prev) => ({
      ...prev,
      bodyModeTranslations: { ...prev.bodyModeTranslations, [language]: mode },
    }));
  };

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      console.error("Clipboard copy failed", error);
      toast.error("Copia negli appunti non riuscita.");
    }
  };

  const appendHtmlSnippet = (language: ExtendedLanguage, snippet: string) => {
    setForm((prev) => ({
      ...prev,
      bodyHtmlTranslations: {
        ...prev.bodyHtmlTranslations,
        [language]: `${prev.bodyHtmlTranslations[language] || ""}\n${snippet}`.trim(),
      },
      bodyModeTranslations: {
        ...prev.bodyModeTranslations,
        [language]: "html",
      },
    }));
  };

  const handleAssetUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setUploadingAssets(true);
    const nextAssets: UploadedNewsletterAsset[] = [];

    for (const file of files) {
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
      const path = `newsletters/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
      const { error } = await supabase.storage.from("logbook-media").upload(path, file, {
        contentType: file.type || undefined,
      });

      if (error) {
        console.error("Newsletter asset upload failed", error);
        toast.error(`Upload fallito per ${file.name}.`);
        continue;
      }

      const { data } = supabase.storage.from("logbook-media").getPublicUrl(path);
      nextAssets.unshift({
        name: file.name,
        url: data.publicUrl,
        kind: file.type.startsWith("image/") ? "image" : "file",
      });
    }

    setUploadingAssets(false);
    event.target.value = "";

    if (nextAssets.length) {
      setUploadedAssets((prev) => [...nextAssets, ...prev]);
      toast.success(nextAssets.length === 1 ? "Asset caricato." : `${nextAssets.length} asset caricati.`);
    }
  };

  const collectMissingRequiredFields = (state: NewsletterFormState) => {
    const missing: string[] = [];
    if (!state.name.trim()) missing.push("nome interno");

    for (const language of requiredLanguages) {
      if (!state.subjectTranslations[language].trim()) {
        missing.push(`subject ${language.toUpperCase()}`);
      }
      if (!hasBodyForLanguage(state.bodyHtmlTranslations, state.bodyJsonTranslations, language)) {
        missing.push(`contenuto ${language.toUpperCase()}`);
      }
    }

    return missing;
  };

  const saveMessage = async () => {
    const missingFields = collectMissingRequiredFields(form);
    if (missingFields.length > 0) {
      toast.error(`Completa i campi richiesti: ${missingFields.join(", ")}.`);
      return;
    }

    if (form.kind === "campaign" && form.scheduledAt && Number.isNaN(new Date(form.scheduledAt).valueOf())) {
      toast.error("La data di schedulazione non è valida.");
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      from_name: form.fromName.trim() || "BITE",
      scheduled_at:
        form.kind === "campaign" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      automation_trigger: form.kind === "automation" ? form.automationTrigger : null,
      automation_delay_minutes: form.kind === "automation" ? form.automationDelayMinutes : 0,
      status:
        form.kind === "campaign"
          ? form.scheduledAt
            ? "scheduled"
            : "draft"
          : form.automationActive
            ? "active"
            : "paused",
      subject_translations: compactStringTranslations(form.subjectTranslations),
      preheader_translations: compactStringTranslations(form.preheaderTranslations),
      body_html_translations: compactStringTranslations(form.bodyHtmlTranslations),
      body_json_translations: compactJsonTranslations(form.bodyJsonTranslations),
      body_mode_translations: form.bodyModeTranslations,
      created_by: user?.id || null,
      updated_at: new Date().toISOString(),
    };

    const mutation = form.id
      ? (supabase as any).from("newsletter_messages").update(payload).eq("id", form.id)
      : (supabase as any).from("newsletter_messages").insert(payload);

    const { error } = await mutation;
    setSaving(false);

    if (error) {
      console.error("Newsletter save failed", error);
      toast.error("Salvataggio fallito.");
      return;
    }

    toast.success(form.id ? "Messaggio aggiornato." : "Messaggio creato.");
    populateForm();
    setTab(form.kind === "automation" ? "automations" : "campaigns");
    await fetchNewsletterData();
  };

  const runDispatch = async (message: NewsletterMessage) => {
    setDispatchingId(message.id);

    const scheduledAt = new Date().toISOString();
    const { error: prepareError } = await (supabase as any)
      .from("newsletter_messages")
      .update({
        status: "scheduled",
        scheduled_at: scheduledAt,
      })
      .eq("id", message.id);

    if (prepareError) {
      console.error("Unable to prepare campaign dispatch", prepareError);
      toast.error("Impossibile mettere in coda la campagna.");
      setDispatchingId(null);
      return;
    }

    const { data, error } = await supabase.functions.invoke("newsletter-dispatch", {
      body: {
        messageId: message.id,
        processEvents: false,
      },
    });

    if (error) {
      console.error("Newsletter dispatch failed", error);
      toast.error("Dispatch fallito.");
    } else {
      toast.success(`Campagna accodata. ${data?.campaignsQueued ?? 0} destinatari in elaborazione.`);
    }

    setDispatchingId(null);
    await fetchNewsletterData();
  };

  const toggleAutomation = async (message: NewsletterMessage) => {
    const nextStatus = message.status === "active" ? "paused" : "active";
    const { error } = await (supabase as any)
      .from("newsletter_messages")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", message.id);

    if (error) {
      console.error("Automation toggle failed", error);
      toast.error("Impossibile aggiornare l'automazione.");
      return;
    }

    toast.success(nextStatus === "active" ? "Automazione attivata." : "Automazione in pausa.");
    await fetchNewsletterData();
  };

  const getMessageMetrics = (messageId: string) => {
    const messageDeliveries = deliveries.filter((delivery) => delivery.newsletter_message_id === messageId);
    const sent = messageDeliveries.filter((delivery) => ["sent", "opened", "clicked"].includes(delivery.status)).length;
    const opened = messageDeliveries.filter((delivery) => delivery.open_count > 0).length;
    const clicked = messageDeliveries.filter((delivery) => delivery.click_count > 0).length;
    const suppressed = messageDeliveries.filter((delivery) => delivery.status === "suppressed").length;

    return {
      total: messageDeliveries.length,
      sent,
      opened,
      clicked,
      suppressed,
    };
  };

  const getMessageReadiness = (message: NewsletterMessage) => {
    const subjectTranslations = parseStringTranslations(message.subject_translations);
    const bodyHtmlTranslations = parseStringTranslations(message.body_html_translations);
    const bodyJsonTranslations = parseJsonTranslations(message.body_json_translations);

    const missing = requiredLanguages.flatMap((language) => {
      const issues: string[] = [];
      if (!subjectTranslations[language].trim()) issues.push(`${language.toUpperCase()} subject`);
      if (!hasBodyForLanguage(bodyHtmlTranslations, bodyJsonTranslations, language)) {
        issues.push(`${language.toUpperCase()} body`);
      }
      return issues;
    });

    return {
      ready: missing.length === 0,
      missing,
    };
  };

  const previewVariables = buildNewsletterPreviewVariables(form.name, selectedLanguage);
  const previewSubject = renderNewsletterMergeTags(
    resolvePreviewValue(form.subjectTranslations, selectedLanguage),
    previewVariables
  );
  const previewPreheader = renderNewsletterMergeTags(
    resolvePreviewValue(form.preheaderTranslations, selectedLanguage),
    previewVariables
  );
  const previewBodyHtml = sanitizeRichHtml(
    renderNewsletterMergeTags(resolvePreviewValue(form.bodyHtmlTranslations, selectedLanguage), previewVariables)
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Caricamento newsletter...</p>;
  }

  const renderLanguageEditor = (
    language: ExtendedLanguage,
    required = false,
    standalone = true
  ) => {
    const selectedBodyMode = form.bodyModeTranslations[language];
    const hasBody = hasBodyForLanguage(form.bodyHtmlTranslations, form.bodyJsonTranslations, language);
    const subjectReady = form.subjectTranslations[language].trim().length > 0;

    return (
      <section key={language} className={standalone ? "rounded-[28px] border border-border/70 bg-background p-5" : ""}>
        {standalone && (
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="editorial-heading text-xl">{getLanguageLabel(language)}</p>
                <StatusPill ok={subjectReady && hasBody} label={required ? "Richiesta" : "Opzionale"} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Subject e contenuto vengono usati per chi ha questa lingua come preferenza o fallback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedLanguage(language)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-sans transition-colors ${
                selectedLanguage === language
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye size={14} /> Anteprima
            </button>
          </div>
        )}

        <div className="grid gap-4">
          <div>
            <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
              Subject ({language.toUpperCase()})
            </label>
            <input
              type="text"
              value={form.subjectTranslations[language]}
              onChange={(event) => updateSubject(language, event.target.value)}
              className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
              placeholder={language === "en" ? "Monthly dispatch from BITE" : "Dispatch mensile di BITE"}
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
              Preheader ({language.toUpperCase()})
            </label>
            <input
              type="text"
              value={form.preheaderTranslations[language]}
              onChange={(event) => updatePreheader(language, event.target.value)}
              className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
              placeholder={language === "en" ? "Short inbox summary" : "Sintesi breve per l'inbox"}
            />
          </div>

          <div className="rounded-[24px] border border-border/70 bg-muted/20 p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                  Corpo Mail
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scrivi in rich text oppure apri la modalità HTML per blocchi custom e snippet.
                </p>
              </div>
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  onClick={() => setBodyMode(language, "richtext")}
                  className={`rounded-full border px-3 py-2 text-sm font-sans transition-colors ${
                    selectedBodyMode === "richtext"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Rich text
                </button>
                <button
                  type="button"
                  onClick={() => setBodyMode(language, "html")}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-sans transition-colors ${
                    selectedBodyMode === "html"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Code2 size={14} /> HTML
                </button>
              </div>
            </div>

            {selectedBodyMode === "html" ? (
              <textarea
                value={form.bodyHtmlTranslations[language]}
                onChange={(event) => updateBodyHtml(language, event.target.value)}
                rows={16}
                className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-mono transition-colors focus:border-accent focus:outline-none"
                placeholder={language === "en" ? "<p>Hello {{first_name}}</p>" : "<p>Ciao {{first_name}}</p>"}
              />
            ) : (
              <RichTextEditor
                content={form.bodyJsonTranslations[language] as object}
                onChange={(content) => updateBodyJson(language, content as unknown as Json)}
                onHtmlChange={(html) => updateBodyHtml(language, html)}
                placeholder={language === "en" ? "Write the email body..." : "Scrivi il contenuto della mail..."}
              />
            )}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-sans uppercase tracking-[0.3em] text-muted-foreground">
            Newsletter Control
          </p>
          <h2 className="editorial-heading text-3xl md:text-4xl">Dashboard newsletter</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            Campagne editoriali, automazioni e audience dentro un’unica interfaccia coerente con il design comune delle mail BITE.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void fetchNewsletterData()}
            className="glass-chip inline-flex h-11 items-center gap-2 px-4 text-sm font-sans text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Aggiorna
          </button>
          <button
            onClick={() => openComposer(undefined, "campaign")}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light"
          >
            <PenSquare size={14} /> Nuova campagna
          </button>
          <button
            onClick={() => openComposer(undefined, "automation")}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-sans text-foreground transition-colors hover:border-foreground"
          >
            <Wand2 size={14} /> Nuova automazione
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { id: "overview", label: "Overview" },
          { id: "campaigns", label: "Campagne" },
          { id: "automations", label: "Automazioni" },
          { id: "editor", label: "Composer" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as ComposerTab)}
            className={`rounded-full border px-4 py-2 text-sm font-sans transition-colors ${
              tab === item.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Iscritti Attivi"
              value={String(stats.totalSubscribers)}
              hint="Subscriber attualmente raggiungibili da campagne newsletter."
              icon={<Mail size={16} />}
            />
            <MetricCard
              label="Invii Tracciati"
              value={String(stats.totalSent)}
              hint="Consegne newsletter andate in send o aperte/cliccate."
              icon={<Send size={16} />}
            />
            <MetricCard
              label="Open Rate"
              value={`${stats.openRate}%`}
              hint="Aperture uniche sui messaggi già inviati."
              icon={<Eye size={16} />}
            />
            <MetricCard
              label="Click Rate"
              value={`${stats.clickRate}%`}
              hint="Click unici sui link tracciati nelle email."
              icon={<MousePointerClick size={16} />}
            />
            <MetricCard
              label="Bozze"
              value={String(stats.totalDrafts)}
              hint="Campagne non ancora schedulate o inviate."
              icon={<Clock3 size={16} />}
            />
            <MetricCard
              label="Disiscritti"
              value={String(stats.totalUnsubscribed)}
              hint="Contatti che hanno tolto almeno le email newsletter."
              icon={<Pause size={16} />}
            />
            <MetricCard
              label="Trigger In Attesa"
              value={String(stats.waitingAutomations)}
              hint="Trigger di automazione ancora non processati."
              icon={<Sparkles size={16} />}
            />
            <MetricCard
              label="Feedback Opt-Out"
              value={String(stats.unsubscribeFeedbackCount)}
              hint="Segnali recenti utili a correggere volume e rilevanza."
              icon={<Layers3 size={16} />}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    Pipeline
                  </p>
                  <h3 className="editorial-heading mt-2 text-2xl">Ultime campagne</h3>
                </div>
                <button
                  onClick={() => setTab("campaigns")}
                  className="text-sm font-sans text-muted-foreground transition-colors hover:text-foreground"
                >
                  Vedi tutto
                </button>
              </div>

              <div className="space-y-4">
                {campaignMessages.slice(0, 5).map((message) => {
                  const metrics = getMessageMetrics(message.id);
                  const readiness = getMessageReadiness(message);
                  return (
                    <article key={message.id} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            {getCampaignStatusLabel(message.status)}
                          </p>
                          <h4 className="mt-2 font-sans text-lg font-medium">{message.name}</h4>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusPill ok={readiness.ready} label={readiness.ready ? "IT + EN complete" : "Traduzioni incomplete"} />
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {message.scheduled_at
                              ? `Schedulata per ${format(new Date(message.scheduled_at), "dd/MM/yyyy HH:mm")}`
                              : "Bozza non schedulata"}
                          </p>
                        </div>
                        <div className="grid min-w-[210px] grid-cols-2 gap-3 text-xs text-muted-foreground">
                          <div>Invii: {metrics.sent}</div>
                          <div>Aperture: {metrics.opened}</div>
                          <div>Click: {metrics.clicked}</div>
                          <div>Soppressi: {metrics.suppressed}</div>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {campaignMessages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nessuna campagna ancora creata.</p>
                )}
              </div>
            </div>

            <div className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
              <div className="mb-5">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                  Feedback
                </p>
                <h3 className="editorial-heading mt-2 text-2xl">Motivi di disiscrizione</h3>
              </div>
              <div className="space-y-3">
                {unsubscribeReasonSummary.map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-[18px] border border-border/70 px-4 py-3">
                    <span className="text-sm font-sans">{item.label}</span>
                    <span className="text-sm text-muted-foreground">{item.count}</span>
                  </div>
                ))}
                {unsubscribeReasonSummary.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nessun feedback raccolto finora.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "campaigns" && (
        <div className="space-y-4">
          {campaignMessages.map((message) => {
            const metrics = getMessageMetrics(message.id);
            const readiness = getMessageReadiness(message);

            return (
              <article
                key={message.id}
                className="glass-panel-soft rounded-[30px] border border-border/70 p-6"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        {getCampaignStatusLabel(message.status)}
                      </p>
                      <h3 className="editorial-heading mt-2 text-2xl">{message.name}</h3>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatusPill ok={readiness.ready} label={readiness.ready ? "Pronta all'invio" : "Traduzioni mancanti"} />
                      {!readiness.ready && readiness.missing.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {readiness.missing.join(", ")}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground md:grid-cols-4">
                      <div>Totale: {metrics.total}</div>
                      <div>Inviati: {metrics.sent}</div>
                      <div>Aperti: {metrics.opened}</div>
                      <div>Click: {metrics.clicked}</div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {message.scheduled_at
                        ? `Programmata il ${format(new Date(message.scheduled_at), "dd/MM/yyyy HH:mm")}`
                        : "Bozza non schedulata"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3 xl:justify-end">
                    <button
                      onClick={() => openComposer(message)}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-sans text-foreground transition-colors hover:border-foreground"
                    >
                      <PenSquare size={14} /> Modifica
                    </button>
                    <button
                      onClick={() => void runDispatch(message)}
                      disabled={dispatchingId === message.id || !readiness.ready}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light disabled:opacity-50"
                    >
                      <Play size={14} /> {dispatchingId === message.id ? "Invio..." : "Invia ora"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          {campaignMessages.length === 0 && (
            <div className="rounded-[28px] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Nessuna campagna presente.
            </div>
          )}
        </div>
      )}

      {tab === "automations" && (
        <div className="space-y-4">
          <section className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
            <div className="mb-5">
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                Sistema
              </p>
              <h3 className="editorial-heading mt-2 text-2xl">Flussi automatici base</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Qui controlli double opt-in, welcome post-conferma e digest settimanale.
              </p>
            </div>

            <div className="grid gap-4">
              {systemAutomations.map((automation) => {
                const resendCooldown =
                  typeof automation.config.resend_cooldown_minutes === "number"
                    ? automation.config.resend_cooldown_minutes
                    : 15;
                const tokenTtlHours =
                  typeof automation.config.token_ttl_hours === "number"
                    ? automation.config.token_ttl_hours
                    : 72;
                const hourLocal =
                  typeof automation.config.hour_local === "number"
                    ? automation.config.hour_local
                    : 7;
                const minuteLocal =
                  typeof automation.config.minute_local === "number"
                    ? automation.config.minute_local
                    : 0;
                const weekday =
                  typeof automation.config.weekday === "number"
                    ? automation.config.weekday
                    : 2;
                const timezone =
                  typeof automation.config.timezone === "string"
                    ? automation.config.timezone
                    : "Europe/Rome";

                return (
                  <div key={automation.key} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
                          {automation.enabled ? "Attiva" : "Pausa"}
                        </p>
                        <h4 className="mt-2 font-sans text-lg font-medium">
                          {automation.key === "newsletter-confirmation"
                            ? "Conferma iscrizione"
                            : automation.key === "newsletter-welcome"
                              ? "Benvenuto post-conferma"
                              : automation.key === "newsletter-weekly-digest"
                                ? "Digest settimanale articoli"
                                : "Nuovo articolo per storie seguite"}
                        </h4>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {automation.key === "newsletter-confirmation"
                            ? "Invio immediato della mail con link di double opt-in."
                            : automation.key === "newsletter-welcome"
                              ? "Invio dopo che l'utente ha confermato l'iscrizione."
                              : automation.key === "newsletter-weekly-digest"
                                ? "Invio solo se ci sono nuovi articoli pubblicati dall'ultimo recap."
                                : "Invio automatico quando pubblichi un nuovo articolo in una storia seguita."}
                        </p>
                      </div>

                      <button
                        onClick={() =>
                          void updateSystemAutomation(automation.key, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light"
                      >
                        {automation.enabled ? <Pause size={14} /> : <Play size={14} />}
                        {automation.enabled ? "Metti in pausa" : "Attiva"}
                      </button>
                    </div>

                    {automation.key === "newsletter-confirmation" && (
                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Cooldown reinvio (min)
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={resendCooldown}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  resend_cooldown_minutes: Number(event.target.value || 15),
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Scadenza token (ore)
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={tokenTtlHours}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  token_ttl_hours: Number(event.target.value || 72),
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          />
                        </label>
                      </div>
                    )}

                    {automation.key === "newsletter-weekly-digest" && (
                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Giorno
                          </span>
                          <select
                            value={weekday}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  weekday: Number(event.target.value || 2),
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          >
                            <option value={1}>Lunedì</option>
                            <option value={2}>Martedì</option>
                            <option value={3}>Mercoledì</option>
                            <option value={4}>Giovedì</option>
                            <option value={5}>Venerdì</option>
                            <option value={6}>Sabato</option>
                            <option value={7}>Domenica</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Timezone
                          </span>
                          <input
                            type="text"
                            value={timezone}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  timezone: event.target.value || "Europe/Rome",
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Ora locale
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={hourLocal}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  hour_local: Number(event.target.value || 7),
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                            Minuto locale
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            value={minuteLocal}
                            onChange={(event) =>
                              void updateSystemAutomation(automation.key, (current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  minute_local: Number(event.target.value || 0),
                                },
                              }))
                            }
                            className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {automationMessages.map((message) => {
            const metrics = getMessageMetrics(message.id);
            const readiness = getMessageReadiness(message);

            return (
              <article key={message.id} className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
                      {getAutomationStatusLabel(message.status)}
                    </p>
                    <h3 className="editorial-heading mt-2 text-2xl">{message.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Trigger: {getReadableEvent(message.automation_trigger || "subscribed")} · Delay:{" "}
                      {message.automation_delay_minutes ?? 0} min
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill ok={readiness.ready} label={readiness.ready ? "IT + EN complete" : "Traduzioni mancanti"} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-muted-foreground md:grid-cols-4">
                      <div>Totale: {metrics.total}</div>
                      <div>Invii: {metrics.sent}</div>
                      <div>Aperture: {metrics.opened}</div>
                      <div>Click: {metrics.clicked}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 xl:justify-end">
                    <button
                      onClick={() => openComposer(message)}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-sans text-foreground transition-colors hover:border-foreground"
                    >
                      <PenSquare size={14} /> Modifica
                    </button>
                    <button
                      onClick={() => void toggleAutomation(message)}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light"
                    >
                      {message.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                      {message.status === "active" ? "Metti in pausa" : "Attiva"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          {automationMessages.length === 0 && (
            <div className="rounded-[28px] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Nessuna automazione configurata.
            </div>
          )}
        </div>
      )}

      {tab === "editor" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.3fr)_420px]">
          <div className="space-y-6">
            <section className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    Composer
                  </p>
                  <h3 className="editorial-heading mt-2 text-2xl">
                    {form.id ? "Modifica messaggio" : "Nuovo messaggio newsletter"}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    IT ed EN sono richiesti. Le altre lingue restano opzionali e vanno in fallback sul motore di invio.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {requiredLanguages.map((language) => (
                    <StatusPill
                      key={language}
                      ok={
                        form.subjectTranslations[language].trim().length > 0 &&
                        hasBodyForLanguage(form.bodyHtmlTranslations, form.bodyJsonTranslations, language)
                      }
                      label={`${language.toUpperCase()} pronto`}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                    Nome interno
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                    placeholder="Es. April 2026 launch"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                    Tipo messaggio
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "campaign", label: "Campagna" },
                      { id: "automation", label: "Automazione" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, kind: item.id as NewsletterKind }))}
                        className={`rounded-[20px] border px-4 py-3 text-sm font-sans transition-colors ${
                          form.kind === item.id
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                    From Name
                  </label>
                  <input
                    type="text"
                    value={form.fromName}
                    onChange={(event) => setForm((prev) => ({ ...prev, fromName: event.target.value }))}
                    className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                  />
                </div>

                {form.kind === "campaign" ? (
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                      <CalendarClock size={14} /> Schedulazione
                    </label>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(event) => setForm((prev) => ({ ...prev, scheduledAt: event.target.value }))}
                      className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        Trigger
                      </label>
                      <select
                        value={form.automationTrigger}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            automationTrigger: event.target.value as AutomationTrigger,
                          }))
                        }
                        className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                      >
                        <option value="subscribed">Iscrizione</option>
                        <option value="unsubscribed">Disiscrizione</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        Delay (min)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={form.automationDelayMinutes}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            automationDelayMinutes: Number(event.target.value || 0),
                          }))
                        }
                        className="w-full rounded-[20px] border border-border bg-transparent px-4 py-3 text-sm font-sans transition-colors focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {form.kind === "automation" && (
                <div className="mt-4 flex items-center justify-between rounded-[22px] border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-sans">Stato automazione</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Le email automatiche restano tracciate ma non vengono inviate verso contatti soppressi o disiscritti.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, automationActive: !prev.automationActive }))}
                    className={`relative h-6 w-12 rounded-full transition-colors ${
                      form.automationActive ? "bg-accent" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        form.automationActive ? "translate-x-6" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}
            </section>

            <section className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    Localizzazione
                  </p>
                  <h3 className="editorial-heading mt-2 text-2xl">Contenuti multilingua</h3>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">
                  <Globe2 size={14} /> Anteprima attuale: {selectedLanguage.toUpperCase()}
                </div>
              </div>

              <div className="rounded-[28px] border border-border/70 bg-background p-5">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="editorial-heading text-xl">{getLanguageLabel(selectedLanguage)}</p>
                      <StatusPill
                        ok={
                          form.subjectTranslations[selectedLanguage].trim().length > 0 &&
                          hasBodyForLanguage(
                            form.bodyHtmlTranslations,
                            form.bodyJsonTranslations,
                            selectedLanguage
                          )
                        }
                        label="Richiesta"
                      />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Subject e contenuto vengono usati per chi ha questa lingua come preferenza o fallback.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-accent bg-accent/10 px-4 py-2 text-sm font-sans text-accent"
                  >
                    <Eye size={14} /> Anteprima
                  </button>
                </div>

                <div className="mb-5 flex gap-4 border-b border-border">
                  {requiredLanguages.map((language) => (
                    <button
                      key={language}
                      type="button"
                      onClick={() => setSelectedLanguage(language)}
                      className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${
                        selectedLanguage === language
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground"
                      }`}
                    >
                      {getLanguageLabel(language)}
                    </button>
                  ))}
                </div>

                {renderLanguageEditor(selectedLanguage, true, false)}
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setShowOptionalLanguages((prev) => !prev)}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-sans text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Globe2 size={14} />
                  {showOptionalLanguages ? "Nascondi lingue aggiuntive" : "Apri lingue aggiuntive"}
                </button>
              </div>

              {showOptionalLanguages && (
                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  {optionalLanguages.map((language) => renderLanguageEditor(language.code))}
                </div>
              )}
            </section>

            <section className="glass-panel-soft rounded-[30px] border border-border/70 p-6">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    Toolbox
                  </p>
                  <h3 className="editorial-heading mt-2 text-2xl">Variabili e asset</h3>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">
                  Target snippet: {selectedLanguage.toUpperCase()}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-border/70 p-4">
                  <p className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                    Merge Tags
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Usa variabili dinamiche come <code>{"{{first_name}}"}</code> o <code>{"{{unsubscribe_url}}"}</code>.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {NEWSLETTER_MERGE_TAGS.map((tag) => (
                      <button
                        key={tag.token}
                        type="button"
                        onClick={() => void copyToClipboard(tag.token, `${tag.token} copiato.`)}
                        className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground"
                        title={tag.label}
                      >
                        <Copy size={12} /> {tag.token}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/70 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        Asset multimediali
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Carica immagini o file sul bucket e riusali nel body corrente.
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-sans text-foreground transition-colors hover:border-foreground">
                      <ImagePlus size={14} /> {uploadingAssets ? "Caricamento..." : "Carica asset"}
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleAssetUpload(event)}
                      />
                    </label>
                  </div>

                  {uploadedAssets.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {uploadedAssets.map((asset) => {
                        const imageSnippet = `<p><img src="${asset.url}" alt="${asset.name}" style="max-width:100%;height:auto;" /></p>`;
                        const linkSnippet = `<p><a href="${asset.url}" target="_blank" rel="noopener noreferrer">${asset.name}</a></p>`;
                        const selectedMode = form.bodyModeTranslations[selectedLanguage];
                        return (
                          <div
                            key={`${asset.url}-${asset.name}`}
                            className="flex flex-col gap-3 rounded-[20px] border border-border/60 p-3 lg:flex-row lg:items-center lg:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-sans">{asset.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{asset.url}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void copyToClipboard(asset.url, "URL copiata.")}
                                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Link2 size={12} /> URL
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  selectedMode === "html"
                                    ? appendHtmlSnippet(
                                        selectedLanguage,
                                        asset.kind === "image" ? imageSnippet : linkSnippet
                                      )
                                    : void copyToClipboard(
                                        asset.kind === "image" ? imageSnippet : linkSnippet,
                                        "Snippet HTML copiato."
                                      )
                                }
                                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Code2 size={12} /> {selectedMode === "html" ? "Inserisci snippet" : "Copia snippet"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void saveMessage()}
                disabled={saving}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light disabled:opacity-50"
              >
                <Send size={14} /> {saving ? "Salvataggio..." : "Salva messaggio"}
              </button>
              <button
                onClick={() => {
                  populateForm();
                  setTab("overview");
                }}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-sans text-muted-foreground transition-colors hover:text-foreground"
              >
                Annulla
              </button>
            </div>
          </div>

          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="overflow-hidden rounded-[30px] border border-border/70 bg-background">
              <div className="border-b border-border/70 px-6 py-5">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                  Anteprima Live
                </p>
                <h3 className="editorial-heading mt-2 text-2xl">{previewSubject || "Subject mancante"}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {previewPreheader || "Aggiungi un preheader per la preview inbox."}
                </p>
              </div>

              <div className="space-y-4 bg-[#f4efe7] bg-[linear-gradient(180deg,rgba(255,255,255,0.82)_0%,rgba(244,239,231,0.94)_45%,rgba(237,244,244,0.92)_100%)] p-5">
                <div className="rounded-[26px] border border-[#e6ddd1] bg-[#fffdf9] p-4 shadow-[0_26px_80px_rgba(21,35,56,0.10)]">
                  <div className="overflow-hidden rounded-[22px] bg-[#dde8ea]">
                    <img
                      src="/og-image.jpeg"
                      alt="BITE"
                      className="h-40 w-full object-cover"
                    />
                  </div>
                  <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.34em] text-[#152338]">
                    BITE
                  </p>
                  <p className="mt-3 text-[11px] font-sans uppercase tracking-[0.24em] text-[#6a7484]">
                    {selectedLanguage.toUpperCase()} Preview
                  </p>
                  <div
                    className="article-rich-body prose prose-sm mt-4 max-w-none text-[#243042]"
                    dangerouslySetInnerHTML={{
                      __html:
                        previewBodyHtml ||
                        "<p class='text-[#6a7484]'>Nessun contenuto disponibile per questa lingua.</p>",
                    }}
                  />
                  <div className="mt-6 rounded-[18px] border border-[#e6ddd1] bg-white/70 px-4 py-3">
                    <p className="text-xs text-[#6a7484]">
                      Ricevi questa email perché ti sei iscritto alla newsletter di BITE.
                    </p>
                    <p className="mt-2 text-xs font-medium text-[#152338] underline">
                      Unsubscribe
                    </p>
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/70 bg-background px-4 py-4">
                  <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
                    Stato contenuti
                  </p>
                  <div className="mt-3 space-y-2">
                    {requiredLanguages.map((language) => (
                      <div key={language} className="flex items-center justify-between text-sm">
                        <span>{getLanguageLabel(language)}</span>
                        <StatusPill
                          ok={
                            form.subjectTranslations[language].trim().length > 0 &&
                            hasBodyForLanguage(form.bodyHtmlTranslations, form.bodyJsonTranslations, language)
                          }
                          label={
                            form.subjectTranslations[language].trim().length > 0 &&
                            hasBodyForLanguage(form.bodyHtmlTranslations, form.bodyJsonTranslations, language)
                              ? "Completa"
                              : "Incompleta"
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default AdminNewsletterManager;
