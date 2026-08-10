-- Guest article comments: name + email + text without an account. The
-- comment is held as "pending" (not in article_comments, never publicly
-- readable) until the author verifies that email through the existing OTP
-- login/signup flow. On verification every pending comment for that email
-- is claimed into article_comments under the freshly authenticated profile.
-- Comments always stay authored by a real, verified profile_id — there is
-- no unverified/guest row in article_comments itself.

CREATE TABLE IF NOT EXISTS public.pending_article_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.logbook_articles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.article_comments(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text NOT NULL,
  content text NOT NULL,
  client_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_article_comments_email_idx
  ON public.pending_article_comments (lower(guest_email));
CREATE INDEX IF NOT EXISTS pending_article_comments_article_idx
  ON public.pending_article_comments (article_id);

ALTER TABLE public.pending_article_comments ENABLE ROW LEVEL SECURITY;

-- No policies: written/read exclusively through the SECURITY DEFINER
-- functions below, so a pending comment is never visible to anyone
-- (including its own author) before it is claimed into article_comments.
REVOKE ALL ON TABLE public.pending_article_comments FROM PUBLIC, anon, authenticated;

-- 1. Single entry point for posting a comment: authenticated readers insert
--    straight into article_comments as before; everyone else is held as
--    pending, keyed by the email they typed.
CREATE OR REPLACE FUNCTION public.submit_article_comment(
  _article_id uuid,
  _content text,
  _parent_id uuid DEFAULT NULL,
  _guest_name text DEFAULT NULL,
  _guest_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid := auth.uid();
  v_content text := btrim(coalesce(_content, ''));
  v_name text;
  v_email text;
  v_id uuid;
  v_client_token uuid;
BEGIN
  IF v_content = '' OR length(v_content) > 4000 THEN
    RAISE EXCEPTION 'invalid content' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.logbook_articles a
    WHERE a.id = _article_id AND a.status = 'published'
  ) THEN
    RAISE EXCEPTION 'article not found' USING ERRCODE = '22023';
  END IF;

  IF _parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.article_comments c
    WHERE c.id = _parent_id AND c.article_id = _article_id
  ) THEN
    RAISE EXCEPTION 'invalid parent comment' USING ERRCODE = '22023';
  END IF;

  IF v_profile IS NOT NULL THEN
    INSERT INTO public.article_comments (article_id, profile_id, parent_id, content)
    VALUES (_article_id, v_profile, _parent_id, v_content)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('status', 'published', 'comment_id', v_id);
  END IF;

  v_name := nullif(btrim(coalesce(_guest_name, '')), '');
  v_email := lower(nullif(btrim(coalesce(_guest_email, '')), ''));

  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'valid name required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR position('@' in v_email) <= 1 THEN
    RAISE EXCEPTION 'valid email required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.consume_rate_limit('guest_article_comment_email', v_email, 5, 3600) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '22023';
  END IF;
  IF NOT public.consume_rate_limit('guest_article_comment_article', _article_id::text, 40, 3600) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pending_article_comments (article_id, parent_id, guest_name, guest_email, content)
  VALUES (_article_id, _parent_id, v_name, v_email, v_content)
  RETURNING id, client_token INTO v_id, v_client_token;

  RETURN jsonb_build_object(
    'status', 'pending',
    'pending_id', v_id,
    'client_token', v_client_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_article_comment(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_article_comment(uuid, text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_article_comment(uuid, text, uuid, text, text) TO authenticated;

-- 2. Called right after a successful login/signup: claims every pending
--    comment left under the now-verified email into article_comments. Each
--    claimed comment keeps its pending_article_comments.id as its final
--    article_comments.id — the client already has that id (submit_article_comment
--    returned it as pending_id), so once claimed elsewhere (e.g. the email link
--    opened on a different device) any browser can recognize its own pending
--    card as resolved just by checking whether that id now exists in
--    article_comments, with no extra correlation state to invent. parent_id on
--    a pending row always already points at a real, published article_comments
--    row (submit_article_comment only accepts an existing comment as parent),
--    so reusing the id needs no remapping. Also covers the lazy profile-row
--    creation every other auth-adjacent RPC in this project already does,
--    since a brand new signup has no profiles row yet.
CREATE OR REPLACE FUNCTION public.claim_pending_article_comments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid := auth.uid();
  v_email text;
  v_count integer := 0;
  v_article_ids uuid[];
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_profile) THEN
    INSERT INTO public.profiles (id, email, name)
    SELECT
      u.id,
      coalesce(u.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Guest'
      )
    FROM auth.users u
    WHERE u.id = v_profile
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT lower(coalesce(u.email, '')) INTO v_email
  FROM auth.users u
  WHERE u.id = v_profile;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('published_count', 0, 'article_ids', '[]'::jsonb);
  END IF;

  WITH claimed AS (
    INSERT INTO public.article_comments (id, article_id, profile_id, parent_id, content, created_at)
    SELECT p.id, p.article_id, v_profile, p.parent_id, p.content, p.created_at
    FROM public.pending_article_comments p
    WHERE lower(p.guest_email) = v_email
    RETURNING id, article_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT article_id), '{}')
  INTO v_count, v_article_ids
  FROM claimed;

  DELETE FROM public.pending_article_comments WHERE lower(guest_email) = v_email;

  RETURN jsonb_build_object(
    'published_count', v_count,
    'article_ids', coalesce(to_jsonb(v_article_ids), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_article_comments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_article_comments() TO authenticated;
