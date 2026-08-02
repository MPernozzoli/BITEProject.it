-- Schema campagne newsletter: le tre tabelle che mancavano, più le colonne
-- mancanti su newsletter_subscribers.
--
-- Contesto. Il cron `newsletter-dispatch` è schedulato ogni 5 minuti da
-- `20260725100000` ed è **già attivo in produzione**, ma falliva a ogni tick:
-- `newsletter_messages`, `newsletter_events` e `newsletter_deliveries` non
-- esistevano. Anche `newsletter_register_open`/`newsletter_register_click`
-- esistono già ma andavano in errore a runtime per lo stesso motivo (il corpo
-- di una funzione plpgsql non viene validato finché non la si chiama).
-- Questa migrazione chiude il buco: da qui in poi il cron ha su cosa lavorare.
--
-- Corrisponde a `@pynkstudio/newsletterapp/migrations/0001_newsletter_schema.sql`
-- limitato a ciò che manca davvero: le sette tabelle di iscrizione/preferenze
-- esistono già e non vengono toccate.

-- ============================================================================
-- newsletter_subscribers: colonne mancanti
-- ============================================================================
--
-- La disiscrizione e il webhook soppressioni scrivono già questi tre campi, ma
-- le colonne non esistevano: l'update falliva e veniva solo loggato, quindi la
-- riga del subscriber restava indietro rispetto alle preferenze. Additive e
-- nullable, nessun impatto sulle righe esistenti.

alter table public.newsletter_subscribers
  add column if not exists preferred_language text,
  add column if not exists source text,
  add column if not exists unsubscribed_at timestamptz;

-- Il runtime cerca il subscriber per email e assume che ce ne sia uno solo.
-- Verificato: nessun duplicato al momento dell'applicazione.
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (email);

-- ============================================================================
-- Messaggi autorati
-- ============================================================================

create table if not exists public.newsletter_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('campaign', 'automation')),
  status text not null default 'draft',
  automation_trigger text check (automation_trigger in ('subscribed', 'unsubscribed')),
  automation_delay_minutes integer not null default 0,
  scheduled_at timestamptz,
  sent_at timestamptz,
  last_queued_at timestamptz,
  from_name text,
  -- Una mappa JSON per campo, con chiave il codice lingua.
  subject_translations jsonb not null default '{}'::jsonb,
  preheader_translations jsonb not null default '{}'::jsonb,
  body_html_translations jsonb not null default '{}'::jsonb,
  body_json_translations jsonb not null default '{}'::jsonb,
  body_mode_translations jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists newsletter_messages_due_idx
  on public.newsletter_messages (kind, status, scheduled_at);

-- ============================================================================
-- Eventi e consegne
-- ============================================================================

-- Traccia iscrizione/disiscrizione. Le automazioni reagiscono alle righe non
-- ancora processate, per questo `processed_at` fa da cursore invece di
-- cancellare la riga.
create table if not exists public.newsletter_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references public.newsletter_subscribers(id) on delete set null,
  email text not null,
  event_type text not null check (event_type in ('subscribed', 'unsubscribed')),
  preferred_language text,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_note text
);

create index if not exists newsletter_events_pending_idx
  on public.newsletter_events (occurred_at)
  where processed_at is null;

create table if not exists public.newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  newsletter_message_id uuid not null references public.newsletter_messages(id) on delete cascade,
  newsletter_event_id uuid references public.newsletter_events(id) on delete set null,
  subscriber_id uuid references public.newsletter_subscribers(id) on delete set null,
  delivery_type text not null check (delivery_type in ('campaign', 'automation')),
  recipient_email text not null,
  recipient_language text not null,
  status text not null,
  -- Accoppiato all'id della delivery in ogni URL di tracking. Un click il cui
  -- token non corrisponde viene rifiutato: è ciò che impedisce alla route di
  -- click di diventare un open redirect sul dominio mittente.
  tracker_token text not null,
  message_id text not null,
  error_message text,
  open_count integer not null default 0,
  click_count integer not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  last_clicked_url text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Il lock di deduplica del dispatcher. Due run sovrapposti provano entrambi
-- l'insert; chi perde riceve 23505 e conta la consegna come saltata invece di
-- spedire due volte.
create unique index if not exists newsletter_deliveries_campaign_unique_idx
  on public.newsletter_deliveries (newsletter_message_id, recipient_email)
  where newsletter_event_id is null;

create unique index if not exists newsletter_deliveries_automation_unique_idx
  on public.newsletter_deliveries (newsletter_message_id, newsletter_event_id)
  where newsletter_event_id is not null;

create index if not exists newsletter_deliveries_message_idx
  on public.newsletter_deliveries (newsletter_message_id);

-- ============================================================================
-- RLS
-- ============================================================================
--
-- Solo sulle tre tabelle nuove: le altre hanno già RLS e policy proprie, che
-- questa migrazione non tocca. Nessuna policy qui — scrive solo il service
-- role, e la console admin legge con la sua sessione tramite le policy
-- esistenti sul resto dello schema.

alter table public.newsletter_messages enable row level security;
alter table public.newsletter_events enable row level security;
alter table public.newsletter_deliveries enable row level security;
