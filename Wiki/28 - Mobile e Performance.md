---
tags: [frontend, mobile, performance, accessibilita, immagini]
---
# 28 - Mobile e Performance

⬅️ [[Home]] · sorgente: `apps/web/src/lib/storage-image.ts`, `apps/web/index.html`, `apps/web/src/index.css`, `apps/web/src/components/LazyVoyageMap.tsx`

La maggior parte del traffico arriva da telefono, spesso in rete mobile e a volte in banchina. Questa nota raccoglie le convenzioni che tengono il sito usabile lì, e soprattutto il **perché**: quasi tutte nascono da un modo di sbagliare che si ripresenta se non lo si conosce.

Il layout responsive di per sé regge: a 375px e a 320px non c'è un solo overflow orizzontale, il contrasto passa AA in entrambi i temi, e il vetro (`backdrop-filter`) è già spento sotto i 768px perché è l'effetto che costa di più alla GPU. I problemi che contano su mobile sono altri due: **quanto pesa** e **quanto è toccabile**.

## Le immagini passano dal trasformatore, sempre

Le foto caricate dall'admin finiscono nello storage Supabase alla risoluzione originale: uno scatto da telefono sono 3–4 MB e 4000px di lato. Servirlo così a una miniatura da 38px significa scaricare mille volte i pixel che servono.

**Regola: nessun `<img src>` punta direttamente a `/storage/v1/object/public/`.** Si passa da `lib/storage-image.ts`, che riscrive l'indirizzo su `/storage/v1/render/image/public/` — l'endpoint che ridimensiona al volo e negozia WebP dall'header `Accept`. Gli originali non vengono toccati, cambia solo l'indirizzo da cui la pagina li chiede.

| Funzione | Quando |
|---|---|
| `storageImageProps(url, cssWidth)` | Elemento di misura fissa nota (miniature, avatar). Emette `srcset` 1x/2x: il browser sceglie sul DPR, `sizes` non serve. |
| `storageImageResponsiveProps(url, widths, sizes)` | Elemento che cambia larghezza col viewport (cover, hero). Descrittori `w` più `sizes`, così su telefono scarica la variante piccola. |
| `storageImage(url, { width })` | Una URL sola, quando il markup è costruito a stringa (i popup di `VoyageMap`). |

Tutte lasciano passare immutato ciò che non è storage Supabase: asset locali, `blob:`, `data:`, URL esterni. SVG e GIF sono esclusi perché il trasformatore non li gestisce. I chiamanti possono quindi passare qualunque cosa senza controlli.

> ⚠️ **Con la sola `width`, il trasformatore ritaglia invece di scalare.** Il default di `resize` è `cover`, che con un solo lato specificato non ricalcola l'altro: lo taglia. Una cover 1536×1024 chiesta a `?width=1024` torna **1024×1024**, cioè un quadrato ritagliato, non un ridimensionamento. `storageImage()` forza quindi `resize=contain` quando non viene passata un'altezza — è l'unica modalità che, con un lato solo, mantiene le proporzioni. Il difetto è insidioso perché si vede poco: quasi tutte queste immagini stanno dentro contenitori `object-cover`, che ritagliano comunque, quindi il riquadro resta pieno e sembra a posto. Verificare il peso e il fatto che l'URL passi dal trasformatore **non basta**: va guardato il rapporto di `naturalWidth`/`naturalHeight`.

> ⚠️ **Misurare il risparmio con `curl` dà numeri falsi.** `curl` e `fetch()` non mandano l'`Accept` immagine di un browser, quindi il trasformatore risponde PNG o JPEG invece di WebP e il guadagno sembra molto minore di quello reale. Sulla stessa cover: 2224 KB → 1346 KB chiedendo PNG, **2224 KB → 63 KB** con `Accept: image/webp`. Va misurato con l'header vero, o direttamente dal browser.

Su una pagina articolo tipo l'effetto è **34,7 MB → 2,3 MB (−93%)** su 30 immagini.

## Il costo di rete si paga quando serve, non al mount

`LazyVoyageMap` accetta `deferUntilVisible` per le mappe sotto la piega (la home). Il chunk di maplibre pesa ~260 KB gzip: è il pezzo di JavaScript più grosso del sito, e sulla home vale da solo il 72% del suo carico.

L'insidia è che **differire il rendering non differisce il download**: un `IntersectionObserver` che decide *quando montare* non impedisce a una `import()` chiamata al mount di partire subito. Le due cose vanno tenute insieme — la `import()` sta dentro il callback dell'observer, non in un `useEffect` separato. Il `rootMargin: "240px"` fa partire il caricamento mentre la mappa è ancora fuori schermo, così l'attesa resta invisibile.

Vale come regola generale per ogni chunk pesante: se si scrive un prefetch al mount, chiedersi se l'utente ci arriverà davvero.

## Campi di input: mai sotto i 16px su mobile

Safari iOS ingrandisce automaticamente la pagina quando un campo con `font-size` sotto i 16px riceve il focus, e **non torna indietro da solo**. È il difetto mobile che si reintroduce più facilmente, perché `text-sm` è la misura naturale da scrivere.

**Regola: ogni `input`, `textarea` e `select` che un utente tocca usa `text-base md:text-sm`** — 16px sul telefono, la misura di design da tablet in su. Il componente base `ui/input.tsx` lo fa già; `ui/textarea.tsx` è stato allineato. Attenzione ai campi scritti a mano e agli override via `className`: `tailwind-merge` fa vincere l'ultima classe, quindi un `text-sm` passato dall'esterno annulla il default corretto del componente.

## Safe area: `viewport-fit=cover` è il prerequisito

Il manifest dichiara `display: standalone` e `index.html` imposta `apple-mobile-web-app-capable`: installato dalla home, il sito gira a tutto schermo, ed è lì che le barre fisse rischiano di finire sotto la barra home o la tacca.

**Senza `viewport-fit=cover` nel meta viewport, iOS non espone mai le `env(safe-area-inset-*)`: restano a zero.** È una trappola silenziosa — il CSS si scrive, sembra giusto, e non fa niente. Il meta ora lo include, quindi quelle variabili sono vive; per contro il contenuto si estende sotto tacca e angoli, e ogni elemento a tutto schermo deve tenerne conto. La navbar usa `max(…, env(safe-area-inset-*))` su padding orizzontale e superiore, così il valore di design resta il minimo.

Se ne servono in `StickyEngagementBar`, `VoyageJoinPanel`, `VoyageJoinDialog`, `AdminMobileNavigation` e in `index.css`.

> La resa va confermata su un iPhone con tacca reale: l'emulatore del browser riporta comunque `0px`, quindi lì non è verificabile.

## Aree di tocco

La soglia di riferimento è 44×44px (Apple; WCAG 2.2 §2.5.8 fissa 24px come minimo assoluto). Non serve ingrandire la grafica: dove la misura del bottone è una scelta di composizione — i controlli della navbar — c'è l'utility **`.touch-target-44`** in `index.css`, che estende l'area sensibile con uno pseudo-elemento centrato senza spostare nulla. Altrove basta riassorbire il padding con margini negativi (`-mx-2 -my-2.5` più `min-h-[44px]`), come in `LikeButton` e `ShareButton`.

I controlli di serie di MapLibre sono 29px. La regola che li porta a 44 da touch **deve stare fuori da `@layer`**: MapLibre inietta il proprio CSS senza layer, e nel cascade qualunque layer perde contro ciò che è fuori, a prescindere dalla specificità. È in fondo a `index.css` per questo, non per disordine.

## Le card di contenuto sono link veri

Una card che apre un pannello invece di navigare resta comunque un `<a href>` con l'indirizzo vero: il click semplice è intercettato con `preventDefault()`, ma tocco prolungato, cmd-click e rotellina continuano a funzionare. Su mobile il tocco prolungato è **il** gesto per mettere da parte una lettura («apri in una nuova scheda», «copia link», «condividi»), e un `<div onClick>` lo toglie insieme al focus da tastiera e al ruolo per gli screen reader.

Vale per `voyage/ArticleListCard`. L'indirizzo si costruisce con `articlePathForLang` + `localizedHref` per avere lo slug della lingua giusta → [[03 - Routing e i18n]]; perché funzioni, gli slug per lingua devono arrivare fino al componente, quindi `public-content.ts` li seleziona e `GeoArticle` li dichiara.

## Etichette: `title` non basta

Su touch l'attributo `title` non produce alcun tooltip: un comando icona-sola con solo `title` resta senza nome sia per chi vede sia per uno screen reader. Serve `aria-label`, e va tradotto come tutto il resto → [[03 - Routing e i18n]].

## Font

I font Google si caricano con un `<link rel="stylesheet">` in `index.html`, **non** con un `@import` in `index.css`. Un `@import` non può partire prima che il foglio che lo contiene sia scaricato e interpretato: la catena diventa seriale (HTML → CSS dell'app → CSS dei font → woff2) e su rete mobile è un round-trip in più prima che i caratteri comincino a scaricarsi. Con il `<link>` la richiesta parte in parallelo. `display=swap` è già nell'URL, quindi il testo appare subito col fallback.

## Cosa resta com'è, di proposito

- **Testo a 11px** su etichette, metadati e chip. Non è un errore ma una scelta di stile coerente col tono editoriale: cambiarla è una decisione di design → [[27 - Tema Chiaro e Scuro]].
- **La colonna di lettura** dell'articolo resta a ~27 caratteri per riga su 375px. Il consiglio dei 45–75 è una regola desktop: con corpo 18px su uno schermo da 375px non è raggiungibile, e ridurre il corpo peggiorerebbe la leggibilità. Il padding su mobile è stato comunque alleggerito (`p-4` e `p-3` contro `p-6`/`p-5`), il che accorcia la pagina di circa 1270px.
- **Gli asset locali in `src/assets`** vengono serviti interi: non passano dallo storage, e produrne varianti richiede un passo di build separato. Ha senso solo se una di quelle immagini diventa un problema misurato.

## Collegamenti
- [[06 - Frontend - Componenti]] · [[07 - Frontend - Lib e Hooks]] · [[14 - Mappe e Layer Geospaziale]] · [[27 - Tema Chiaro e Scuro]] · [[03 - Routing e i18n]] · [[18 - Deploy e Configurazione]]
