import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { format } from "date-fns";
import {
  Mail,
  Send,
  Sparkles,
  Eye,
  MousePointerClick,
  Clock3,
  Wand2,
  CalendarClock,
  RefreshCw,
  PenSquare,
  Play,
  Pause,
  Globe2,
  Code2,
  ImagePlus,
  Copy,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { ALL_LANGUAGES, type ExtendedLanguage } from "@/lib/i18n";
import {
  NEWSLETTER_MERGE_TAGS,
  type NewsletterBodyMode,
  buildNewsletterPreviewVariables,
  renderNewsletterMergeTags,
} from "@/lib/newsletter";

type NewsletterMessage = any;
type NewsletterDelivery = any;
type NewsletterSubscriber = Database["public"]["Tables"]["newsletter_subscribers"]["Row"];
type NewsletterEvent = any;
type NewsletterUnsubscribeFeedback = any;
type SystemEmailAutomation = {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at?: string | null;
  last_sent_at?: string | null;
};

type ComposerTab = "overview" | "campaigns" | "automations" | "editor";
type NewsletterKind = "campaign" | "automation";
type AutomationTrigger = "subscribed" | "unsubscribed";

type TranslationStringMap = Record<ExtendedLanguage, string>;
type TranslationJsonMap = Record<ExtendedLanguage, Json | null>;
type TranslationBodyModeMap = Record<ExtendedLanguage, NewsletterBodyMode>;

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
    if (typeof maybeValue === "string") {
      next[code] = maybeValue;
    }
  }

  return next;
};

const parseJsonTranslations = (value: Json): TranslationJsonMap => {
  const next = createEmptyJsonTranslations();
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;

  for (const code of languageCodes) {
    const maybeValue = (value as Record<string, Json | null>)[code];
    if (maybeValue) {
      next[code] = maybeValue;
    }
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
    if (
      next[code] === "richtext" &&
      !bodyJsonTranslations[code] &&
      bodyHtmlTranslations[code].trim()
    ) {
      next[code] = "html";
    }
  }

  return next;
};

const compactStringTranslations = (value: TranslationStringMap) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry.trim().length > 0)
  );

const compactJsonTranslations = (value: TranslationJsonMap) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => Boolean(entry))
  );

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

const formatDateTimeLocal = (value: string | null) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";

const resolvePreviewValue = (
  values: TranslationStringMap,
  selectedLanguage: ExtendedLanguage
) =>
  values[selectedLanguage] ||
  values.it ||
  values.en ||
  Object.values(values).find(Boolean) ||
  "";

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
  <div className="border border-border bg-background p-5">
    <div className="flex items-center justify-between mb-4">
      <p className="text-xs font-sans tracking-[0.24em] uppercase text-muted-foreground">
        {label}
      </p>
      <span className="text-muted-foreground">{icon}</span>
    </div>
    <p className="editorial-heading text-3xl">{value}</p>
    <p className="text-sm text-muted-foreground mt-2">{hint}</p>
  </div>
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
  const [form, setForm] = useState<NewsletterFormState>(emptyFormState);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedNewsletterAsset[]>([]);
  const [uploadingAssets, setUploadingAssets] = useState(false);

  const fetchNewsletterData = async (withLoader = false) => {
    if (withLoader) setLoading(true);
    setRefreshing(true);

    const [messagesRes, deliveriesRes, subscribersRes, eventsRes, feedbackRes, systemAutomationsRes] = await Promise.all([
      (supabase as any)
        .from("newsletter_messages")
        .select("*")
        .order("updated_at", { ascending: false }),
      (supabase as any)
        .from("newsletter_deliveries")
        .select("*")
        .order("queued_at", { ascending: false })
        .limit(800),
      supabase
        .from("newsletter_subscribers")
        .select("*")
        .order("updated_at", { ascending: false }),
      (supabase as any)
        .from("newsletter_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("newsletter_unsubscribe_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("system_email_automations")
        .select("*")
        .order("key", { ascending: true }),
    ]);

    if (messagesRes.error || deliveriesRes.error || subscribersRes.error || eventsRes.error || feedbackRes.error || systemAutomationsRes.error) {
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
      setMessages(messagesRes.data ?? []);
      setDeliveries(deliveriesRes.data ?? []);
      setSubscribers(subscribersRes.data ?? []);
      setEvents(eventsRes.data ?? []);
      setUnsubscribeFeedback(feedbackRes.data ?? []);
      const rows = systemAutomationsRes.data ?? [];
      const merged = Object.values(defaultSystemAutomations).map((automation) => {
        const override = rows.find((row: SystemEmailAutomation) => row.key === automation.key);
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
    const sentDeliveries = deliveries.filter((delivery) =>
      ["sent", "opened", "clicked"].includes(delivery.status)
    );
    const openedDeliveries = deliveries.filter((delivery) => delivery.open_count > 0);
    const clickedDeliveries = deliveries.filter((delivery) => delivery.click_count > 0);

    return {
      totalSubscribers: activeSubscribers.length,
      totalUnsubscribed: subscribers.filter((subscriber) => !subscriber.subscribed).length,
      totalDrafts: campaignMessages.filter((message) => message.status === "draft").length,
      totalSent: sentDeliveries.length,
      openRate: sentDeliveries.length
        ? Math.round((openedDeliveries.length / sentDeliveries.length) * 100)
        : 0,
      clickRate: sentDeliveries.length
        ? Math.round((clickedDeliveries.length / sentDeliveries.length) * 100)
        : 0,
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
      .map(([key, count]) => ({
        key,
        count,
        label: labels[key] || key,
      }))
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
    setSystemAutomations((items) =>
      items.map((item) => (item.key === key ? next : item))
    );

    const { error } = await (supabase as any)
      .from("system_email_automations")
      .upsert({
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
      return;
    }

    const bodyJsonTranslations = parseJsonTranslations(message.body_json_translations);
    const bodyHtmlTranslations = parseStringTranslations(message.body_html_translations);

    setForm({
      id: message.id,
      name: message.name,
      kind: message.kind as NewsletterKind,
      fromName: message.from_name || "BITE",
      scheduledAt: formatDateTimeLocal(message.scheduled_at),
      automationTrigger: (message.automation_trigger as AutomationTrigger) || "subscribed",
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

  const updateSelectedJson = (value: Json | null) => {
    setForm((prev) => ({
      ...prev,
      bodyJsonTranslations: {
        ...prev.bodyJsonTranslations,
        [selectedLanguage]: value,
      },
    }));
  };

  const updateSelectedHtml = (value: string) => {
    setForm((prev) => ({
      ...prev,
      bodyHtmlTranslations: {
        ...prev.bodyHtmlTranslations,
        [selectedLanguage]: value,
      },
    }));
  };

  const selectedBodyMode = form.bodyModeTranslations[selectedLanguage];

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      console.error("Clipboard copy failed", error);
      toast.error("Copia negli appunti non riuscita.");
    }
  };

  const setSelectedBodyMode = (mode: NewsletterBodyMode) => {
    if (mode === selectedBodyMode) return;

    if (
      mode === "richtext" &&
      !form.bodyJsonTranslations[selectedLanguage] &&
      form.bodyHtmlTranslations[selectedLanguage].trim()
    ) {
      toast.message("Passaggio a rich text", {
        description:
          "L'HTML raw non viene convertito automaticamente in blocchi TipTap. Il contenuto HTML resta salvato e puoi sempre tornare in modalità HTML.",
      });
    }

    setForm((prev) => ({
      ...prev,
      bodyModeTranslations: {
        ...prev.bodyModeTranslations,
        [selectedLanguage]: mode,
      },
    }));
  };

  const appendHtmlSnippet = (snippet: string) => {
    setForm((prev) => ({
      ...prev,
      bodyHtmlTranslations: {
        ...prev.bodyHtmlTranslations,
        [selectedLanguage]: `${prev.bodyHtmlTranslations[selectedLanguage] || ""}\n${snippet}`.trim(),
      },
      bodyModeTranslations: {
        ...prev.bodyModeTranslations,
        [selectedLanguage]: "html",
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
      toast.success(
        nextAssets.length === 1
          ? "Asset caricato."
          : `${nextAssets.length} asset caricati.`
      );
    }
  };

  const saveMessage = async () => {
    const hasSubject = Object.values(form.subjectTranslations).some((value) => value.trim());
    const hasBody = Object.values(form.bodyHtmlTranslations).some((value) => value.trim());

    if (!form.name.trim() || !hasSubject || !hasBody) {
      toast.error("Inserisci nome, almeno un subject e un contenuto.");
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload: any = {
      name: form.name.trim(),
      kind: form.kind,
      from_name: form.fromName.trim() || "BITE",
      scheduled_at:
        form.kind === "campaign" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null,
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
      toast.success(
        `Campagna accodata. ${data?.campaignsQueued ?? 0} destinatari in elaborazione.`
      );
    }

    setDispatchingId(null);
    await fetchNewsletterData();
  };

  const toggleAutomation = async (message: NewsletterMessage) => {
    const nextStatus = message.status === "active" ? "paused" : "active";
    const { error } = await (supabase as any)
      .from("newsletter_messages")
      .update({ status: nextStatus })
      .eq("id", message.id);

    if (error) {
      console.error("Automation toggle failed", error);
      toast.error("Impossibile aggiornare l'automazione.");
      return;
    }

    toast.success(nextStatus === "active" ? "Automazione attivata." : "Automazione in pausa.");
    await fetchNewsletterData();
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
  const previewBody = renderNewsletterMergeTags(
    resolvePreviewValue(form.bodyHtmlTranslations, selectedLanguage),
    previewVariables
  );

  const getMessageMetrics = (messageId: string) => {
    const messageDeliveries = deliveries.filter(
      (delivery) => delivery.newsletter_message_id === messageId
    );
    const sent = messageDeliveries.filter((delivery) =>
      ["sent", "opened", "clicked"].includes(delivery.status)
    ).length;
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">Caricamento newsletter...</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-muted-foreground mb-2">
            Newsletter Control
          </p>
          <h2 className="editorial-heading text-2xl md:text-3xl">Dashboard newsletter</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void fetchNewsletterData()}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Aggiorna
          </button>
          <button
            onClick={() => openComposer(undefined, "campaign")}
            className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-sans font-medium text-primary-foreground hover:bg-navy-light transition-colors"
          >
            <PenSquare size={14} /> Nuova campagna
          </button>
          <button
            onClick={() => openComposer(undefined, "automation")}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans text-foreground hover:border-foreground transition-colors"
          >
            <Wand2 size={14} /> Nuova automazione
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-6 border-b border-border">
        {[
          { id: "overview", label: "Overview" },
          { id: "campaigns", label: "Campagne" },
          { id: "automations", label: "Automazioni" },
          { id: "editor", label: "Editor" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as ComposerTab)}
            className={`pb-3 text-sm font-sans tracking-wide border-b-2 transition-colors ${
              tab === item.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <MetricCard
              label="Iscritti attivi"
              value={String(stats.totalSubscribers)}
              hint="Subscriber attualmente raggiungibili da campagne newsletter."
              icon={<Mail size={16} />}
            />
            <MetricCard
              label="Messaggi inviati"
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
              label="Bozze campagna"
              value={String(stats.totalDrafts)}
              hint="Campagne ancora non programmate o non inviate."
              icon={<Clock3 size={16} />}
            />
            <MetricCard
              label="Disiscritti"
              value={String(stats.totalUnsubscribed)}
              hint="Contatti che hanno tolto almeno le email newsletter."
              icon={<Pause size={16} />}
            />
            <MetricCard
              label="Eventi in attesa"
              value={String(stats.waitingAutomations)}
              hint="Trigger di automazione ancora non processati."
              icon={<Sparkles size={16} />}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-6">
            <div className="border border-border bg-background p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="editorial-heading text-xl">Ultime campagne</h3>
                <button
                  onClick={() => setTab("campaigns")}
                  className="text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
                >
                  Vedi tutto
                </button>
              </div>
              <div className="space-y-4">
                {campaignMessages.slice(0, 5).map((message) => {
                  const metrics = getMessageMetrics(message.id);
                  return (
                    <div key={message.id} className="border border-border/70 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                            {getCampaignStatusLabel(message.status)}
                          </p>
                          <h4 className="font-sans text-base font-medium">{message.name}</h4>
                          <p className="text-xs text-muted-foreground mt-2">
                            {message.scheduled_at
                              ? `Schedulata per ${format(new Date(message.scheduled_at), "dd/MM/yyyy HH:mm")}`
                              : "Non ancora schedulata"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground min-w-[190px]">
                          <div>Invii: {metrics.sent}</div>
                          <div>Aperture: {metrics.opened}</div>
                          <div>Click: {metrics.clicked}</div>
                          <div>Soppressi: {metrics.suppressed}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {campaignMessages.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nessuna campagna ancora creata.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-border bg-background p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="editorial-heading text-xl">Trigger recenti</h3>
                <button
                  onClick={() => setTab("automations")}
                  className="text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
                >
                  Apri automazioni
                </button>
              </div>
              <div className="space-y-3">
                {events.slice(0, 8).map((event) => (
                  <div key={event.id} className="border border-border/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-sans">{getReadableEvent(event.event_type)}</p>
                        <p className="text-xs text-muted-foreground">{event.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(event.occurred_at), "dd/MM HH:mm")}
                        </p>
                        <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground mt-1">
                          {event.processed_at ? "Processato" : "In attesa"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {events.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nessun evento newsletter.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6">
            <div className="border border-border bg-background p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="editorial-heading text-xl">Motivi di disiscrizione</h3>
                <span className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  {stats.unsubscribeFeedbackCount} feedback
                </span>
              </div>
              <div className="space-y-3">
                {unsubscribeReasonSummary.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between border border-border/70 px-4 py-3"
                  >
                    <span className="text-sm font-sans">{item.label}</span>
                    <span className="text-sm text-muted-foreground">{item.count}</span>
                  </div>
                ))}
                {unsubscribeReasonSummary.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nessun feedback raccolto finora.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-border bg-background p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="editorial-heading text-xl">Feedback recenti</h3>
                <span className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  Ultimi 100
                </span>
              </div>
              <div className="space-y-3">
                {unsubscribeFeedback.slice(0, 8).map((item) => {
                  const scopes = [
                    item.unsubscribe_scope?.newsletter_enabled === false ? "newsletter" : null,
                    item.unsubscribe_scope?.digest_enabled === false ? "digest" : null,
                    item.unsubscribe_scope?.story_notifications_enabled === false ? "stories" : null,
                  ].filter(Boolean);

                  return (
                    <div key={item.id} className="border border-border/70 px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-sans truncate">{item.email}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {(item.reason_code || "nessun motivo").replaceAll("_", " ")}
                            {item.reason_text ? ` · ${item.reason_text}` : ""}
                          </p>
                          {scopes.length > 0 && (
                            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-2">
                              Scope: {scopes.join(" / ")}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.created_at), "dd/MM HH:mm")}
                          </p>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
                            {item.source || "preferences_page"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {unsubscribeFeedback.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nessun feedback recente disponibile.
                  </p>
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
            return (
              <div
                key={message.id}
                className="border border-border bg-background p-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
              >
                <div>
                  <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                    {getCampaignStatusLabel(message.status)}
                  </p>
                  <h3 className="editorial-heading text-xl">{message.name}</h3>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-muted-foreground">
                    <div>Totale: {metrics.total}</div>
                    <div>Inviati: {metrics.sent}</div>
                    <div>Aperti: {metrics.opened}</div>
                    <div>Click: {metrics.clicked}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    {message.scheduled_at
                      ? `Programmata il ${format(new Date(message.scheduled_at), "dd/MM/yyyy HH:mm")}`
                      : "Bozza non schedulata"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end">
                  <button
                    onClick={() => openComposer(message)}
                    className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans text-foreground hover:border-foreground transition-colors"
                  >
                    <PenSquare size={14} /> Modifica
                  </button>
                  <button
                    onClick={() => void runDispatch(message)}
                    disabled={dispatchingId === message.id}
                    className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-sans font-medium text-primary-foreground hover:bg-navy-light transition-colors disabled:opacity-50"
                  >
                    <Play size={14} /> {dispatchingId === message.id ? "Invio..." : "Invia ora"}
                  </button>
                </div>
              </div>
            );
          })}
          {campaignMessages.length === 0 && (
            <div className="border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Nessuna campagna presente.
            </div>
          )}
        </div>
      )}

      {tab === "automations" && (
        <div className="space-y-4">
          <div className="border border-border bg-background p-5 space-y-5">
            <div>
              <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                Automazioni di sistema
              </p>
              <h3 className="editorial-heading text-xl">Flussi automatici base</h3>
              <p className="text-sm text-muted-foreground mt-2">
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
                  <div key={automation.key} className="border border-border/70 p-4 space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                          {automation.enabled ? "Attiva" : "Pausa"}
                        </p>
                        <h4 className="font-sans text-base font-medium">
                          {automation.key === "newsletter-confirmation"
                            ? "Conferma iscrizione"
                            : automation.key === "newsletter-welcome"
                              ? "Benvenuto post-conferma"
                              : automation.key === "newsletter-weekly-digest"
                                ? "Digest settimanale articoli"
                                : "Nuovo articolo per storie seguite"}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-2">
                          {automation.key === "newsletter-confirmation"
                            ? "Invio immediato della mail con link di double opt-in."
                            : automation.key === "newsletter-welcome"
                              ? "Invio dopo che l'utente ha confermato l'iscrizione."
                              : automation.key === "newsletter-weekly-digest"
                                ? "Invio solo se ci sono nuovi articoli pubblicati dall'ultimo recap."
                                : "Invio automatico quando pubblichi un nuovo articolo in una storia seguita."}
                        </p>
                        {automation.last_sent_at && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Ultimo invio: {format(new Date(automation.last_sent_at), "dd/MM/yyyy HH:mm")}
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          void updateSystemAutomation(automation.key, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                        className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-sans font-medium text-primary-foreground hover:bg-navy-light transition-colors"
                      >
                        {automation.enabled ? <Pause size={14} /> : <Play size={14} />}
                        {automation.enabled ? "Metti in pausa" : "Attiva"}
                      </button>
                    </div>

                    {automation.key === "newsletter-confirmation" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                          />
                        </label>
                      </div>
                    )}

                    {automation.key === "newsletter-weekly-digest" && (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <label className="block">
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
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
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                            className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {automationMessages.map((message) => {
            const metrics = getMessageMetrics(message.id);
            return (
              <div
                key={message.id}
                className="border border-border bg-background p-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
              >
                <div>
                  <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                    {getAutomationStatusLabel(message.status)}
                  </p>
                  <h3 className="editorial-heading text-xl">{message.name}</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Trigger: {getReadableEvent(message.automation_trigger || "subscribed")} · Delay:{" "}
                    {message.automation_delay_minutes} min
                  </p>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-muted-foreground">
                    <div>Totale: {metrics.total}</div>
                    <div>Invii: {metrics.sent}</div>
                    <div>Aperture: {metrics.opened}</div>
                    <div>Click: {metrics.clicked}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end">
                  <button
                    onClick={() => openComposer(message)}
                    className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans text-foreground hover:border-foreground transition-colors"
                  >
                    <PenSquare size={14} /> Modifica
                  </button>
                  <button
                    onClick={() => void toggleAutomation(message)}
                    className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-sans font-medium text-primary-foreground hover:bg-navy-light transition-colors"
                  >
                    {message.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                    {message.status === "active" ? "Metti in pausa" : "Attiva"}
                  </button>
                </div>
              </div>
            );
          })}
          {automationMessages.length === 0 && (
            <div className="border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Nessuna automazione configurata.
            </div>
          )}
        </div>
      )}

      {tab === "editor" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_420px] gap-6">
          <div className="border border-border bg-background p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                  Nome interno
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  placeholder="Es. Aprile 2026 / Welcome sequence"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                  Tipo messaggio
                </label>
                <div className="flex gap-2">
                  {[
                    { id: "campaign", label: "Campagna" },
                    { id: "automation", label: "Automazione" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          kind: item.id as NewsletterKind,
                        }))
                      }
                      className={`flex-1 border px-4 py-3 text-sm font-sans transition-colors ${
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                  From Name
                </label>
                <input
                  type="text"
                  value={form.fromName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, fromName: event.target.value }))
                  }
                  className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {form.kind === "campaign" ? (
                <div>
                  <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 flex items-center gap-2">
                    <CalendarClock size={14} /> Schedulazione
                  </label>
                  <input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, scheduledAt: event.target.value }))
                    }
                    className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                      className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                    >
                      <option value="subscribed">Iscrizione</option>
                      <option value="unsubscribed">Disiscrizione</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
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
                      className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {form.kind === "automation" && (
              <div className="flex items-center justify-between border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-sans">Stato automazione</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    La mail di addio viene tracciata ma non inviata verso contatti soppressi/disiscritti.
                  </p>
                </div>
                <button
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      automationActive: !prev.automationActive,
                    }))
                  }
                  className={`relative w-12 h-6 rounded-full transition-colors ${
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

            <div className="border-t border-border pt-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                    Localizzazione contenuti
                  </p>
                  <p className="text-sm text-muted-foreground">
                    I contenuti vengono inviati nella lingua preferita salvata sul profilo/subscriber.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe2 size={14} /> {selectedLanguage.toUpperCase()}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-5">
                {ALL_LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    onClick={() => setSelectedLanguage(language.code)}
                    className={`border px-3 py-2 text-sm font-sans transition-colors ${
                      selectedLanguage === language.code
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {language.label}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                    Subject ({selectedLanguage.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    value={form.subjectTranslations[selectedLanguage]}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        subjectTranslations: {
                          ...prev.subjectTranslations,
                          [selectedLanguage]: event.target.value,
                        },
                      }))
                    }
                    className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                    Preheader ({selectedLanguage.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    value={form.preheaderTranslations[selectedLanguage]}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        preheaderTranslations: {
                          ...prev.preheaderTranslations,
                          [selectedLanguage]: event.target.value,
                        },
                      }))
                    }
                    className="w-full border border-border bg-transparent px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="border border-border/70 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                        Variabili dinamiche
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Usa merge tag come <code>{"{{first_name}}"}</code> o <code>{"{{unsubscribe_url}}"}</code>.
                      </p>
                    </div>
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedBodyMode("richtext")}
                        className={`border px-3 py-2 text-sm font-sans transition-colors ${
                          selectedBodyMode === "richtext"
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Rich text
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedBodyMode("html")}
                        className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-sans transition-colors ${
                          selectedBodyMode === "html"
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Code2 size={14} /> HTML
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {NEWSLETTER_MERGE_TAGS.map((tag) => (
                      <button
                        key={tag.token}
                        type="button"
                        onClick={() => void copyToClipboard(tag.token, `${tag.token} copiato.`)}
                        className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors"
                        title={tag.label}
                      >
                        <Copy size={12} /> {tag.token}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border border-border/70 p-4 space-y-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                        Asset multimediali
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Carica immagini o file hostati sul bucket del sito. Per video/audio conviene usare link hostati, non embed diretti.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans text-foreground hover:border-foreground transition-colors cursor-pointer">
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
                    <div className="space-y-2">
                      {uploadedAssets.map((asset) => {
                        const imageSnippet = `<p><img src="${asset.url}" alt="${asset.name}" style="max-width:100%;height:auto;" /></p>`;
                        const linkSnippet = `<p><a href="${asset.url}" target="_blank" rel="noopener noreferrer">${asset.name}</a></p>`;
                        return (
                          <div
                            key={`${asset.url}-${asset.name}`}
                            className="flex flex-col gap-3 border border-border/60 p-3 lg:flex-row lg:items-center lg:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-sans truncate">{asset.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{asset.url}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void copyToClipboard(asset.url, "URL copiata.")}
                                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Link2 size={12} /> URL
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  selectedBodyMode === "html"
                                    ? appendHtmlSnippet(asset.kind === "image" ? imageSnippet : linkSnippet)
                                    : void copyToClipboard(
                                        asset.kind === "image" ? imageSnippet : linkSnippet,
                                        "Snippet HTML copiato."
                                      )
                                }
                                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Code2 size={12} /> {selectedBodyMode === "html" ? "Inserisci snippet" : "Copia snippet"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-2 block">
                    Contenuto ({selectedLanguage.toUpperCase()})
                  </label>
                  {selectedBodyMode === "html" ? (
                    <textarea
                      value={form.bodyHtmlTranslations[selectedLanguage]}
                      onChange={(event) => updateSelectedHtml(event.target.value)}
                      rows={18}
                      className="w-full border border-border bg-transparent px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors resize-y"
                      placeholder="<h1>Ciao {{first_name}}</h1><p>...</p>"
                    />
                  ) : (
                    <RichTextEditor
                      content={form.bodyJsonTranslations[selectedLanguage]}
                      onChange={(content) => updateSelectedJson(content as Json)}
                      onHtmlChange={updateSelectedHtml}
                      placeholder="Scrivi il contenuto della mail..."
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void saveMessage()}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-sm font-sans font-medium text-primary-foreground hover:bg-navy-light transition-colors disabled:opacity-50"
              >
                <Send size={14} /> {saving ? "Salvataggio..." : "Salva messaggio"}
              </button>
              <button
                onClick={() => {
                  populateForm();
                  setTab("overview");
                }}
                className="inline-flex items-center gap-2 border border-border px-5 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>

          <div className="border border-border bg-background overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-sans tracking-[0.22em] uppercase text-muted-foreground mb-1">
                Anteprima live
              </p>
              <p className="editorial-heading text-xl">
                {previewSubject || "Subject mancante"}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {previewPreheader || "Aggiungi un preheader per la preview inbox."}
              </p>
            </div>
            <div className="bg-[#f5f2ed] p-5">
              <div className="mx-auto max-w-md bg-white border border-[#e5ddd2] px-7 py-8">
                <p className="text-[11px] font-sans tracking-[0.35em] uppercase text-[#1a2236]/70 mb-5">
                  BITE
                </p>
                <div
                  className="article-rich-body prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{
                    __html:
                      previewBody ||
                      "<p class='text-muted-foreground'>Nessun contenuto disponibile per questa lingua.</p>",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminNewsletterManager;
