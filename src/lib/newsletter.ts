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
