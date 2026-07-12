---
tags: [admin, cms, backoffice]
---
# 16 - Admin

⬅️ [[Home]] · sorgente: `apps/web/src/pages/Admin*`, `apps/web/src/components/admin/`

## Accesso
- Servito sul **sottodominio** `admin.biteproject.it`; rilevamento host in `apps/web/src/lib/admin-host.ts` (`isCurrentAdminHostname()`).
- Rotte protette da `AdminRoute.tsx` → [[03 - Routing e i18n]].
- Login: `/admin/login` (`AdminLogin.tsx`).

## Pagine admin → [[05 - Frontend - Pagine]]
| Rotta | Pagina | Funzione |
|---|---|---|
| `/admin` | `AdminDashboard.tsx` | dashboard |
| `/admin/bookings` | `AdminVoyageBookings.tsx` | prenotazioni viaggi → [[13 - Booking Voyage]] |
| `/admin/candidates` | `AdminVoyageCandidates.tsx` | revisione candidature viaggio: profilo pubblico, info candidato, Gantt di contesto, approva/scarta o propone tratte alternative con messaggio → [[13 - Booking Voyage]] |
| `/admin/media` | `AdminMedia.tsx` | libreria media/storage |
| `/admin/mail` | `AdminMail.tsx` | casella di posta ordinaria `@biteproject.it` e automatiche `@mail.biteproject.it` → [[12 - Newsletter ed Email]] |
| `/admin/trackers` | `AdminMapPresence.tsx` | presenza su mappa → [[14 - Mappe e Layer Geospaziale]] |
| `/admin/article/:id` | `ArticleEditor.tsx` | editor articolo (TipTap) |
| `/profile` | `AdminProfile.tsx` | profilo |

## Componenti admin (`apps/web/src/components/admin/`)
- **Editoriale:** `AdminEditorialPlan`, `AdminEditorialPlanSettingsDialog`, `AdminEditorialPlanSlotDialog` (piano editoriale) → `apps/web/src/lib/editorial-plan.ts`
- **Viaggi/rotte:** `AdminVoyageManager`, `AdminRouteManager`, `ArticleMiniMapEditor`, `AdminMapPresenceManager`
- **Newsletter:** `AdminNewsletterManager` → [[12 - Newsletter ed Email]]
- **Mail:** `AdminMail.tsx` vive tra le pagine admin perché integra lista, dettaglio e compose su API Vercel. La UI privilegia mittente, oggetto e preview rispetto ai badge tecnici, e collassa le citazioni nel corpo mail con controlli espandi/nascondi.
- **Booking:** `BookingGanttTable.tsx` resta focalizzato sulla matrice tratte/persone ed è una superficie operativa admin: consente di aggiungere su una tratta utenti registrati oppure **Altri...** con email esterna; in questo secondo caso crea una partecipazione pending e invia il template `voyage-participant-invite`. Il drag/resize di una booking esistente genera una proposta `voyage_booking_plan_changes` con messaggio admin e notifica utente, non una modifica definitiva immediata → [[13 - Booking Voyage]].
- **Candidati:** `AdminVoyageCandidates.tsx` separa la revisione qualitativa dalla matrice Gantt operativa: mostra profilo pubblico, foto, link social, risposte `candidate_info`, tratte richieste e una Gantt di contesto per vedere inserimento e compresenze. Le modifiche dalla Gantt candidato sono solo proposte pending via RPC `admin_propose_voyage_booking_legs`; approvazione, scarto e proposta possono includere un messaggio admin per l'utente.
- **Altri:** `AdminBadgeManager`, `AdminCollapsibleListFilters`
- Coda upload media: `apps/web/src/lib/admin-media-upload-queue.ts`

## Editor articoli
- Basato su **TipTap 3** ([[02 - Stack Tecnologico]]): heading, image, link, youtube, text-align, color, underline, placeholder.
- Sanitizzazione: `apps/web/src/lib/sanitize-rich-html.ts` (dompurify).
- Traduzione IT/EN: `translate-editor-content` ([[09 - Edge Functions]]) + `apps/web/src/lib/translate-editor-content.ts`; gap traduzioni evidenziati da `article-translation-gaps.ts`.
- Export Instagram story: `apps/web/src/lib/article-instagram-story.ts`.

## SEO
Le rotte admin sono marcate `noindex, nofollow` in `vercel.json` → [[18 - Deploy e Configurazione]].

## Collegamenti
- [[13 - Booking Voyage]] · [[12 - Newsletter ed Email]] · [[17 - Content Model]]
