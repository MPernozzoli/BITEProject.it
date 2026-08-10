-- Linter flagged slugify_text (20260809120000) for a mutable search_path.
-- It only calls built-ins (lower/translate/regexp_replace), so there's no
-- real hijack risk, but pin it anyway to match every other function here.
CREATE OR REPLACE FUNCTION public.slugify_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(
      regexp_replace(
        regexp_replace(
          lower(
            translate(
              value,
              'àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ',
              'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    'voyage'
  );
$$;
