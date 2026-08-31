---
tags: [frontend, tema, design, accessibilita]
---
# 27 - Tema Chiaro e Scuro

⬅️ [[Home]] · sorgente: `apps/web/src/lib/theme.tsx`, `apps/web/src/components/ThemeToggle.tsx`, `apps/web/src/index.css`, `apps/web/tailwind.config.ts`

Il sito ha due temi, **chiaro** e **scuro**, su tutta la superficie: pagine pubbliche, area utente e admin. Il chiaro è quello storico e non è cambiato; lo scuro è la sua controparte marina — fondali blu profondi, testo salso caldo, accento teal schiarito.

## Come si sceglie

Tre stati, non due:

| Stato | Cosa fa |
|---|---|
| `light` | Forza il chiaro, qualunque cosa dica il dispositivo |
| `dark` | Forza lo scuro |
| `system` (default) | Segue `prefers-color-scheme`, **anche se cambia a pagina aperta** |

La scelta vive in `localStorage` sotto `bite-theme`. `system` non è una fotografia scattata al mount: `ThemeProvider` ascolta la media query e, come rete di sicurezza per i browser che non consegnano `change` a scheda in secondo piano, rilegge la preferenza al ritorno sulla scheda (`visibilitychange` / `focus`). Le schede aperte in parallelo (sito + admin) si allineano tramite l'evento `storage`.

## Dove si tocca

- **`ThemeToggle`** — bottone sole/luna nella navbar, desktop e mobile. Un tap: chiaro ↔ scuro.
- **`ThemeChoice`** — i tre stati, dentro il menu profilo (desktop e mobile) e nella card Account del menu mobile. È l'unico posto da cui si torna a "Sistema".

Le stringhe sono in `i18n.tsx` sotto `theme.*`, IT/EN → [[03 - Routing e i18n]].

## Come è fatto

**Tailwind è già in `darkMode: ["class"]`**: tutto pende dalla classe `dark` su `<html>`.

1. **Token semantici** — `:root` e `.dark` in `index.css` definiscono le stesse variabili HSL (`--background`, `--card`, `--muted`, `--accent`, `--border`…). Tutto ciò che passa da `bg-background`, `text-foreground`, `border-border` e dai componenti shadcn cambia tema senza altro lavoro.
2. **Token del vetro** — `--glass` e `--glass-edge`, esposti a Tailwind come `bg-glass` / `border-glass-edge`. In chiaro valgono **bianco puro**, cioè esattamente quello che facevano le vecchie classi `bg-white/NN`: la migrazione è stata neutra sul chiaro, e in scuro le stesse opacità continuano a valere sopra un navy.
3. **Override `.dark` per le superfici su misura** — il design poggia su vetro, orb ambientali, navbar, posta admin, reader e popup mappa, tutti bianchi per costruzione. In fondo a `index.css` c'è una sezione dedicata con le loro controparti scure. **Le regole chiare non si toccano**: sono override a specificità più alta, così il chiaro resta identico a com'era.
4. **Varianti `dark:` sulle tinte di stato** — i badge amber/emerald/sky/orange/red dell'admin: le tinte chiare (50–400) diventano un velo della stessa tinta, quelle fonde (600+) si schiariscono. Le campiture sature restano.
5. **`prose-invert`** — il corpo articolo usa il plugin typography, che porta i propri colori chiari: senza `dark:prose-invert` il testo resterebbe grigio scuro su fondo scuro. Vale per `ArticleReader`, `ExpandedArticleModal`, `RichTextEditor` e il corpo mail admin.

### Niente lampo al primo paint

`index.html` contiene uno script inline che applica la classe **prima** che React monti: senza, la pagina lampeggerebbe in chiaro per un frame. Deve restare allineato a `theme.tsx` — stessa chiave, stessa classe, stessi colori. Lo script imposta anche `color-scheme` e `<meta name="theme-color">`, così scrollbar, controlli nativi e barre di sistema della PWA seguono il tema.

## La mappa

La basemap CARTO ha due varianti allo stesso indirizzo: `light_all` e `dark_all`. Attenzione ai nomi: le due basi si chiamano Positron e **Dark Matter**, ma nel percorso delle tile raster valgono `light_all` e `dark_all` — `dark_matter` è il nome dello stile, non un endpoint, e risponde 404. `createCartoRasterStyle(variant)` in `shared/maps/carto.ts` accetta la variante con default `"light"`, così `apps/data` non cambia comportamento → [[19 - Sub-App (pack e data)]].

In `apps/web` due helper in `lib/maplibre.ts`:
- `createThemedCartoStyle()` — la variante del tema corrente, alla creazione della mappa;
- `bindMapToTheme(map)` — tiene la basemap allineata mentre la mappa è viva.

`bindMapToTheme` **scambia le tile** della sorgente raster (`setTiles`) invece di rifare lo stile: `setStyle` ricostruirebbe la mappa da zero e porterebbe via rotte, tappe e layer che ogni componente aggiunge dopo la creazione. Si stacca da sé quando la mappa viene distrutta (MapLibre emette `remove`), quindi i chiamanti non devono ricordarsene nella pulizia dell'effetto. Chiamato da tutti e otto i punti che creano una mappa → [[14 - Mappe e Layer Geospaziale]].

## Cosa resta chiaro di proposito

- **L'anteprima newsletter** in `AdminNewsletterManager` — mostra com'è fatta l'email che arriverà in casella, e quella è chiara. Renderla scura mostrerebbe una cosa diversa da quella vera → [[12 - Newsletter ed Email]].
- **I marker sulla mappa** costruiti come stringhe di classi (`ArticleMapAside`, `ArticleMiniMapEditor`): sono segnaposto sopra le tile, e restano leggibili così su entrambe le basemap.
- **Gli scrim sopra le foto** (`bg-black/40` e simili) e il testo bianco che ci sta sopra: funzionano già in entrambi i temi perché il fondo è la foto, non la pagina.

## Verifica

Il controllo utile non è "quanti fallimenti di contrasto ha il tema scuro", ma **quali peggiorano solo in scuro**: sopra foto e gradienti ogni misura automatica dà falsi positivi, uguali nei due temi. Confrontando 33 rotte (pubbliche + admin) caricate nei due temi, le regressioni introdotte dallo scuro sono **zero**; lo scuro anzi risolve alcuni contrasti deboli preesistenti nei badge admin.

> ⚠️ Misurare il contrasto **dopo** aver cambiato tema con un toggle a caldo dà numeri falsi: le transizioni CSS sono ancora in corso e `getComputedStyle` restituisce colori a metà strada. Va misurato su caricamenti puliti, uno per tema.

## Collegamenti
- [[06 - Frontend - Componenti]] · [[07 - Frontend - Lib e Hooks]] · [[14 - Mappe e Layer Geospaziale]] · [[02 - Stack Tecnologico]] · [[16 - Admin]]
