import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PROFILE_NOTIFICATION_PREFERENCES,
  ENGAGEMENT_NOTIFICATION_FREQUENCIES,
  normalizeEngagementNotificationFrequency,
  type EngagementNotificationFrequency,
} from "@/lib/email-notification-preferences";
import { useI18n } from "@/lib/i18n";

type Status = "loading" | "ready" | "invalid" | "success" | "error";

type EmailPreferences = {
  newsletter_enabled: boolean;
  digest_enabled: boolean;
  story_notifications_enabled: boolean;
  like_notifications_frequency: EngagementNotificationFrequency;
  comment_notifications_frequency: EngagementNotificationFrequency;
};

type TogglePreferenceKey =
  | "newsletter_enabled"
  | "digest_enabled"
  | "story_notifications_enabled";

type ReasonCode =
  | "too_many_emails"
  | "content_not_relevant"
  | "prefer_social"
  | "temporary_pause"
  | "signed_up_by_mistake"
  | "other";

const defaultPreferences: EmailPreferences = {
  newsletter_enabled: true,
  digest_enabled: true,
  story_notifications_enabled: true,
  ...DEFAULT_PROFILE_NOTIFICATION_PREFERENCES,
};

const Unsubscribe = () => {
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);
  const [email, setEmail] = useState("");
  const [context, setContext] = useState<string | null>(null);
  const [storySubscriptionCount, setStorySubscriptionCount] = useState(0);
  const [preferences, setPreferences] = useState<EmailPreferences>(defaultPreferences);
  const [initialPreferences, setInitialPreferences] = useState<EmailPreferences>(defaultPreferences);
  const [reasonCode, setReasonCode] = useState<ReasonCode | "">("");
  const [reasonText, setReasonText] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    void loadPreferences(token);
  }, [token]);

  const hasAnyEnabled = useMemo(
    () =>
      preferences.newsletter_enabled ||
      preferences.digest_enabled ||
      preferences.story_notifications_enabled ||
      preferences.like_notifications_frequency !== "none" ||
      preferences.comment_notifications_frequency !== "none",
    [preferences]
  );

  const hasChanges = useMemo(
    () =>
      preferences.newsletter_enabled !== initialPreferences.newsletter_enabled ||
      preferences.digest_enabled !== initialPreferences.digest_enabled ||
      preferences.story_notifications_enabled !== initialPreferences.story_notifications_enabled ||
      preferences.like_notifications_frequency !== initialPreferences.like_notifications_frequency ||
      preferences.comment_notifications_frequency !== initialPreferences.comment_notifications_frequency ||
      reasonCode.length > 0 ||
      reasonText.trim().length > 0,
    [initialPreferences, preferences, reasonCode, reasonText]
  );

  const loadPreferences = async (nextToken: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(nextToken)}`,
        { headers: { apikey: anonKey } }
      );

      if (!res.ok) {
        setStatus("invalid");
        return;
      }

      const data = await res.json();
      if (!data?.valid) {
        setStatus("invalid");
        return;
      }

      const nextPreferences = {
        newsletter_enabled: Boolean(data.preferences?.newsletter_enabled),
        digest_enabled: Boolean(data.preferences?.digest_enabled),
        story_notifications_enabled: Boolean(data.preferences?.story_notifications_enabled),
        like_notifications_frequency: normalizeEngagementNotificationFrequency(
          data.preferences?.like_notifications_frequency,
        ),
        comment_notifications_frequency: normalizeEngagementNotificationFrequency(
          data.preferences?.comment_notifications_frequency,
        ),
      };

      setEmail(typeof data.email === "string" ? data.email : "");
      setContext(typeof data.context === "string" ? data.context : null);
      setStorySubscriptionCount(Number(data.storySubscriptionCount ?? 0));
      setPreferences(nextPreferences);
      setInitialPreferences(nextPreferences);
      setStatus("ready");
    } catch (error) {
      console.error("Failed to load unsubscribe preferences", error);
      setStatus("invalid");
    }
  };

  const handleToggle = (key: TogglePreferenceKey) => {
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const handleSave = async () => {
    if (!token) return;
    setProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: {
          token,
          context,
          source: "preferences_page",
          reasonCode: reasonCode || null,
          reasonText: reasonText.trim() || null,
          preferences,
        },
      });

      if (error || !data?.success) {
        console.error("Failed to save unsubscribe preferences", error, data);
        setStatus("error");
        setProcessing(false);
        return;
      }

      setPreferences(data.preferences ?? preferences);
      setInitialPreferences(data.preferences ?? preferences);
      setReasonCode("");
      setReasonText("");
      setStatus("success");
    } catch (error) {
      console.error("Failed to save unsubscribe preferences", error);
      setStatus("error");
    }

    setProcessing(false);
  };

  const toggleCards = [
    {
      key: "newsletter_enabled" as const,
      title: lang === "it" ? "Appunti dalla barca" : "Notes from the boat",
      description:
        lang === "it"
          ? "Mail singole, annunci e campagne curate da BITE."
          : "One-off emails, announcements, and editorial campaigns from BITE.",
    },
    {
      key: "digest_enabled" as const,
      title: lang === "it" ? "Digest periodici" : "Periodic digests",
      description:
        lang === "it"
          ? "Raccolte settimanali o periodiche con gli articoli pubblicati."
          : "Weekly or periodic roundups of recently published articles.",
    },
    {
      key: "story_notifications_enabled" as const,
      title: lang === "it" ? "Aggiornamenti storie seguite" : "Followed story updates",
      description:
        lang === "it"
          ? "Nuovi articoli nelle storie a cui sei iscritto."
          : "New articles inside the stories you follow.",
    },
  ];
  const frequencyOptions = ENGAGEMENT_NOTIFICATION_FREQUENCIES.map((value) => ({
    value,
    label:
      lang === "it"
        ? {
            instant: "Una mail per ognuno",
            daily: "Recap giornaliero",
            weekly: "Recap settimanale",
            monthly: "Recap mensile",
            none: "Nessuna notifica",
          }[value]
        : {
            instant: "One email each",
            daily: "Daily digest",
            weekly: "Weekly digest",
            monthly: "Monthly digest",
            none: "No notifications",
          }[value],
  }));

  const reasonOptions: Array<{ value: ReasonCode; label: string }> = [
    {
      value: "too_many_emails",
      label: lang === "it" ? "Ricevo troppe email" : "Too many emails",
    },
    {
      value: "content_not_relevant",
      label: lang === "it" ? "Contenuti poco rilevanti" : "Content not relevant",
    },
    {
      value: "prefer_social",
      label: lang === "it" ? "Preferisco seguirvi sui social" : "I prefer social updates",
    },
    {
      value: "temporary_pause",
      label: lang === "it" ? "Voglio solo una pausa" : "I just want a pause",
    },
    {
      value: "signed_up_by_mistake",
      label: lang === "it" ? "Mi sono iscritto per errore" : "Signed up by mistake",
    },
    {
      value: "other",
      label: lang === "it" ? "Altro" : "Other",
    },
  ];

  return (
    <div className="min-h-screen px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <div className="glass-panel rounded-[34px] border border-black/6 bg-white/80 p-6 md:p-10 shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
          <p className="mb-3 text-xs font-sans uppercase tracking-[0.28em] text-muted-foreground">
            {lang === "it" ? "Preferenze Email" : "Email Preferences"}
          </p>
          <h1 className="editorial-heading text-3xl md:text-5xl leading-tight">
            {lang === "it" ? "Gestisci cosa vuoi ricevere." : "Choose what you want to receive."}
          </h1>
          <p className="mt-4 max-w-2xl text-sm md:text-base text-muted-foreground leading-relaxed">
            {lang === "it"
              ? "Il link dentro le email di BITE ora apre questa pagina dedicata: puoi disattivare solo alcune categorie invece di annullare tutto in blocco."
              : "The link inside BITE emails now opens this dedicated page so you can turn off only the categories you do not want instead of unsubscribing from everything at once."}
          </p>

          {status === "loading" && (
            <p className="mt-10 text-muted-foreground">
              {lang === "it" ? "Caricamento preferenze..." : "Loading preferences..."}
            </p>
          )}

          {status === "invalid" && (
            <div className="mt-10 rounded-[24px] border border-black/6 bg-white px-6 py-8 text-center">
              <p className="text-muted-foreground">
                {lang === "it" ? "Link non valido o non più disponibile." : "This link is invalid or no longer available."}
              </p>
            </div>
          )}

          {(status === "ready" || status === "success" || status === "error") && (
            <div className="mt-10 space-y-8">
              <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                <p className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                  {lang === "it" ? "Indirizzo gestito" : "Managed address"}
                </p>
                <p className="mt-2 text-base font-sans">{email}</p>
                {context ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {lang === "it" ? "Mail di origine" : "Email source"}: {context}
                  </p>
                ) : null}
                {storySubscriptionCount > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {lang === "it"
                      ? `Storie seguite con notifiche disponibili: ${storySubscriptionCount}`
                      : `Followed stories with available notifications: ${storySubscriptionCount}`}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4">
                {toggleCards.map((item) => {
                  const enabled = preferences[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleToggle(item.key)}
                      className={`rounded-[26px] border px-5 py-5 text-left transition-colors ${
                        enabled
                          ? "border-accent/30 bg-accent/10"
                          : "border-black/8 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-sans text-base font-medium text-foreground">{item.title}</p>
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                        <span
                          className={`mt-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-sans ${
                            enabled
                              ? "bg-accent text-accent-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {enabled ? (lang === "it" ? "ON" : "ON") : "OFF"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                  <p className="text-sm font-medium">
                    {lang === "it" ? "Notifiche like" : "Like notifications"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {lang === "it"
                      ? "Decidi se ricevere una mail per ogni like o un recap periodico."
                      : "Choose whether to receive one email per like or a periodic summary."}
                  </p>
                  <div className="mt-4">
                    <Select
                      value={preferences.like_notifications_frequency}
                      onValueChange={(value) =>
                        setPreferences((current) => ({
                          ...current,
                          like_notifications_frequency: normalizeEngagementNotificationFrequency(value),
                        }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-2xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {frequencyOptions.map((option) => (
                          <SelectItem key={`like-${option.value}`} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                  <p className="text-sm font-medium">
                    {lang === "it" ? "Notifiche commenti" : "Comment notifications"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {lang === "it"
                      ? "Gestisci la frequenza per nuovi commenti e risposte ai tuoi commenti."
                      : "Choose how often you want new comments and replies to your comments."}
                  </p>
                  <div className="mt-4">
                    <Select
                      value={preferences.comment_notifications_frequency}
                      onValueChange={(value) =>
                        setPreferences((current) => ({
                          ...current,
                          comment_notifications_frequency: normalizeEngagementNotificationFrequency(value),
                        }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-2xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {frequencyOptions.map((option) => (
                          <SelectItem key={`comment-${option.value}`} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-black/6 bg-white px-5 py-5">
                <label className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                  {lang === "it" ? "Perché stai cambiando queste preferenze?" : "Why are you changing these preferences?"}
                </label>
                <select
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value as ReasonCode | "")}
                  className="mt-3 w-full rounded-[18px] border border-black/8 bg-transparent px-4 py-3 text-sm font-sans focus:border-accent focus:outline-none"
                >
                  <option value="">{lang === "it" ? "Seleziona un motivo facoltativo" : "Select an optional reason"}</option>
                  {reasonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={reasonText}
                  onChange={(event) => setReasonText(event.target.value)}
                  rows={4}
                  className="mt-3 w-full rounded-[18px] border border-black/8 bg-transparent px-4 py-3 text-sm font-sans focus:border-accent focus:outline-none resize-y"
                  placeholder={
                    lang === "it"
                      ? "Se vuoi, raccontaci meglio il motivo."
                      : "If you want, tell us a bit more."
                  }
                />
              </div>

              <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {hasAnyEnabled
                    ? lang === "it"
                      ? "Almeno una categoria resta attiva, quindi continuerai a ricevere solo quel tipo di email."
                      : "At least one category stays enabled, so you will keep receiving only that type of email."
                    : lang === "it"
                      ? "Hai disattivato tutto: questo equivale a un opt-out completo da tutte le email BITE."
                      : "You turned everything off: this means a full opt-out from all BITE emails."}
                </p>
              </div>

              {status === "success" && (
                <div className="rounded-[24px] border border-accent/25 bg-accent/10 px-5 py-4 text-sm text-foreground">
                  {lang === "it"
                    ? "Preferenze aggiornate correttamente."
                    : "Your preferences were updated successfully."}
                </div>
              )}

              {status === "error" && (
                <div className="rounded-[24px] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                  {lang === "it"
                    ? "Non siamo riusciti a salvare le preferenze. Riprova."
                    : "We could not save your preferences. Please try again."}
                </div>
              )}

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <Link
                  to="/"
                  className="inline-flex items-center text-sm font-sans text-accent transition-colors hover:text-foreground"
                >
                  ← {lang === "it" ? "Torna alla home" : "Back to home"}
                </Link>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={processing || !hasChanges}
                  className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light disabled:opacity-50"
                >
                  {processing
                    ? lang === "it"
                      ? "Salvataggio..."
                      : "Saving..."
                    : lang === "it"
                      ? "Salva preferenze"
                      : "Save preferences"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Unsubscribe;
