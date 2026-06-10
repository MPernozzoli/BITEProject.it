# Schema Inventory — Migrazione biteproject su Vercel

Inventario consolidato dei tre progetti Supabase, da unificare nel nuovo progetto `ekwloweuicrqjjgabfdp` (BITEProject.it, eu-west-2) con tre schemi separati: `public` (web), `pack`, `data`.

---

## Progetto 1 — WEB (`iubgicrwfovrnvoqr/`)

### Tabelle (38)

| Tabella | Colonne principali | PK | FK |
|---|---|---|---|
| `article_authors` | id, article_id, profile_id, role | id | article_id → logbook_articles, profile_id → profiles |
| `article_comments` | id, article_id, profile_id, content, parent_id, created_at | id | article_id → logbook_articles, parent_id → article_comments, profile_id → profiles |
| `article_likes` | id, article_id, profile_id, created_at | id | article_id → logbook_articles, profile_id → profiles |
| `article_read_events` | id, article_id, profile_id, visitor_key, counted_at | id | article_id → logbook_articles, profile_id → profiles (nullable) |
| `article_reads` | id, article_id, profile_id, read_at | id | article_id → logbook_articles, profile_id → profiles |
| `article_tags` | id, article_id, tag_id | id | article_id → logbook_articles, tag_id → tags |
| `comment_likes` | id, comment_id, profile_id, created_at | id | comment_id → article_comments, profile_id → profiles |
| `comment_mentions` | id, comment_id, mentioned_article_id, mentioned_profile_id | id | comment_id → article_comments, mentioned_article_id → logbook_articles, mentioned_profile_id → profiles (nullable) |
| `editorial_media_assets` | id, title, synopsis, storage_main_path, editorial_type, status | id | — |
| `editorial_plan_channels` | id, code, label, timezone, horizon_weeks, weekly_count, mix_* | id | — |
| `editorial_plan_settings` | id, horizon_weeks, weekly_count, mix_*, timezone | id | — |
| `editorial_plan_slots` | id, slot_date, slot_time, channel_id, assigned_article_id, template_id, status | id | channel_id → editorial_plan_channels, assigned_article_id → logbook_articles, template_id → editorial_plan_weekly_slots |
| `editorial_plan_weekly_slots` | id, channel_id, day_of_week, time_of_day, content_format, sort_order | id | channel_id → editorial_plan_channels |
| `editorial_publish_targets` | id, asset_id, channel_id, editorial_plan_slot_id, publish_at, status | id | asset_id → editorial_media_assets, channel_id → editorial_plan_channels, editorial_plan_slot_id → editorial_plan_slots |
| `email_notification_preferences` | email(PK), newsletter_enabled, digest_enabled, ... | email | — |
| `email_send_log` | id, message_id, template_name, recipient_email, status, error_message | id | — |
| `email_send_state` | id, retry_after_until, batch_size, send_delay_ms, *_ttl_minutes | id | — |
| `email_unsubscribe_tokens` | id, token, email, used_at | id | — |
| `engagement_notifications` | id, recipient_profile_id, actor_profile_id, article_id, comment_id, event_type, processed_at, read_at, emailed_at | id | recipient/actor → profiles, article_id → logbook_articles, comment_id → article_comments |
| `logbook_articles` | id, title_*, slug, excerpt_*, content_*, cover_image, category, status, published_at, story_id, voyage_id, voyage_waypoint_*_id, view_count, editorial_type, lat/lng, cover_focal_*, article_map_scenes | id | story_id → stories, voyage_id → voyages, voyage_waypoint_*_id → voyage_waypoints |
| `logbook_map_markers` | id(text), label_*, description_*, lat/lng, is_visible, is_onboard, updated_by | id | updated_by → profiles |
| `newsletter_confirmation_tokens` | id, email, token, profile_id, source, used_at, last_sent_at | id | profile_id → profiles |
| `newsletter_subscribers` | id, profile_id, email, subscribed, created_at | id | profile_id → profiles (1:1) |
| `newsletter_unsubscribe_feedback` | id, email, profile_id, source, reason_code, reason_text, scope | id | profile_id → profiles |
| `profile_badges` | id, profile_id, badge_name, badge_icon, awarded_at | id | profile_id → profiles |
| `profiles` | id, name, email, avatar_url, bio, preferred_language, secondary_language, social_* | id | — |
| `push_subscriptions` | id, profile_id, endpoint, auth, p256dh, expiration_time, enabled, user_agent | id | profile_id → profiles |
| `route_legs` | id, name, description, lat/lng start+end, nautical_miles, status, sort_order, started/completed_at, synced_at | id | — |
| `social_oauth_connections` | id, channel_id, provider, account_label, refresh_token_encrypted, scopes | id | channel_id → editorial_plan_channels (1:1) |
| `stories` | id, title_*, slug, description_*, cover_image | id | — |
| `story_subscriptions` | id, profile_id, story_id, created_at | id | profile_id → profiles, story_id → stories |
| `suppressed_emails` | id, email, reason, metadata | id | — |
| `system_email_automations` | key(PK), enabled, config, last_run_at, last_sent_at | key | — |
| `tags` | id, name, created_at | id | — |
| `user_roles` | id, user_id, role | id | — |
| `voyage_waypoints` | id, voyage_id, lat/lng, name_*, description_*, waypoint_type, sort_order, visibility_mode, media, date_*, event_* | id | voyage_id → voyages |
| `voyages` | id, name_*, description_*, start/end_date+time, status, type, sort_order, is_published, cached_geometry, waterway_autoroute, *_flex_days | id | — |

### Enums
- `app_role`: admin | moderator | user
- `article_editorial_type`: pillar | support | utility_reflection
- `article_status`: draft | scheduled | published
- `voyage_status`: planned | active | completed
- `voyage_type`: water | land

### Views
- `public_profiles` (proiezione su profiles)

### Funzioni SQL
- `has_role(_user_id, _role)`
- `increment_article_view_count(_article_id, _visitor_key)`
- `enqueue_email`, `delete_email`, `read_email_batch`, `move_to_dlq` (queue helpers)

### Edge Functions (30)
auth-email-hook, confirm-newsletter-subscription, contact-form-submit, dispatch-engagement-notifications, handle-email-suppression, handle-email-unsubscribe, my-newsletter-subscription, newsletter-dispatch, newsletter-subscribe, newsletter-track-click, newsletter-track-open, notify-article-publication, notify-story-subscribers, preview-transactional-email, process-email-queue, public-geo, public-llms, public-semantic, public-sitemap, publish-scheduled-articles, publish-social-queue, send-newsletter-digest, send-transactional-email, social-oauth-callback, social-oauth-start, translate-editor-content, update-my-profile, vapid-public-key

### Tabelle prive di migration locale (definite solo via Lovable UI)
article_authors, article_comments, article_likes, article_read_events, article_reads, article_tags, comment_likes, comment_mentions, engagement_notifications, newsletter_confirmation_tokens, newsletter_unsubscribe_feedback, profile_badges, push_subscriptions, story_subscriptions, suppressed_emails

→ schema canonico = `src/integrations/supabase/types.ts` + CSV header

---

## Progetto 2 — PACK (`godot-freyja-collective/`)

### Tabelle (1)
| Tabella | Colonne | PK | FK |
|---|---|---|---|
| `external_metrics_cache` | slug, source_url, payload(jsonb), fetched_at, created_at, updated_at | — | — |

### Edge Functions (1)
instagram-metrics

---

## Progetto 3 — DATA (`bite-data/`)

### Tabelle (3)
| Tabella | Colonne | PK | FK |
|---|---|---|---|
| `voyages` | id, name_*, description_*, start/end_*, status, type, sort_order, is_published, cached_geometry, synced_at | id | — |
| `voyage_waypoints` | id, voyage_id, lat/lng, name_*, description_*, waypoint_type, sort_order, visibility_mode, media, date_*, event_* | id | voyage_id → voyages |
| `route_legs` | id, name, description, lat/lng start+end, nautical_miles, status, sort_order, started/completed_at, synced_at | id | — |

### Enums
voyage_status, voyage_type — **identici a web**

### Funzioni / triggers
- `update_updated_at_column()` su voyages, route_legs

### Estensioni richieste
- `pg_cron`, `pg_net`

---

## Conflitti & decisioni aperte

### ⚠️ DATA == sottoinsieme di WEB
Le tabelle di `data` (voyages, voyage_waypoints, route_legs) hanno **struttura quasi identica** a quelle di `web`. `data` aggiunge solo `synced_at` e omette `waterway_autoroute`/`*_flex_days`.

→ **Decisione critica**: vedi domanda al termine del documento.

### FK cross-schema
Solo `web` ha FK interne. `pack` e `data` sono indipendenti — niente FK verso `public`.

### Estensioni Postgres
- `pg_cron`, `pg_net` (richieste da `data`, utili anche per `web` queue/cron)

---

## Mappatura target proposta

| Schema | Tabelle |
|---|---|
| **public** | tutte le 38 tabelle di web |
| **pack** | external_metrics_cache |
| **data** | voyages, voyage_waypoints, route_legs (dataset isolato, no sync con public) |

**Decisione confermata:**
- `data` è un dataset realmente separato → schema `data` con tabelle proprie, nessuna sincronizzazione con `public.voyages`
- Auth unificata: `auth.users` condivisa tra web/pack/data, `public.profiles` referenziata da tutte le app

## Ordine import dati (rispetto FK)

1. **public** (in ordine):
   1. profiles, user_roles, tags, stories
   2. voyages → voyage_waypoints
   3. route_legs
   4. logbook_articles (FK → stories, voyages, voyage_waypoints)
   5. article_authors, article_tags, article_reads, article_read_events
   6. article_comments → comment_likes, comment_mentions, article_likes
   7. engagement_notifications, profile_badges, push_subscriptions, story_subscriptions
   8. newsletter_subscribers, newsletter_confirmation_tokens, newsletter_unsubscribe_feedback
   9. email_send_log, email_send_state, email_notification_preferences, email_unsubscribe_tokens, suppressed_emails
   10. system_email_automations
   11. logbook_map_markers
   12. editorial_plan_channels → editorial_plan_settings, editorial_plan_weekly_slots, editorial_plan_slots, editorial_publish_targets, editorial_media_assets
   13. social_oauth_connections

2. **pack**: external_metrics_cache (indipendente)

3. **data**: dipende dalla decisione (vedi sotto)

## Note operative
- Durante import: `ALTER TABLE ... DISABLE TRIGGER ALL`, poi riabilita
- RLS: applicare policy DOPO l'import, non prima
- Sequenze: tutti i PK sono UUID — no problemi di sequence reset
- Lovable Cloud auth → Supabase Auth standard (auth.users referenced by profiles.id)
