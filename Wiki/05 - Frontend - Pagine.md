---
tags: [frontend, pagine, routing]
---
# 05 - Frontend - Pagine

⬅️ [[Home]] · sorgente: `apps/web/src/pages/` · routing: [[03 - Routing e i18n]]

Tutte le pagine sono **lazy-loaded** in `apps/web/src/App.tsx`.

## Sito editoriale pubblico
| Pagina | Rotta | Descrizione |
|---|---|---|
| `Index.tsx` | `/it` `/en` | Home / landing |
| `About.tsx` | `crew` | "The Crew" — presentazione equipaggio |
| `Manifesto.tsx` | `manifesto` | Manifesto del progetto |
| `Journal.tsx` | `logbook` | Indice logbook/articoli |
| `ArticlePage.tsx` | `logbook/:slug` | Articolo singolo (con mappa, related) |
| `StoryPage.tsx` | `logbook/story/:slug` | Racconto/story |
| `Voyages.tsx` | `voyages` | Elenco viaggi |
| `VoyagePage.tsx` | `voyages/:voyageRef` | Dettaglio viaggio + mappa rotta |
| `Collaborations.tsx` | `collaborations` | Collaborazioni |
| `Contact.tsx` | `contact` | Form contatti → [[09 - Edge Functions\|contact-form-submit]] |
| `Links.tsx` | `links` | Pagina linktree |
| `NotFound.tsx` | `*` | 404 |

## Area utente / booking → [[13 - Booking Voyage]]
| Pagina | Rotta |
|---|---|
| `UserLogin.tsx` | `/login`, `/signup` |
| `CompleteProfile.tsx` | `/complete-profile` |
| `PublicProfile.tsx` | `/profile/:id` |
| `UserBookings.tsx` | `/bookings` |
| `ManageBookingParticipants.tsx` | `/bookings/:id/participants` |

`UserBookings.tsx` mostra, per booking confermati, la sezione **Mail briefing** divisa in primo briefing e secondo briefing operativo; la seconda scheda include anche la visualizzazione delle prese tipo L/F presenti a bordo.

## Newsletter / legali → [[12 - Newsletter ed Email]]
| Pagina | Rotta | Note |
|---|---|---|
| `NewsletterConfirm.tsx` | `/newsletter/confirm` | conferma iscrizione newsletter |
| `Unsubscribe.tsx` | `/unsubscribe` | gestione disiscrizione/preferenze email |
| `PrivacyPolicy.tsx` | `/privacy-policy` | informativa aggiornata per community, newsletter, contact form, partecipazione viaggi, inviti partecipanti, contributi spese, Bunq/bonifico e Web Push |
| `CookiePolicy.tsx` | `/cookie-policy` | cookie/local storage tecnici per lingua, sessione, community, booking, pagamenti, UI e notifiche push |

## Admin → [[16 - Admin]]
| Pagina | Rotta |
|---|---|
| `AdminLogin.tsx` | `/admin/login` |
| `AdminDashboard.tsx` | `/admin` |
| `AdminVoyageBookings.tsx` | `/admin/bookings` |
| `AdminVoyageCandidates.tsx` | `/admin/candidates` |
| `AdminMedia.tsx` | `/admin/media` |
| `AdminMail.tsx` | `/admin/mail` |
| `AdminMapPresence.tsx` | `/admin/trackers` |
| `ArticleEditor.tsx` | `/admin/article/:id` |
| `AdminProfile.tsx` | `/profile` |

`AdminMail.tsx` mantiene la lista messaggi pulita senza badge dominio/routing, con header compatto e ricerca per mittente/destinatario/corpo/data. Mostra il nome mittente quando disponibile o inferibile dalla firma e usa l'indirizzo solo come fallback. L'anteprima usa solo il testo nuovo prima del thread citato; nel corpo le citazioni restano collassabili con azioni "Mostra di più da..." / "Nascondi".

`AdminVoyageBookings.tsx` nella sezione settings gestisce i contenuti bilingue delle due mail briefing viaggio (`first_briefing_content_*`, `second_briefing_content_*`) oltre a prepartenza, note operative e checklist.

Su iPhone/PWA, `Layout.tsx` aggiunge un dock mobile admin persistente su `/admin/*` e `/profile` per utenti con ruolo admin. Le pagine secondarie e il profilo hanno quindi sempre un link diretto alla Home admin (`/admin`) e alle altre aree operative.

`AdminDashboard.tsx` usa una gerarchia da workspace: CTA primaria per nuovo articolo, shortcut solo per aree operative frequenti, KPI editoriali e navigazione interna per gruppi Contenuti/Operazioni/Audience. Il Profilo resta fuori dagli shortcut principali perché già coperto dalla propic e dal dock mobile.

## Collegamenti
- Componenti usati: [[06 - Frontend - Componenti]]
- Logica condivisa: [[07 - Frontend - Lib e Hooks]]
