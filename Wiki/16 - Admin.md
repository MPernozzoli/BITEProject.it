---
tags: [admin, cms, backoffice]
---
# 16 - Admin

⬅️ [[Home]] · sorgente: `src/pages/Admin*`, `src/components/admin/`

## Accesso
- Servito sul **sottodominio** `admin.biteproject.it`; rilevamento host in `src/lib/admin-host.ts` (`isCurrentAdminHostname()`).
- Rotte protette da `AdminRoute.tsx` → [[03 - Routing e i18n]].
- Login: `/admin/login` (`AdminLogin.tsx`).

## Pagine admin → [[05 - Frontend - Pagine]]
| Rotta | Pagina | Funzione |
|---|---|---|
| `/admin` | `AdminDashboard.tsx` | dashboard |
| `/admin/bookings` | `AdminVoyageBookings.tsx` | prenotazioni viaggi → [[13 - Booking Voyage]] |
| `/admin/media` | `AdminMedia.tsx` | libreria media/storage |
| `/admin/trackers` | `AdminMapPresence.tsx` | presenza su mappa → [[14 - Mappe e Layer Geospaziale]] |
| `/admin/article/:id` | `ArticleEditor.tsx` | editor articolo (TipTap) |
| `/profile` | `AdminProfile.tsx` | profilo |

## Componenti admin (`src/components/admin/`)
- **Editoriale:** `AdminEditorialPlan`, `AdminEditorialPlanSettingsDialog`, `AdminEditorialPlanSlotDialog` (piano editoriale) → `src/lib/editorial-plan.ts`
- **Viaggi/rotte:** `AdminVoyageManager`, `AdminRouteManager`, `ArticleMiniMapEditor`, `AdminMapPresenceManager`
- **Newsletter:** `AdminNewsletterManager` → [[12 - Newsletter ed Email]]
- **Altri:** `AdminBadgeManager`, `AdminCollapsibleListFilters`
- Coda upload media: `src/lib/admin-media-upload-queue.ts`

## Editor articoli
- Basato su **TipTap 3** ([[02 - Stack Tecnologico]]): heading, image, link, youtube, text-align, color, underline, placeholder.
- Sanitizzazione: `src/lib/sanitize-rich-html.ts` (dompurify).
- Traduzione IT/EN: `translate-editor-content` ([[09 - Edge Functions]]) + `src/lib/translate-editor-content.ts`; gap traduzioni evidenziati da `article-translation-gaps.ts`.
- Export Instagram story: `src/lib/article-instagram-story.ts`.

## SEO
Le rotte admin sono marcate `noindex, nofollow` in `vercel.json` → [[18 - Deploy e Configurazione]].

## Collegamenti
- [[13 - Booking Voyage]] · [[12 - Newsletter ed Email]] · [[17 - Content Model]]
