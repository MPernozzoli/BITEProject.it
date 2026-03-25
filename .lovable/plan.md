

## Piano: Rinnovamento "The Crew" + aggiornamenti Home

### Cosa cambia

**1. Sezione "About" → "The Crew" (La Ciurma)**
- Rinominare la route da `/about` a `/crew`
- Riscrivere completamente la pagina con la storia del progetto BITE e i profili dei membri:
  - **Il Progetto** — Origini (Duodji il camper, poi Spritz la barca)
  - **Massimo** — 30 anni, da Potenza a Milano a bordo
  - **Sami** — 26 anni, brasiliano cresciuto a Sesto San Giovanni
  - **Godot** — Akita Americano, 6 anni, autismo canino + epilessia, passione per l'acqua ma paura della profondità
  - **Freya** — Arrivata a 1 anno dopo Snow Daisy, da fifona a impavida
  - **Snow Daisy** — Sezione "Ad Honorem", pensionamento, viaggi, e la perdita a gennaio 2025
  - **Spritz** — Deerberg Beryll 32", 1975, Germania, dal Lago di Costanza alla Grecia all'Italia
- Layout editoriale con le foto esistenti distribuite tra i profili (cani, barca, equipaggio)
- Testi in italiano e inglese nel sistema i18n

**2. Aggiornamenti i18n**
- `nav.about` → `"The Crew"` / `"La Ciurma"`
- Sostituire tutte le chiavi `about.*` con le nuove chiavi `crew.*`
- Aggiornare `life.text` (anno barca 1975, non 1983) e `intro.text` per allinearsi alla storia reale

**3. Aggiornamenti Navbar + Footer + Routing**
- Navbar: link `/about` → `/crew`
- Footer: stesso aggiornamento
- `App.tsx`: route `/about` → `/crew`, redirect `/about` → `/crew` per retrocompatibilità

**4. Aggiornamenti Home (Index.tsx)**
- Correggere la descrizione di Spritz nella sezione "Life Aboard" (1975, non 1983; ketch→cutter, 32 piedi, costruita in Germania)
- Aggiungere indicatore scroll nell'hero: freccia/chevron animata in basso con testo "Scroll" e animazione bounce, per invitare a scorrere verso il basso

### File coinvolti

| File | Modifica |
|------|----------|
| `src/pages/About.tsx` | Riscrittura completa → "The Crew" con tutti i contenuti |
| `src/lib/i18n.tsx` | Nuove chiavi crew.*, aggiornamento nav.about, correzione life.text |
| `src/components/Navbar.tsx` | Link `/about` → `/crew` |
| `src/components/Footer.tsx` | Link `/about` → `/crew` |
| `src/App.tsx` | Route `/about` → `/crew` |
| `src/pages/Index.tsx` | Aggiunta scroll indicator nell'hero, correzione anno barca |

