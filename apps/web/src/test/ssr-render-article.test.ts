import { describe, expect, it } from "vitest";
import {
  renderContentFragment,
  buildHeadTags,
  injectIntoShell,
  type PageData,
} from "../../api/render";

const articlePage = (): PageData => ({
  title: "Arrestati dalla Guardia Costiera greca | BITE",
  description: "Un estratto introduttivo dell'articolo.",
  paths: {
    it: "/logbook/arrestati-dalla-guardia-costiera-greca",
    en: "/logbook/arrested-by-the-greek-coast-guard",
  },
  image: "https://cdn.test/cover.jpg",
  ogType: "article",
  status: 200,
  robots: "index, follow",
  links: [{ href: "/it/logbook", label: "Diario di bordo" }],
  article: {
    intro: "Un estratto introduttivo dell'articolo.",
    bodyHtml: "<p>Il corpo completo dell'articolo con <strong>formattazione</strong>.</p>",
    breadcrumb: [
      { label: "Home", href: "/it/" },
      { label: "Diario di bordo", href: "/it/logbook" },
      { label: "Arrestati dalla Guardia Costiera greca" },
    ],
    authors: [{ name: "Massimo", url: "https://biteproject.it/profile/1" }],
    publishedAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-02T12:00:00Z",
    imageAlt: "Arrestati dalla Guardia Costiera greca",
    voyage: { name: "Mar Ionio", href: "/it/voyages/1--mar-ionio" },
  },
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Arrestati dalla Guardia Costiera greca",
    inLanguage: "it",
  },
});

describe("renderContentFragment (article)", () => {
  const html = renderContentFragment("it", articlePage());

  it("contains the article title in an <h1>", () => {
    expect(html).toContain("<h1>Arrestati dalla Guardia Costiera greca</h1>");
  });

  it("contains the full body", () => {
    expect(html).toContain("Il corpo completo dell'articolo con <strong>formattazione</strong>");
  });

  it("contains the intro, cover image, author and dates", () => {
    expect(html).toContain("Un estratto introduttivo");
    expect(html).toContain('src="https://cdn.test/cover.jpg"');
    expect(html).toContain("Massimo");
    expect(html).toContain('datetime="2026-05-01T10:00:00Z"');
    expect(html).toContain('datetime="2026-05-02T12:00:00Z"');
  });

  it("contains the breadcrumb and linked voyage", () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("Mar Ionio");
  });
});

describe("buildHeadTags", () => {
  const head = buildHeadTags("it", articlePage(), false);

  it("emits title, canonical, hreflang, OG, Twitter and JSON-LD", () => {
    expect(head).toContain("<title>Arrestati dalla Guardia Costiera greca | BITE</title>");
    expect(head).toContain(
      '<link rel="canonical" href="https://biteproject.it/it/logbook/arrestati-dalla-guardia-costiera-greca" />'
    );
    expect(head).toContain('hreflang="en" href="https://biteproject.it/en/logbook/arrested-by-the-greek-coast-guard"');
    expect(head).toContain('hreflang="x-default"');
    expect(head).toContain('property="og:type" content="article"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain('"@type":"BlogPosting"');
  });
});

describe("injectIntoShell", () => {
  const shell = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <title>BITE — default</title>
    <meta name="description" content="default" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://biteproject.it/it" />
    <link rel="alternate" hreflang="it" href="https://biteproject.it/it" />
    <meta property="og:title" content="default" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <div id="root"></div>
    <noscript><p>enable js</p></noscript>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>`;

  const html = injectIntoShell(shell, "it", articlePage());

  it("keeps the built SPA script so React still boots", () => {
    expect(html).toContain('<script type="module" src="/assets/index-abc123.js"></script>');
  });

  it("injects the article content inside #root", () => {
    expect(html).toContain('<div id="root"><div class="ssr-content"');
    expect(html).toContain("Il corpo completo dell'articolo");
  });

  it("replaces the default per-page SEO tags", () => {
    expect(html).not.toContain("<title>BITE — default</title>");
    expect(html).toContain("<title>Arrestati dalla Guardia Costiera greca | BITE</title>");
    // Only one canonical remains (the per-page one).
    expect(html.match(/rel="canonical"/g)?.length).toBe(1);
    expect(html).toContain('href="https://biteproject.it/it/logbook/arrestati-dalla-guardia-costiera-greca"');
  });

  it("removes the generic noscript block", () => {
    expect(html).not.toContain("enable js");
  });
});
