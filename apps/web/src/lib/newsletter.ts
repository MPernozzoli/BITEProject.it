export const NEWSLETTER_MERGE_TAGS = [
  { token: "{{user_name}}", label: "Nome completo" },
  { token: "{{first_name}}", label: "Nome" },
  { token: "{{greeting_name}}", label: "Nome saluto" },
  { token: "{{user_email}}", label: "Email utente" },
  { token: "{{preferred_language}}", label: "Lingua preferita" },
  { token: "{{profile_url}}", label: "URL profilo" },
  { token: "{{unsubscribe_url}}", label: "URL disiscrizione" },
  { token: "{{site_url}}", label: "URL sito" },
  { token: "{{message_name}}", label: "Nome messaggio" },
  { token: "{{delivery_type}}", label: "Tipo invio" },
  { token: "{{event_type}}", label: "Evento automazione" },
  { token: "{{subscriber_source}}", label: "Sorgente iscrizione" },
  { token: "{{today}}", label: "Data ISO" },
  { token: "{{current_year}}", label: "Anno corrente" },
] as const;

const unavailableEdgeFunctions = new Set<string>();

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

export const isMissingSupabaseResourceError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const status = getErrorStatus(error);
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const details = "details" in error && typeof error.details === "string" ? error.details : "";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const hint = "hint" in error && typeof error.hint === "string" ? error.hint : "";
  const combined = `${message} ${details} ${hint}`.toLowerCase();

  return (
    status === 404 ||
    code === "42P01" ||
    code === "PGRST205" ||
    combined.includes("does not exist") ||
    combined.includes("could not find the table") ||
    combined.includes("relation") && combined.includes("does not exist")
  );
};

export const invokeOptionalNewsletterFunction = async <TData = unknown>(
  invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: TData | null; error: unknown }>,
  name: string,
  body: Record<string, unknown>,
) => {
  if (unavailableEdgeFunctions.has(name)) {
    return { data: null, error: null, unavailable: true };
  }

  const { data, error } = await invoke(name, { body });

  if (isMissingSupabaseResourceError(error)) {
    unavailableEdgeFunctions.add(name);
    return { data: null, error: null, unavailable: true };
  }

  return { data, error, unavailable: false };
};

export const normalizeOptionalSelectResult = <TRow>(
  result: { data: TRow[] | null; error: unknown },
) => {
  if (isMissingSupabaseResourceError(result.error)) {
    return { data: [] as TRow[], error: null, unavailable: true };
  }

  return {
    data: (result.data ?? []) as TRow[],
    error: result.error,
    unavailable: false,
  };
};

export type NewsletterBodyMode = "richtext" | "html";

export const renderNewsletterMergeTags = (
  template: string,
  variables: Record<string, string>
) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");

export const buildNewsletterPreviewVariables = (messageName: string, language: string) => ({
  user_name: "Massimo",
  first_name: "Massimo",
  greeting_name: "Massimo",
  user_email: "massimo@example.com",
  preferred_language: language,
  profile_url: "https://biteproject.it/profile/demo-user",
  unsubscribe_url: "https://biteproject.it/unsubscribe?token=demo",
  site_url: "https://biteproject.it",
  message_name: messageName || "Newsletter Demo",
  delivery_type: "campaign",
  event_type: "subscribed",
  subscriber_source: "profile",
  today: new Date().toISOString().slice(0, 10),
  current_year: String(new Date().getFullYear()),
});
