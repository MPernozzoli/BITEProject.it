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
- poll `/polls` con voting member-only, risultati aggregati e form admin;
- account `/account` con stato Crew Pass, benefit, pagamenti e cambio tier;
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
| **Deck** | 7 €/mese | feed riservato, commenti, aggiornamenti live, Q&A periodici | `early_access_hours = 24` |
| **Wake** | 15 €/mese | tutto Deck + live/chat durante navigazioni, contenuti lunghi | `early_access_hours = 72` |
| **Harbor** | 35 €/mese | tutto Wake + briefing privati e benefit viaggio accessori | `early_access_hours = 168`, `waive_fixed_minimum_cents = 2000` |

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
| `membership_subscriptions` | stato abbonamento per profilo: tier, status, periodo, rinnovo, cancellazione |
| `membership_payments` | richieste Bunq/bonifico, stato pagamento, importi, audit |
| `membership_benefit_events` | audit dei benefit applicati, es. early access o riduzione minimo fisso |
| `community_posts` | contenuti riservati, con visibilita per tier |
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
- commenti scrivibili solo da membri attivi;
- admin/moderator gestiscono contenuti e moderazione;
- nessuna decisione autorizzativa basata su `user_metadata`.
- `community_posts`, `community_comments`, `community_reactions`, `community_live_events`, `community_live_messages`, `community_polls`, `community_poll_options`, `community_poll_votes` e `community_poll_option_stats` sono nella publication Realtime.

### Pagamenti Bunq

Riusa il pattern Bunq esistente ma separando il dominio:
- `POST /api/payments/bunq/membership/request`;
- `GET /api/payments/bunq/membership/status`;
- il polling `/status` attiva la subscription quando Bunq segna la request-inquiry come pagata;
- importi ricalcolati server-side da `membership_tiers`, mai dal client;
- fallback bonifico e webhook/router membership restano da implementare.

Attenzione: Bunq `request-inquiry` e ottimo per richieste singole, ma una membership ricorrente vera richiede una strategia operativa. Prima versione consigliata:
- abbonamento mensile rinnovato via nuova richiesta Bunq prima della scadenza;
- reminder email/push;
- grace period breve;
- downgrade automatico a free/expired se non pagato.

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
- **Home feed**: aggiornamenti, post, live ora, prossimo evento, CTA membership se non membro.
- **Live**: thread realtime guidati per navigazioni, Q&A e presenza crew; admin crea eventi, membri attivi scrivono, admin può nascondere messaggi.
- **Polls**: input strutturato dei membri per temi, rotte, priorità e Q&A, con scelta singola/multipla e chiusura programmata.
- **Discussioni**: commenti sui post e thread tematici leggeri.
- **Viaggi**: anteprime, early access, benefit applicabili, candidature gia integrate nel booking esistente.
- **Account**: tier attivo, rinnovo, pagamenti, benefit correnti, audit benefit applicati e cambio tier via Bunq.

### Studio

Per tenere la main app incontaminata, la prima gestione editoriale vive dentro `apps/crew`:
- `/studio` crea un post;
- `/studio/:id` modifica un post;
- accesso consentito solo agli admin via RPC `has_role`;
- riusa `RichTextEditor`, `MediaFigure`, upload su bucket `logbook-media` e contenuto TipTap JSON bilingue come gli articoli.

Quando la community sarà stabile si potrà decidere se spostare questa gestione in `admin.biteproject.it` oppure lasciarla nel sottodominio crew.

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
- [x] moderazione admin base;
- notifiche email/push;
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
- Flusso rinnovi/grace period automatico.
- Se il tier piu alto deve includere call/briefing privati o solo contenuti asincroni.
- Quanto forte deve essere la priorita sui viaggi: accesso anticipato e piu pulito di priorita automatica.
- Se gestire rinnovi mensili manuali via Bunq o valutare un provider subscription-native in futuro.

## Collegamenti
- [[01 - Architettura]] · [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]]
