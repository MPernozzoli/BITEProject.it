
## Godot & Freyja — Premium Talent Portfolio & Media Kit

A cinematic, editorial one-page site at `pack.biteproject.it` positioning two large-breed dogs as serious talent for casting, productions, and brand partnerships.

### Design direction
- **Palette:** Deep charcoal/near-black background, warm off-white (#F5F0E8 feel), muted grays, single warm accent (soft amber/bronze) used sparingly for CTAs and metric highlights.
- **Typography:** Editorial serif for display (Instrument Serif / Cormorant feel) + clean grotesque sans (Inter / DM Sans) for body. Uppercase tracked labels for metadata.
- **Motion:** Subtle scroll reveals, parallax hero, hover image scale, animated stat counters, smooth anchor scroll. No bouncy/playful animation.
- **Layout:** Full-bleed imagery, generous whitespace, asymmetric editorial grids, thin hairline dividers, minimal border-radius.

### Structure (one-page, anchor nav, sticky header)
Sticky top nav with logo wordmark "PACK / BITE", anchor links (Overview · Brands · Casting · Profiles · Metrics · Work · Gallery · Contact), and a persistent "Get in touch" CTA.

1. **Hero** — Full-viewport image treatment with dark gradient, large serif headline "Godot & Freyja", subheadline, dual CTAs (For Brands / For Casting), scroll cue.
2. **Quick Overview** — 4 minimal cards: Brand Collaborations · Modeling & Casting · Outdoor / Travel / Boat · Individual & Duo.
3. **Choose Your Path** — Two large split cards (Brands ↔ Agencies & Casting), each anchoring to its section.
4. **Brand Media Kit** — Intro + 4 subsections (Brand Fit, Audience Snapshot, Content Style, Collaboration Options).
5. **Casting / Agency Profile** — Intro + 4 subsections (Set Suitability, Temperament & Handling, Production Readiness, Travel Availability), styled like a casting sheet.
6. **Individual Profiles** — Tabbed switcher (Godot / Freyja) showing premium "talent cards" with all required fields (breed, age, weight, height, coat, location, passport, vaccinations, temperament, strengths, commands, environments, handler notes).
7. **Duo Profile** — Editorial paragraph + "Best for" tag chips.
8. **Metrics & Audience** — Dashboard-style cards with animated counters (Followers, Avg Reel Views, Likes, Comments, Engagement Rate, Monthly Reach), simple bar/donut placeholders for Top Countries & Language Split, top-performing content strip, "updated regularly" note.
9. **Partnerships / Previous Work** — Reusable project cards (brand, type, deliverables, outcome, thumbnail) with fallback labeling "Selected sample collaborations".
10. **Gallery** — Filterable masonry grid by category (Portraits, Full Body, Lifestyle, Outdoor, With Humans, Product, Duo) with lightbox.
11. **Services & Deliverables** — Premium service cards listing all bookable formats.
12. **Why Work With Them** — 6 differentiator points in editorial grid.
13. **Press Kit / Downloads** — Cards with placeholder buttons (Media Kit PDF, Casting Sheet, Rate Card, Full Metrics, Portfolio Deck).
14. **Contact** — Inquiry form (Name, Company, Email, Inquiry Type select, Project Details, Timeline, Budget) with zod validation, plus email, Instagram, WhatsApp, location.

Footer: wordmark, anchor links, social, copyright.

### Technical approach
- Single `Index.tsx` composed of small section components in `src/components/sections/` for clean future page-splitting.
- Structured dummy data in `src/data/` (profiles, metrics, partnerships, services, gallery).
- Design tokens centralized in `index.css` + `tailwind.config.ts` (dark editorial theme as default, semantic HSL tokens, custom fonts via Google Fonts in `index.html`).
- Reusable primitives: `SectionHeader`, `MetricCard`, `ProfileCard`, `ServiceCard`, `ProjectCard`, `GalleryGrid`, `Tabs` (shadcn).
- Smooth scroll via CSS + anchor IDs; scroll-reveal via Intersection Observer hook.
- Form validated with `zod` + `react-hook-form`; submit handler stubbed (toast confirmation) ready for later wiring.
- Placeholder imagery via curated Unsplash dog/outdoor shots (license-free) used as visual stand-ins until real assets are provided.
- Fully responsive; mobile nav as slide-in sheet.

### Out of scope
No backend, no auth, no ecommerce, no blog. Downloads are non-functional placeholders. Lovable Cloud not enabled in v1 (can be added later for form submissions and real PDF hosting).
