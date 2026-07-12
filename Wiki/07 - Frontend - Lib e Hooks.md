---
tags: [frontend, lib, hooks, logica]
---
# 07 - Frontend - Lib e Hooks

⬅️ [[Home]] · sorgente: `src/lib/`, `src/hooks/`, `src/integrations/`

## Hooks (`src/hooks/`)
- `useAuth.tsx` — `AuthProvider` + accesso sessione Supabase → [[08 - Supabase]]
- `useArticleReads.tsx` — conteggio letture articolo (live)
- `usePublicContentSnapshot.ts` — snapshot contenuti pubblici in cache
- `use-mobile.tsx` — breakpoint mobile
- `use-toast.ts` — API toast (shadcn)

## Integrazioni (`src/integrations/`)
- `supabase/client.ts` — istanza client Supabase (URL/key da env)
- `supabase/types.ts` — **tipi generati** dallo schema DB
- `lovable/index.ts` — auth cloud Lovable

## Lib per dominio (`src/lib/`)

### Auth & sessione
- `supabase-auth.ts`, `supabase-auth-storage.ts`, `admin-host.ts`, `visitor-key.ts`

### Articoli / contenuto editoriale
- `article-content.ts`, `article-cover.ts`, `article-media.tsx`, `article-slug.ts`
- `article-map.ts`, `article-map-anchor.ts` — geo articolo → [[14 - Mappe e Layer Geospaziale]]
- `article-instagram-story.ts` — export story IG
- `article-translation-gaps.ts`, `route-waypoint-translation-gaps.ts` — gap traduzioni IT/EN
- `content-images.ts`, `sanitize-rich-html.ts`, `editorial-plan.ts`, `public-content.ts`

### Booking & pagamenti → [[13 - Booking Voyage]] / [[11 - Pagamenti Bunq]]
- `booking-deposit.ts` — **calcolo contributo server-authoritative**
- `booking-payment.ts`, `booking-participants.ts`, `booking-utils.ts`
- `danger-reasons.ts` — modificatori navigazione pericolosa
- `voyage-utils.ts`

### Mappe → [[14 - Mappe e Layer Geospaziale]]
- `maplibre.ts`, `map-presence.ts`

### Newsletter / notifiche → [[12 - Newsletter ed Email]]
- `newsletter.ts`, `email-notification-preferences.ts`

### Profilo
- `profile-avatar.ts`, `profile-completeness.ts`

### SEO / i18n / infra
- `seo.ts`, `i18n.tsx` — traduzioni e rilevamento lingua → [[03 - Routing e i18n]]
- `pwa.ts` — service worker/PWA
- `boot-splash-3d.ts` — splash 3D con three.js (untracked, nuovo)
- `hero-ready-event.ts`, `utils.ts`, `translate-editor-content.ts`
- `admin-media-upload-queue.ts` — coda upload media admin

## Server helper (`src/server/`)
Usati dalle [[10 - API Vercel]]:
- `http.ts` — util richieste
- `bunq/` — `client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts` → [[11 - Pagamenti Bunq]]

## Collegamenti
- [[06 - Frontend - Componenti]] · [[08 - Supabase]]
