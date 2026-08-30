---
tags: [analytics, tracking, utm, attribuzione, promozione, funzionalita]
---
# 26 - Sorgenti di Traffico

⬅️ [[Home]] · sorgente: `apps/web/src/lib/utm.ts`, `apps/web/src/lib/attribution.ts`, `apps/web/src/pages/AdminTrafficSources.tsx`, `apps/web/src/server/mcp/tools/links.ts`, migrazioni `20260830094858`, `20260830100714`

## Concetto
Il sito sapeva *cosa* veniva letto, da *chi* e per *quanto* ([[17 - Content Model]]), ma non da dove arrivava chi leggeva. I tracker di sorgente colmano quel buco: parametri `utm_*` nell'URL, aggiunti **sui link che pubblichiamo noi**, riletti al primo atterraggio e conservati per tutta la sessione, così ogni evento successivo sa raccontare la propria provenienza.

Tre limiti da tenere presenti, perché definiscono cosa questi dati possono e non possono dire:
- **valgono solo sui nostri link.** Chi arriva da una ricerca o da un link girato in chat non porta alcun `utm_*`: per quello resta la classificazione del referrer;
- **il referrer è spesso assente** (app native, iOS, link diretti): quel traffico finisce in `direct`, che quindi non significa "ha digitato l'indirizzo" ma "non ha lasciato traccia";
- **i click id di piattaforma** (`fbclid`, `gclid`, `ttclid`…) arrivano anche senza che il link sia stato taggato, e sono l'unica prova che quel click viene da lì.

## La grammatica dei valori — `lib/utm.ts`
Modulo **puro**, senza import e senza `window`: lo importano sia il client (Vite) sia il server MCP (function Vercel), come già fa `lib/mcp-scopes.ts`. Un solo posto dove si decide che forma ha un valore, perché `Facebook`, `facebook` e `FB` in tre punti diversi diventerebbero tre sorgenti distinte nei report.

| Funzione | Cosa fa |
|---|---|
| `normalizeTrackingToken` | minuscolo, senza accenti, non alfanumerici → trattini, max 60 caratteri |
| `buildTrackedUrl(url, tracking)` | aggiunge/sovrascrive gli `utm_*` lasciando intatto il resto; senza tracker o su URL illeggibile restituisce l'originale |
| `stripTrackingFromUrl` | toglie `utm_*` e click id: l'indirizzo canonico |
| `resolveAttribution` | **l'ordine dei segnali**: utm espliciti → click id di piattaforma → referrer classificato → `direct` |
| `classifyReferrer` | host → sorgente/mezzo; `null` per la navigazione interna, host conservato per i domini sconosciuti |
| `TRACKING_CHANNELS` | i canali reali (gruppo FB, bio Instagram, newsletter, QR…) con il loro preset sorgente/mezzo: è l'elenco che alimenta le tendine in admin |
| `sourceLabel` / `mediumLabel` | etichette leggibili per i report italiani |

L'ordine dei segnali non è un dettaglio: un utm esplicito deve vincere sul referrer, altrimenti ogni link nostro condiviso in un gruppo verrebbe attribuito al redirect della piattaforma (`l.facebook.com`) invece che al gruppo.

## La cattura nel browser — `lib/attribution.ts`
Chiamata da `main.tsx` **prima che React monti**, perché i tracker vivono nell'URL solo fino al primo click interno.

- **sessione** (`sessionStorage`, chiave `bite:attribution:v1`) — l'ultimo tocco, quello che si allega agli eventi di lettura. Un atterraggio senza segnali non sovrascrive quello che c'era: dentro una sessione, tornare da un bookmark non cancella il fatto che la sessione era cominciata da Facebook;
- **primo tocco** (`localStorage`, `bite:attribution:first:v1`) — come questa persona ha conosciuto il sito, scritto una volta sola e solo se c'era davvero un segnale. Serve alle conversioni lente; oggi è raccolto ma non ancora letto da nessuno.

Nessun cookie e nessun identificatore nuovo: si riusa `visitor-key`. Ogni accesso allo storage è in `try/catch` — in modalità privata l'attribuzione salta, la pagina no.

## Dove finisce il dato
`useArticleReads` allega `attributionRpcArgs()` a `increment_article_view_count`: la provenienza viaggia insieme alla lettura, che è l'unico momento in cui si sanno insieme *cosa* è stato letto e *da dove* arriva chi legge. Il fallback legacy della RPC resta, quindi un client vecchio non si rompe.

Colonne aggiunte da `20260830094858`:

| Tabella | Colonne | Nota |
|---|---|---|
| `article_read_events` | `source`, `medium`, `campaign`, `content`, `referrer_host` | `referrer_host` conserva il dettaglio che `source` appiattisce |
| `article_share_events` | `source`, `medium`, `campaign` | la provenienza di **chi condivide**: una condivisione partita da un lettore arrivato via newsletter racconta che quel canale non porta solo letture |

`increment_article_view_count` e `record_article_share` hanno una firma sola con tutti i parametri opzionali — due overload con default sovrapposti renderebbero ambigua ogni chiamata PostgREST — e da `20260830100714` normalizzano lato database con `normalize_tracking_token`, la stessa regola del client. Il client normalizza già tutto, ma la RPC è raggiungibile anche da fuori quel percorso e basta un `utm_campaign=Vela Lenta` perché lo stesso gruppo compaia due volte nei report.

### Aggregati
- `admin_traffic_sources(_days, _article_id)` — una riga per `(source, medium, campaign)`: visite, visitatori unici, articoli toccati, dwell medio. Con `_article_id` nullo copre tutto il sito;
- `admin_traffic_source_articles(_source, _days, _medium, _campaign, _limit)` — quali articoli alimenta un canale.

Entrambe passano da `can_read_traffic_analytics()`: admin loggato **oppure** ruolo `service_role`. Il secondo ramo non allarga i privilegi — la service key legge già le tabelle sottostanti ignorando le RLS — ma riconosce che per il server MCP l'autorizzazione è già stata fatta a monte dal token. Le RPC admin più vecchie (`admin_article_view_insights`, `admin_article_view_insight_one`) non hanno quel ramo e falliscono quando le chiama il server MCP: vedi **Debiti**.

## Dove si generano i link tracciati
Quattro punti, tutti sulla stessa grammatica:

1. **Tasto Condividi** (`ShareButton.tsx`) — il link copiato non è quello della barra degli indirizzi: viene prima ripulito dai tracker con cui *questo* lettore è arrivato (chi riceve il link non deve ereditare la provenienza di chi glielo manda) e poi taggato `utm_source=share`, `utm_medium=<metodo>`, `utm_campaign=<slug>`. Così le condivisioni dei lettori si distinguono dai canali che gestiamo noi;
2. **MCP `link_build`** (scope `articles:read`) — articolo, storia o URL qualsiasi, con preset di canale o campi espliciti; con `fb_group_id` compila da solo `facebook/group/<nome gruppo>` (richiede anche `promo:read`). **Rifiuta di produrre un link senza sorgente**: è la garanzia che nessun post esca con un URL anonimo → [[25 - MCP Admin]];
3. **`promo_post_log`** — registra il post con il link già tracciato per quel gruppo. Un link esplicito già taggato si rispetta, uno nudo verso il sito viene taggato, uno verso un dominio altrui non si tocca mai. Poiché `utm_campaign` è lo slug del gruppo, `admin_traffic_sources` risponde a «quante letture ha portato *quel* gruppo»;
4. **Pannello `/admin/sorgenti`** — generatore + report nella stessa pagina, di proposito: un link tracciato è un'ipotesi, il report è la verifica; separarli vorrebbe dire generare link e non guardare mai il risultato.

`articleLinks`/`storyLinks` in `server/mcp/links.ts` accettano un parametro `tracking` opzionale, ma `url_it`/`url_en` nelle risposte dei tool **restano canonici**: sono l'identità dell'articolo e devono restare confrontabili fra una risposta e l'altra. La versione tracciata vive nel campo che la usa davvero.

## Debiti
- **Le edge function non taggano ancora.** `send-newsletter-digest` e `notify-story-subscribers` compongono gli URL da sole in Deno, senza poter importare `lib/utm.ts`: il traffico da newsletter e notifiche resta classificato dal referrer o come `direct`. È il prossimo passo naturale.
- **`admin_article_view_insights` e `admin_article_view_insight_one` non sono chiamabili dal server MCP.** Controllano `has_role(auth.uid(), 'admin')`, ma il client MCP è service-role e `auth.uid()` è `NULL`: `article_metrics` e `article_metrics_detail` sollevano `not authorized`. Il rimedio è lo stesso `can_read_traffic_analytics()` usato dalle RPC nuove. Bug preesistente, non introdotto qui.
- Il **primo tocco** viene raccolto ma non ancora usato: il candidato naturale è il form contatti.

## Collegamenti
- [[16 - Admin]] · [[25 - MCP Admin]] · [[08 - Supabase]] · [[07 - Frontend - Lib e Hooks]] · [[06 - Frontend - Componenti]] · [[05 - Frontend - Pagine]] · [[17 - Content Model]] · [[12 - Newsletter ed Email]]
