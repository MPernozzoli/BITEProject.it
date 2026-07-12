---
tags: [stack, dipendenze, tecnologie]
---
# 02 - Stack Tecnologico

⬅️ [[Home]] · correlato: [[01 - Architettura]]

## Core
| Area | Tecnologia |
|---|---|
| Build/dev | **Vite 5** + `@vitejs/plugin-react-swc` |
| Linguaggio | **TypeScript 5.8** |
| UI runtime | **React 18.3** |
| Routing | **react-router-dom 6** |
| Data fetching/cache | **@tanstack/react-query 5** (+ persist client su localStorage) |
| Backend | **Supabase** (`@apps/supabase-js` 2.105) |
| Deploy | **Vercel** (`@vercel/functions`, `@vercel/analytics`, `@vercel/speed-insights`) |

## UI / Design system
- **shadcn/ui** (config in `components.json`) → componenti in `apps/web/src/components/ui/`
- **Radix UI** (accordion, dialog, dropdown, popover, select, tabs, toast, tooltip…) — libreria primitives sottostante
- **Tailwind CSS 3.4** + `tailwindcss-animate` + `@tailwindcss/typography` (config `tailwind.config.ts`)
- **framer-motion 11** — animazioni
- **lucide-react** — icone
- **next-themes** — tema chiaro/scuro
- **sonner** + toast Radix — notifiche
- **cmdk**, **vaul**, **embla-carousel**, **input-otp**, **react-resizable-panels** — widget UI

## Contenuti / Editor
- **TipTap 3** (`@tiptap/*`) — rich text editor per articoli (heading, image, link, youtube, text-align, color, underline…). Vedi [[16 - Admin]].
- **dompurify** + `apps/web/src/lib/sanitize-rich-html.ts` — sanitizzazione HTML
- **react-hook-form** + **zod** + `@hookform/resolvers` — form e validazione
- **date-fns 3** — date

## Mappe & Geo
- **maplibre-gl 5** — rendering mappe
- **supercluster** — clustering marker
- **three 0.185** — usato per boot splash 3D (`apps/web/src/lib/boot-splash-3d.ts`)
Vedi [[14 - Mappe e Layer Geospaziale]].

## Dati/Grafici
- **recharts** — grafici (dashboard/analytics admin)

## Testing
- **Vitest 3** + `@testing-library/react` + `jsdom` — unit/component test (`apps/web/src/test/`)
- **Playwright** — E2E (config `playwright.config.ts`)

## Mail
- **Resend** — invio/ricezione email automatiche e mail admin; webhook su Vercel e coda invio su Supabase Edge Functions → [[12 - Newsletter ed Email]].
- **@pynkstudio/mailapp** — package condiviso PynkStudio per struttura e utility mail; in questa repo è installato da tarball GitHub e usato lato server per normalizzazione indirizzi nel modulo admin mail → [[12 - Newsletter ed Email]].

## Origine
Il progetto nasce storicamente su **Lovable Cloud**, ma lo stack operativo è stato migrato fuori da Lovable. Oggi usa Supabase, Vercel e Resend; non restano dipendenze runtime Lovable.

## Collegamenti
- Script e comandi: [[20 - Comandi e Workflow]]
- Configurazione build/deploy: [[18 - Deploy e Configurazione]]
