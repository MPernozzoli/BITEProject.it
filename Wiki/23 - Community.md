---
tags: [community, membership, sub-app, pagamenti, booking]
---
# 23 - Community

⬅️ [[Home]]

## Stato implementazione

Implementazione iniziale completata e isolata:

- sub-app Vite `apps/crew` (`@biteproject/crew`) servita con base `/Crew/`;
- sottodominio previsto `crew.biteproject.it`, riscritto a `/Crew` da `middleware.ts`/`apps/web/middleware.ts`;
- nessun link aggiunto alla navbar o alle rotte dell'app principale;
- `robots: noindex,nofollow` su `/Crew/*`;
- stesso account Supabase tramite storage auth condiviso su `.biteproject.it`;
- login centralizzato su `login.biteproject.it`; `/login` e `/signup` nella sub-app sono bridge verso l'host auth dedicato;
- design system importato da `apps/web/src/index.css`, come fa `apps/data`;
- editor admin `/studio` e `/studio/:id` con TipTap/RichTextEditor derivato dalla creazione articoli;
- feed `/`, dettaglio `/post/:slug`, commenti realtime e reaction;
- live thread `/live` con messaggi realtime e moderazione admin;
- LiveKit predisposto per room video/audio/stage dei live, con token firmati server-side da `/api/community/livekit-token`;
- poll `/polls` con voting member-only, risultati aggregati e form admin;
- home `/` come vetrina per utenti anonimi/non abbonati e feed reale protetto su `/feed`;
- canali/subfeed `community_channels` con accesso opzionalmente limitato per tier;
- gestione Crew Pass spostata nel profilo principale `/profile` (`/profilo` redirect), riusando `profiles`;
- governance operativa in admin (`/admin?section=community`) per prezzi, ruoli moderator, live, membership e pagamenti recenti;
- endpoint Bunq membership in [[10 - API Vercel]];
- migrazioni applicate sul progetto Supabase remoto; advisor filtrati sul dominio community puliti.

## Nome

**BITE Crew**.

Motivo: è breve, internazionale, coerente con barca/viaggio/equipaggio, e non suona come un clone di Patreon. Dice subito che non stai comprando un contenuto, stai entrando piu vicino alla crew. Funziona bene anche sul sottodominio: `crew.biteproject.it`.

Alternative valide:

| Nome | Pro | Contro |
|---|---|---|
| **BITE Crew** | chiaro, umano, bilingue, adatto a membership e viaggi | un po' generico se in futuro esistono anche ruoli crew operativi |
| **Spritz Crew** | piu legato alla barca, caldo e memorabile | se cambia barca o il progetto cresce oltre Spritz diventa stretto |
| **BITE Circle** | community/patrons senza tono nautico forzato | meno distintivo rispetto al progetto a vela |
| **BITE Backstage** | ottimo per contenuti dietro le quinte | riduttivo: copre peggio benefici viaggio e interazione |
| **BITE Quay** | poetico, luogo di incontro | meno immediato in italiano e per utenti non nautici |

Scelta implementata: **BITE Crew** come prodotto e **Crew Pass** come nome dell'abbonamento.

## Posizionamento

La community non deve essere solo un paywall. Deve diventare la quarta superficie del prodotto, accanto a:

1. sito editoriale pubblico;
2. area utente/booking;
3. admin;
4. **BITE Crew** su `crew.biteproject.it`.

Promessa: accesso piu vicino alla vita reale del progetto, con aggiornamenti live, conversazioni dirette, anteprime e vantaggi concreti sui viaggi, senza trasformare BITE in un prodotto turistico/charter.

Copy guida:
- preferire **membro**, **Crew Pass**, **sostieni il progetto**, **accesso anticipato**, **contributo ridotto/agevolato**;
- evitare **cliente**, **biglietto**, **tariffa**, **pacchetto turistico**, **charter**, **quota fissa viaggio gratuita** se il benefit tocca le prenotazioni.

## Tier iniziali

| Tier | Prezzo indicativo | Accesso | Benefit viaggio |
|---|---:|---|---|
| **Deck / Base** | 3 €/mese · 30 €/anno | feed riservato, commenti, poll, aggiornamenti live testuali | `early_access_hours = 24` |
| **Wake / Intermedio** | 5 €/mese · 50 €/anno | tutto Deck + live chat, Q&A e contenuti lunghi | `early_access_hours = 72` |
| **Harbor / Top** | 10 €/mese · 100 €/anno | tutto Wake + live room prioritarie, briefing privati e benefit viaggio accessori | `early_access_hours = 168`, `waive_fixed_minimum_cents = 2000` |

Ogni tier esiste come variante mensile e annuale (`billing_interval = month|year`) e può essere pagato per 1, 2 o 3 periodi alla volta. Non esistono rinnovi automatici: è una scelta di design esplicita. BITE non vuole addebiti dimenticati; il membro riceve un promemoria e rinnova solo se vuole continuare a far parte dell'equipaggio.

Regola consigliata per i viaggi: non azzerare il contributo per NM e complessita, perche quello rappresenta spese vive ripartite. Il benefit membership puo invece:
- eliminare/ridurre il minimo fisso da 20 euro;
- aprire candidature prima del pubblico;
- abilitare notifiche prioritarie;
- mostrare briefing o dettagli logistici in anticipo;
- applicare una priorita amministrativa dichiarata ma non automatica, perche la partecipazione resta soggetta a idoneita, sicurezza e composizione equipaggio.

## Architettura prodotto

### Hosting

`crew.biteproject.it` è una sub-app Vite dedicata in `apps/crew`, servita dallo stesso deploy Vercel con rewrite verso `/Crew`, come gia avviene per `pack.biteproject.it` e `data.biteproject.it`.

Tecnica:
- cartella: `apps/crew`;
- package: `@biteproject/crew`;
- build base path: `/Crew/`;
- sottodominio: `crew.biteproject.it` riscritto a `/Crew`;
- stesso Supabase project;
- stesso design system di `apps/web`, come `apps/data`, per evitare drift visivo.

### Auth

Usare lo stesso account Supabase del sito principale:
- login passwordless, OAuth e passkey restano centralizzati su `login.biteproject.it`;
- profilo unico in `profiles`;
- preferenze lingua riusate;
- avatar/bio/link social riusabili nella community;
- completamento profilo richiesto solo per funzioni dove serve identita reale o booking.

Per WebAuthn/passkey va mantenuto il principio gia documentato: i flussi sensibili partono dall'host auth dedicato, che deve essere compatibile con Relying Party ID e origins Supabase configurate. La sub-app usa `redirectToLogin()` per tornare al post/feed/studio originario dopo l'accesso.

### Dati membership

Tabelle:

| Tabella | Scopo |
|---|---|
| `membership_tiers` | definizione tier, prezzo, valuta, visibilita, ordinamento, benefit JSONB |
| `membership_subscriptions` | stato membership per profilo: tier, status, periodo, reminder rinnovo/scadenza |
| `membership_payments` | richieste Bunq/bonifico, stato pagamento, importi, `period_count` 1-3 e audit |
| `membership_benefit_events` | audit dei benefit applicati, es. early access o riduzione minimo fisso |
| `community_channels` | canali/subfeed stile Reddit con slug, ordine, stato attivo e accesso per tier |
| `community_posts` | contenuti riservati, con visibilita per tier, tipo post e canale |
| `community_comments` | thread/commenti sui post |
| `community_reactions` | reaction semplici senza appesantire il modello |
| `community_live_events` | finestre live, Q&A, aggiornamenti in tempo reale |
| `community_live_messages` | messaggi realtime dei live event, moderabili |
| `community_polls` | domande/poll per input dei membri, opzionalmente legati a post |
| `community_poll_options` | opzioni dei poll |
| `community_poll_votes` | voti member-only, visibili direttamente solo al proprietario/admin |
| `community_poll_option_stats` | conteggi aggregati mantenuti da trigger, leggibili se il poll è leggibile |

RLS:
- contenuti pubblici leggibili da tutti solo se marcati pubblici;
- contenuti tier leggibili da utenti con subscription attiva a tier sufficiente;
- `/feed` è protetto dalla UI per account con membership attiva; la home `/` resta vetrina/paywall;
- i canali possono essere `public`, `members` o `tier` e filtrano anche i post collegati;
- commenti scrivibili solo da membri attivi;
- membri attivi possono pubblicare post propri `members`/`tier` nei canali accessibili;
- `admin` globale è anche admin community e può gestire tutto da `/admin?section=community`; `moderator` in `user_roles` può moderare commenti e live messages senza diventare admin globale;
- nessuna decisione autorizzativa basata su `user_metadata`.
- `community_channels`, `community_posts`, `community_comments`, `community_reactions`, `community_live_events`, `community_live_messages`, `community_polls`, `community_poll_options`, `community_poll_votes` e `community_poll_option_stats` sono nella publication Realtime.

RPC admin:
- `admin_list_community_roles()` elenca admin, moderator e membri con subscription attiva per la governance community;
- `admin_set_community_moderator(profile_id, enabled)` aggiunge/rimuove solo il ruolo `moderator`, richiedendo `has_role(auth.uid(), 'admin')`.

### Pagamenti Bunq

Riusa il pattern Bunq esistente ma separando il dominio:
- `POST /api/payments/bunq/membership/request`;
- `GET /api/payments/bunq/membership/status`;
- il polling `/status` attiva la subscription quando Bunq segna la request-inquiry come pagata;
- importi ricalcolati server-side da `membership_tiers`, mai dal client;
- il client può passare `quantity` 1-3; il server moltiplica importo e durata;
- se l'utente rinnova lo stesso tier attivo, il nuovo periodo parte dalla scadenza corrente, non da `now()`;
- fallback bonifico e webhook/router membership restano da implementare.

Posizionamento prodotto: Bunq non viene usato per addebiti ricorrenti automatici. Il copy deve esplicitare che il rinnovo manuale è intenzionale: niente abbonamenti dimenticati, solo partecipazione rinnovata per scelta. `dispatch_membership_renewal_reminders()` accoda email automatiche attraverso la coda transazionale esistente quando la membership scade entro 7 giorni o risulta appena scaduta.

### LiveKit

I live sincroni usano LiveKit:
- `community_live_events.livekit_mode` definisce `video`, `audio`, `stage` o `off`;
- `community_live_events.livekit_room_name` conserva la room reale;
- `/api/community/livekit-token` genera token firmati server-side con `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`;
- il frontend `CrewLivePage` usa `@livekit/components-react` e degrada sul thread testuale se LiveKit non è configurato;
- membri attivi possono pubblicare audio/video, moderator/admin ricevono anche permessi di moderazione room.

### Booking benefit

Integrare i benefit nel calcolo esistente senza cambiare la natura del contributo:
- `booking-deposit.ts` resta server-authoritative;
- aggiungere una funzione server/shared tipo `resolveActiveMembershipBenefit(profileId, voyageId)`;
- applicare solo benefit consentiti, per esempio `waive_fixed_minimum_cents` o `early_access_window_hours`;
- registrare ogni applicazione in `membership_benefit_events`;
- UI booking mostra il benefit come sostegno/community, non come sconto commerciale.

La candidatura anticipata richiede un'estensione a `get_public_voyage_leg_availability` o una nuova RPC che, per utenti membri, consideri finestre `booking_public_opens_at` e `booking_members_opens_at`.

## Esperienza utente

### Navigazione principale

Schermate minime:
- **Home vetrina**: posizionamento BITE Crew, tier Crew Pass e CTA; non mostra il feed completo.
- **Feed `/feed`**: stile Facebook, post piu recenti in alto, composer in cima e sidebar canali.
- **Subfeed `/feed/:channelSlug`**: canali tematici tipo Reddit, es. `boat-tips` e `ricette`, con accesso per tier.
- **Live**: room LiveKit video/audio/stage piu thread realtime guidato; admin crea eventi, membri attivi partecipano, moderator/admin possono nascondere messaggi.
- **Polls**: input strutturato dei membri per temi, rotte, priorità e Q&A, con scelta singola/multipla e chiusura programmata.
- **Discussioni**: commenti sui post e thread tematici leggeri.
- **Viaggi**: anteprime, early access, benefit applicabili, candidature gia integrate nel booking esistente.
- **Profilo main app**: tier attivo, rinnovo manuale, pagamenti e cambio tier via Bunq dentro `/profile`.

### Admin e studio

La gestione generale vive nell'admin esistente:
- `/admin?section=community` gestisce prezzi/tier, attivazione tier, canali/subfeed, ruoli moderator, snapshot iscrizioni/pagamenti e live programmate;
- gli admin esistenti non ricevono un ruolo community duplicato: `app_role = admin` resta la sorgente di verità e abilita accesso completo anche alla community.

Per tenere la main app incontaminata finché la parte editoriale non sarà pronta al 100%, la prima gestione dei post vive ancora dentro `apps/crew`:
- `/studio` crea un post;
- `/studio/:id` modifica un post;
- accesso consentito solo agli admin via RPC `has_role`;
- riusa `RichTextEditor`, `MediaFigure`, upload su bucket `logbook-media` e contenuto TipTap JSON bilingue come gli articoli.

## Roadmap

### Fase 1 - Fondazione

- [x] scegliere nome e dominio;
- [x] aggiungere `apps/crew` come sub-app;
- [x] creare schema membership + RLS;
- [x] creare listing tier e stato abbonamento;
- [x] implementare pagamento iniziale Bunq one-shot;
- [x] proteggere un feed riservato minimo.

### Fase 2 - Community reale

- [x] post admin riservati per tier;
- [x] commenti/reaction;
- [x] live event testuale;
- [x] poll member-only;
- [x] account membership con pagamenti e benefit;
- [x] gestione Crew Pass nel profilo principale;
- [x] home vetrina separata dal feed protetto `/feed`;
- [x] canali/subfeed gestibili da admin;
- [x] moderazione admin/moderator base;
- [x] LiveKit token endpoint e UI room base;
- [x] reminder email rinnovo manuale membership;
- [x] governance admin per prezzi, ruoli moderator, live e membership snapshot;
- notifiche push;
- upload foto/live media dedicati.

### Fase 3 - Integrazione viaggi

- early access su voyage;
- riduzione/esenzione minimo fisso;
- benefit visualizzato nel booking;
- audit benefit;
- dashboard admin per membri candidati.

### Fase 4 - Membership matura

- rinnovi e grace period;
- upgrade/downgrade;
- ricevute e storico pagamenti;
- metriche churn/retention;
- contenuti programmati.
- analytics cohort/retention e digest membri.

## Decisioni aperte

- Fallback bonifico per membership.
- Webhook Bunq membership, oggi coperto dal polling `/status`.
- Template React Email dedicato ai reminder membership: oggi la migrazione accoda HTML/testo minimale.
- Se il tier piu alto deve includere call/briefing privati o solo contenuti asincroni.
- Quanto forte deve essere la priorita sui viaggi: accesso anticipato e piu pulito di priorita automatica.
- Se gestire rinnovi mensili manuali via Bunq o valutare un provider subscription-native in futuro.

## Collegamenti
- [[01 - Architettura]] · [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]]
