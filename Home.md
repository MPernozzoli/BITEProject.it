---
tags: [moc, home, bite-project]
---

# 🧭 BITE Project — Vault del Progetto

> **BITE Project** ([biteproject.it](https://biteproject.it)) è l'esperienza editoriale di una crew a vela sulla **S/Y Spritz**: logbook di viaggio, racconti geolocalizzati, viaggi (voyage) aperti alla partecipazione con contributo condiviso alle spese, newsletter e un layer semantico/geospaziale pensato anche per agenti AI e ricerca pubblica.

Repository: `github.com/MPernozzoli/BITEProject.it` · Stack: **Vite + React + TypeScript + Supabase + Vercel** · Bilingue **IT/EN**.

---

## 🗺️ Mappa del Vault (MOC)

### Fondamenta
- [[01 - Architettura]] — visione d'insieme e flussi principali
- [[02 - Stack Tecnologico]] — librerie, framework, servizi
- [[04 - Struttura Repository]] — dove sta ogni cosa
- [[03 - Routing e i18n]] — rotte, lingue, sottodomini admin/login/community

### Frontend
- [[05 - Frontend - Pagine]] — pagine web, admin e sub-app
- [[06 - Frontend - Componenti]] — libreria componenti (UI, admin, booking, voyage)
- [[07 - Frontend - Lib e Hooks]] — logica condivisa lato client

### Backend & Dati
- [[08 - Supabase]] — Postgres, Auth, Storage, RLS
- [[09 - Edge Functions]] — le function serverless Supabase
- [[10 - API Vercel]] — endpoint `/api/*` (pagamenti, sitemap, prerender)
- [[17 - Content Model]] — modello dati editoriale/geospaziale

### Funzionalità chiave
- [[11 - Pagamenti Bunq]] — contributo viaggio e flusso pagamento
- [[12 - Newsletter ed Email]] — newsletter + email transazionali
- [[13 - Booking Voyage]] — prenotazione tratte e partecipanti
- [[23 - Community]] — BITE Crew: membership, feed, live, tier e benefit booking
- [[21 - Tracking Real-Time Viaggi]] — date effettive, ricalcolo a cascata, stati derivati
- [[14 - Mappe e Layer Geospaziale]] — MapLibre, rotte, waypoint
- [[22 - Citizen Science e Osservazioni]] — campionamenti, catalogo parametri, mappa e export su `data.`
- [[15 - Semantic Layer (AI Agents)]] — llms.txt, JSON/GeoJSON pubblici
- [[16 - Admin]] — dashboard, editor, gestione contenuti

### Operazioni
- [[18 - Deploy e Configurazione]] — Vercel, env, config
- [[19 - Sub-App (pack e data)]] — monorepo `apps/*`
- [[20 - Comandi e Workflow]] — script npm, dev, build, test

---

## ⚡ Quick facts

| | |
|---|---|
| **Dominio** | biteproject.it (+ sottodomini `admin.`, `login.`, `data.`, `pack.`, `crew.`) |
| **Build tool** | Vite 5 (+ SWC) |
| **UI** | React 18, shadcn/ui, Radix, Tailwind, framer-motion |
| **Backend** | Supabase (progetto `ekwloweuicrqjjgabfdp`) |
| **App principale** | `apps/web` (`@biteproject/web`) |
| **Sub-app** | `apps/pack` su `/pack`, `apps/data` su `/Data`, `apps/crew` su `/Crew` |
| **Migrations** | 37+ file in `apps/web/supabase/migrations/` |
| **Edge Functions** | 31+ in `apps/web/supabase/functions/` |
| **Pagamenti** | Bunq (request-inquiry) + bonifico bancario |
| **Mappe** | MapLibre GL + supercluster |
| **Origine** | nato su Lovable Cloud, poi migrato fuori da Lovable |
| **Deploy** | Vercel (SPA rewrite + edge middleware) |

---

## 🔗 Risorse esterne
- Doc di architettura originale: `docs/bite-atlas-architecture.md` → sintetizzato in [[15 - Semantic Layer (AI Agents)]]
- Doc pagamenti: `docs/payments-bunq.md` → sintetizzato in [[11 - Pagamenti Bunq]]
- Schema migrazione: `docs/migration/SCHEMA.md`
