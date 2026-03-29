ALTER TABLE public.newsletter_messages
  ADD COLUMN body_mode_translations jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.newsletter_messages
SET body_mode_translations = COALESCE(
  (
    SELECT jsonb_object_agg(
      key,
      CASE
        WHEN COALESCE(body_json_translations -> key, 'null'::jsonb) <> 'null'::jsonb
          THEN 'richtext'
        ELSE 'html'
      END
    )
    FROM jsonb_object_keys(COALESCE(body_html_translations, '{}'::jsonb) || COALESCE(body_json_translations, '{}'::jsonb)) AS key
  ),
  '{}'::jsonb
)
WHERE body_mode_translations = '{}'::jsonb;
