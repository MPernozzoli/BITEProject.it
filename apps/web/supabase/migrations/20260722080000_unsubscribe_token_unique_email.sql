-- Every transactional email needs an unsubscribe token, looked up / created per recipient by
-- send-transactional-email with:
--   .upsert({ email, token }, { onConflict: 'email' })      -- create-if-missing
--   .eq('email', ...).maybeSingle()                         -- read-back
--
-- Both require a UNIQUE constraint on `email`, but the table only had unique(id) and unique(token).
-- So creating a token for a *new* recipient failed ("Failed to create unsubscribe token") and the
-- email was dropped. Recipients who already had a token (the admin, from earlier sends) reused it
-- and their mail went out — which is exactly why admins received notifications and applicants did not.
--
-- The app always writes the address lowercased (normalizedEmail), so a plain unique(email) is correct
-- and is what PostgREST's onConflict:'email' resolves against. No duplicate emails exist today, so
-- the index builds without conflict.

create unique index if not exists email_unsubscribe_tokens_email_key
  on public.email_unsubscribe_tokens (email);
