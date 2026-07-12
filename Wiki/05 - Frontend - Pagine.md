---
tags: [frontend, pagine, routing]
---
# 05 - Frontend - Pagine

⬅️ [[Home]] · sorgente: `src/pages/` · routing: [[03 - Routing e i18n]]

Tutte le pagine sono **lazy-loaded** in `src/App.tsx`.

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

## Newsletter / legali → [[12 - Newsletter ed Email]]
| Pagina | Rotta |
|---|---|
| `NewsletterConfirm.tsx` | `/newsletter/confirm` |
| `Unsubscribe.tsx` | `/unsubscribe` |
| `PrivacyPolicy.tsx` | `/privacy-policy` |
| `CookiePolicy.tsx` | `/cookie-policy` |

## Admin → [[16 - Admin]]
| Pagina | Rotta |
|---|---|
| `AdminLogin.tsx` | `/admin/login` |
| `AdminDashboard.tsx` | `/admin` |
| `AdminVoyageBookings.tsx` | `/admin/bookings` |
| `AdminMedia.tsx` | `/admin/media` |
| `AdminMapPresence.tsx` | `/admin/trackers` |
| `ArticleEditor.tsx` | `/admin/article/:id` |
| `AdminProfile.tsx` | `/profile` |

## Collegamenti
- Componenti usati: [[06 - Frontend - Componenti]]
- Logica condivisa: [[07 - Frontend - Lib e Hooks]]
