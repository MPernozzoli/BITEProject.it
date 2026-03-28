ALTER TABLE public.newsletter_subscribers
  ALTER COLUMN profile_id DROP NOT NULL;

UPDATE public.newsletter_subscribers
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

DO $$ BEGIN
  ALTER TABLE public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_key UNIQUE (email);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'it',
  ADD COLUMN source text NOT NULL DEFAULT 'profile',
  ADD COLUMN subscribed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN unsubscribed_at timestamptz,
  ADD COLUMN last_event_at timestamptz NOT NULL DEFAULT now();

UPDATE public.newsletter_subscribers ns
SET preferred_language = COALESCE(p.preferred_language, 'it')
FROM public.profiles p
WHERE ns.profile_id = p.id;

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_subscribed
  ON public.newsletter_subscribers(subscribed, preferred_language);

CREATE OR REPLACE FUNCTION public.normalize_newsletter_subscriber()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  NEW.preferred_language := COALESCE(NULLIF(trim(NEW.preferred_language), ''), 'it');

  IF TG_OP = 'INSERT' THEN
    NEW.last_event_at := COALESCE(NEW.last_event_at, now());

    IF NEW.subscribed THEN
      NEW.subscribed_at := COALESCE(NEW.subscribed_at, now());
      NEW.unsubscribed_at := NULL;
    ELSE
      NEW.unsubscribed_at := COALESCE(NEW.unsubscribed_at, now());
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.subscribed IS DISTINCT FROM OLD.subscribed THEN
    NEW.last_event_at := now();

    IF NEW.subscribed THEN
      NEW.subscribed_at := now();
      NEW.unsubscribed_at := NULL;
    ELSE
      NEW.unsubscribed_at := now();
    END IF;
  ELSE
    NEW.last_event_at := OLD.last_event_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_newsletter_subscriber ON public.newsletter_subscribers;
CREATE TRIGGER normalize_newsletter_subscriber
  BEFORE INSERT OR UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_newsletter_subscriber();

CREATE TABLE public.newsletter_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('campaign', 'automation')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'active', 'paused', 'archived')),
  automation_trigger text CHECK (automation_trigger IN ('subscribed', 'unsubscribed')),
  automation_delay_minutes integer NOT NULL DEFAULT 0 CHECK (automation_delay_minutes >= 0),
  scheduled_at timestamptz,
  last_queued_at timestamptz,
  sent_at timestamptz,
  from_name text NOT NULL DEFAULT 'BITE',
  reply_to text,
  audience_filter text NOT NULL DEFAULT 'subscribed' CHECK (audience_filter IN ('subscribed')),
  subject_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  preheader_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_html_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_json_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_messages_trigger_guard CHECK (
    (kind = 'automation' AND automation_trigger IS NOT NULL)
    OR (kind = 'campaign' AND automation_trigger IS NULL)
  )
);

ALTER TABLE public.newsletter_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage newsletter messages"
  ON public.newsletter_messages
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_newsletter_messages_updated_at
  BEFORE UPDATE ON public.newsletter_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_newsletter_messages_status_kind
  ON public.newsletter_messages(status, kind, scheduled_at DESC NULLS LAST);

CREATE TABLE public.newsletter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  email text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('subscribed', 'unsubscribed')),
  preferred_language text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_note text
);

ALTER TABLE public.newsletter_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage newsletter events"
  ON public.newsletter_events
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_newsletter_events_pending
  ON public.newsletter_events(processed_at, occurred_at DESC);

CREATE TABLE public.newsletter_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_message_id uuid NOT NULL REFERENCES public.newsletter_messages(id) ON DELETE CASCADE,
  newsletter_event_id uuid REFERENCES public.newsletter_events(id) ON DELETE SET NULL,
  subscriber_id uuid REFERENCES public.newsletter_subscribers(id) ON DELETE SET NULL,
  delivery_type text NOT NULL CHECK (delivery_type IN ('campaign', 'automation')),
  recipient_email text NOT NULL,
  recipient_language text NOT NULL DEFAULT 'it',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'suppressed', 'opened', 'clicked', 'skipped')),
  message_id text UNIQUE,
  tracker_token text NOT NULL UNIQUE,
  queue_name text NOT NULL DEFAULT 'transactional_emails',
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  click_count integer NOT NULL DEFAULT 0,
  last_clicked_url text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.newsletter_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage newsletter deliveries"
  ON public.newsletter_deliveries
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX idx_newsletter_deliveries_dedupe
  ON public.newsletter_deliveries (
    newsletter_message_id,
    recipient_email,
    COALESCE(newsletter_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_newsletter_deliveries_message_status
  ON public.newsletter_deliveries(newsletter_message_id, status, queued_at DESC);

CREATE INDEX idx_newsletter_deliveries_tracker
  ON public.newsletter_deliveries(id, tracker_token);

CREATE OR REPLACE FUNCTION public.handle_newsletter_subscription_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.subscribed THEN
      INSERT INTO public.newsletter_events (
        subscriber_id,
        email,
        event_type,
        preferred_language,
        payload
      )
      VALUES (
        NEW.id,
        NEW.email,
        'subscribed',
        NEW.preferred_language,
        jsonb_build_object(
          'source', COALESCE(NEW.source, 'unknown'),
          'profile_id', NEW.profile_id
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.subscribed IS DISTINCT FROM OLD.subscribed THEN
    INSERT INTO public.newsletter_events (
      subscriber_id,
      email,
      event_type,
      preferred_language,
      payload
    )
    VALUES (
      NEW.id,
      NEW.email,
      CASE WHEN NEW.subscribed THEN 'subscribed' ELSE 'unsubscribed' END,
      NEW.preferred_language,
      jsonb_build_object(
        'source', COALESCE(NEW.source, 'unknown'),
        'profile_id', NEW.profile_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_newsletter_subscription_event ON public.newsletter_subscribers;
CREATE TRIGGER handle_newsletter_subscription_event
  AFTER INSERT OR UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.handle_newsletter_subscription_event();

CREATE OR REPLACE FUNCTION public.sync_newsletter_subscriber_with_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.newsletter_subscribers
  SET
    email = lower(trim(COALESCE(NEW.email, email))),
    preferred_language = COALESCE(NEW.preferred_language, preferred_language)
  WHERE profile_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_newsletter_subscriber_with_profile ON public.profiles;
CREATE TRIGGER sync_newsletter_subscriber_with_profile
  AFTER UPDATE OF email, preferred_language ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_newsletter_subscriber_with_profile();

CREATE POLICY "Admins can manage newsletter subscribers"
  ON public.newsletter_subscribers
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_status_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_status_check
  CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'rate_limited'));

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'email_queue_service_role_key'
  ) THEN
    SELECT jobid
    INTO existing_job_id
    FROM cron.job
    WHERE jobname = 'dispatch-newsletter'
    LIMIT 1;

    IF existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job_id);
    END IF;

    PERFORM cron.schedule(
      'dispatch-newsletter',
      '* * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://vdflrzcmlipvtardannd.supabase.co/functions/v1/newsletter-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
            LIMIT 1
          )
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
