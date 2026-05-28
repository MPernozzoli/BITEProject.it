## Obiettivo
Rendere il sito SEO-ottimizzato per il mercato italiano e inglese servendo ogni pagina su URL dedicati per lingua (`/it/...` e `/en/...`), con `hreflang`, canonical, `<html lang>` dinamici e sitemap bilingue.

## URL design

Struttura finale (esempi):
```text
/                              → redirect → /it/ o /en/ (in base a browser/cookie)
/it/                           → home IT
/en/                           → home EN
/it/diario-di-bordo            → Logbook IT
/en/logbook                    → Logbook EN
/it/diario-di-bordo/:slug      → articolo IT
/en/logbook/:slug              → articolo EN
/it/ciurma · /en/crew
/it/manifesto · /en/manifesto
/it/rotte · /en/voyages
/it/rotte/:ref · /en/voyages/:ref
/it/collaborazioni · /en/collaborations
/it/contatti · /en/contact
/it/links · /en/links
```

Le route admin, auth, profile, legal (`/admin/*`, `/login`, `/profile/*`, `/privacy-policy`, ecc.) restano **fuori dal prefisso lingua** (non sono contenuto SEO da indicizzare in due lingue).

I vecchi URL (`/logbook`, `/crew`, `/voyages/:ref`, ecc.) restano attivi come **301 redirect** verso `/en/...` o `/it/...` in base a browser/cookie → zero broken link, link esterni esistenti preservati.

## Cosa cambia

### 1. Routing (`src/App.tsx`)
- Wrappare le route pubbliche in due gruppi `<Route path="/it/*">` e `<Route path="/en/*">` con un componente `<LocalizedRoutes lang="it|en" />` che monta le stesse pagine.
- Aggiungere `<Route path="/" element={<LanguageRedirect />} />` che fa redirect a `/it/` o `/en/` in base a `localStorage.bite-lang` → cookie → `navigator.language` → default `en`.
- Per ogni vecchio URL pubblico aggiungere un redirect (`<Navigate to="/en/logbook" replace />` ecc.) calcolato dalla lingua preferita.

### 2. I18n driven by URL (`src/lib/i18n.tsx`)
- Il provider legge `lang` dal **path** invece che da query param/localStorage:
  - `pathname.startsWith("/it/")` → `it`
  - `pathname.startsWith("/en/")` → `en`
- `setLang(next)` fa `navigate(swapLangInPath(current, next))` invece di solo `setLang` interno → cambia URL.
- Si mantiene il fallback su browser/profilo utente **solo** sul redirect iniziale (`/` → `/xx/`).

### 3. Slug bilingui per articoli e voyages
- Articoli: i record hanno già `title_it` / `title_en`. Aggiungere colonne `slug_it` e `slug_en` (migration) generate da slugify del titolo; mantenere lo slug attuale come fallback finché non popolate.
- Lookup nel componente: `slug_it` se in IT, `slug_en` se in EN. Canonical sempre allo slug della lingua corrente.
- Voyages: stessa logica con `slug_it`/`slug_en` sulla tabella voyages.

### 4. Per-route head con `react-helmet-async`
- Installare `react-helmet-async`, montare `<HelmetProvider>` in `App.tsx`.
- Creare `<SeoHead>` riusabile che emette:
  - `<title>`, `<meta description>`
  - `<link rel="canonical" href="https://biteproject.it/{lang}/path">`
  - `<link rel="alternate" hreflang="it" href=".../it/path">`
  - `<link rel="alternate" hreflang="en" href=".../en/path">`
  - `<link rel="alternate" hreflang="x-default" href=".../en/path">`
  - `<meta property="og:locale" content="it_IT|en_US">`
  - `<meta property="og:locale:alternate" content="...">`
  - `<html lang>` aggiornato via `<Helmet htmlAttributes>`
- Inserire `<SeoHead>` in: Index, About, Manifesto, Journal, Voyages, VoyagePage, ArticlePage, Collaborations, Contact, Links, StoryPage.
- Per Article/Voyage aggiungere JSON-LD `Article` con `inLanguage`, `headline`, `datePublished`, `author`.
- Rimuovere `<link rel="canonical">` statico da `index.html` (sarà sempre per-route).

### 5. Sitemap bilingue
- Aggiornare `supabase/functions/public-sitemap/index.ts` per emettere, per ogni URL pubblico, **due entry** (`/it/...` e `/en/...`) con namespace `xhtml` e `<xhtml:link rel="alternate" hreflang="it|en|x-default">`.
- Stesso per `public/sitemap.xml` statico (mantenere allineato).

### 6. Cleanup `index.html`
- Lasciare `<html lang="en">` come fallback iniziale (verrà overridden da Helmet).
- Rimuovere `<link rel="canonical">` statico.
- `og:locale` resta `en_US` come default per crawler social senza JS.
- Aggiornare `noscript` per linkare `/en/...` espliciti.

### 7. Newsletter / email link
- Aggiornare i link generati nelle edge function email per usare il prefisso lingua corretto in base alla `preferred_language` del destinatario.

## Cosa NON cambia
- Database CMS, RLS, auth, admin panel, mappa MapLibre — tutto invariato.
- Le traduzioni esistenti in `i18n.tsx` (chiavi UI) restano identiche.
- Il selector di lingua nella navbar funziona già — cambierà solo l'implementazione di `setLang` (naviga invece di solo settare stato).

## Migration plan / rollout
1. Migration DB: aggiungere `slug_it`, `slug_en` (nullable) ad `articles` e `voyages` + backfill da titoli.
2. Refactor routing + i18n + helmet (un solo commit grosso).
3. Aggiornare sitemap edge function.
4. Smoke test: ogni route in IT ed EN, redirect dal vecchio URL, canonical corretto, hreflang corretto, language switcher cambia URL.
5. Dopo deploy: chiedere a Google Search Console "Inspect URL" su 2-3 URL IT per forzare reindex.

## Rischi / trade-off
- **Refactor invasivo**: tocca 12+ pagine, routing, i18n provider, sitemap.
- **Link esistenti**: i 301 redirect preservano tutto, ma social cards già scrappate (FB/LinkedIn) mostreranno vecchia URL finché non riscrapate.
- **Slug bilingui**: nuova UX per CMS — l'editor articolo dovrà permettere di editarli (UI minima: input read-only generati dal titolo, override opzionale). Posso lasciarlo per uno step successivo se vuoi che parta semplice (stesso slug per entrambe le lingue inizialmente).

## Domanda prima di partire
Per gli slug degli articoli vuoi:
- **(A)** Slug uguali in entrambe le lingue (es. `/it/diario-di-bordo/first-time-sailors` e `/en/logbook/first-time-sailors`) → più semplice, meno SEO-power IT
- **(B)** Slug diversi per lingua (es. `/it/diario-di-bordo/primi-velisti` vs `/en/logbook/first-time-sailors`) → SEO ottimale, richiede campo extra editabile nel CMS

Consiglio **(B)** ma se preferisci partire snello, **(A)** è fine.
