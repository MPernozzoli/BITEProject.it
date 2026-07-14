import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/render";

/**
 * End-to-end HTTP-level test of the universal SSR endpoint: it drives the real
 * `handler`, mocking only the Supabase REST layer and the SPA-shell fetch, and
 * asserts that the returned HTML already contains the article content — with no
 * JavaScript execution involved.
 */

const ARTICLE = {
  id: "a1",
  slug: "arrestati-dalla-guardia-costiera-greca",
  slug_it: "arrestati-dalla-guardia-costiera-greca",
  slug_en: "arrested-by-the-greek-coast-guard",
  title_it: "Arrestati dalla Guardia Costiera greca",
  title_en: "Arrested by the Greek Coast Guard",
  excerpt_it: "Una notte al largo delle coste greche.",
  excerpt_en: "A night off the Greek coast.",
  content_it: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Il pattugliatore ci ha intercettati all'alba." }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Il fermo" }] },
      { type: "paragraph", content: [{ type: "text", text: "Siamo stati condotti in porto." }] },
    ],
  },
  content_en: null,
  cover_image: "https://cdn.test/cover.jpg",
  published_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-02T12:00:00Z",
  category: "Logbook",
  voyage_id: null,
};

const SHELL = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <title>BITE — default</title>
    <meta name="description" content="default" />
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

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://supabase.test";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
  process.env.VERCEL_URL = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a fetch mock: article present unless `published` is false. */
const mockFetch = (opts: { article?: unknown } = {}) => {
  const article = "article" in opts ? opts.article : ARTICLE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/index.html")) {
        return new Response(SHELL, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("/rest/v1/logbook_articles") && url.includes("or=")) {
        return new Response(JSON.stringify(article ? [article] : []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // authors / tags / related / anything else → empty
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    })
  );
};

// A version of invoke that reliably captures statusCode.
const run = async (path: string): Promise<FakeRes> => {
  const captured: FakeRes = { statusCode: 0, headers: {}, body: "" };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    end(body: string) {
      captured.body = body;
      captured.statusCode = res.statusCode;
    },
  };
  await handler({ url: `/api/render?path=${encodeURIComponent(path)}`, headers: { host: "biteproject.it" } }, res as never);
  return captured;
};

describe("SSR render handler", () => {
  it("returns 200 with the article title and body for a published IT article", async () => {
    mockFetch();
    const res = await run("/it/logbook/arrestati-dalla-guardia-costiera-greca");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    // Title present in <head> AND <h1>.
    expect(res.body).toContain("<title>Arrestati dalla Guardia Costiera greca | BITE</title>");
    expect(res.body).toContain("<h1>Arrestati dalla Guardia Costiera greca</h1>");
    // Full body text present (no JS needed).
    expect(res.body).toContain("Il pattugliatore ci ha intercettati all&#39;alba.");
    expect(res.body).toContain("<h2>Il fermo</h2>");
    expect(res.body).toContain("Siamo stati condotti in porto.");
    // Canonical + JSON-LD.
    expect(res.body).toContain(
      '<link rel="canonical" href="https://biteproject.it/it/logbook/arrestati-dalla-guardia-costiera-greca" />'
    );
    expect(res.body).toContain('"@type":"BlogPosting"');
    // SPA still boots (script preserved when the shell is used).
    expect(res.body).toMatch(/<script type="module"/);
  });

  it("serves the EN version with the English canonical", async () => {
    mockFetch();
    const res = await run("/en/logbook/arrested-by-the-greek-coast-guard");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Arrested by the Greek Coast Guard");
    expect(res.body).toContain(
      '<link rel="canonical" href="https://biteproject.it/en/logbook/arrested-by-the-greek-coast-guard" />'
    );
  });

  it("returns a real 404 for a non-existent / unpublished article", async () => {
    mockFetch({ article: null });
    const res = await run("/it/logbook/does-not-exist");
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("sets a non-permanent, revalidating cache policy", async () => {
    mockFetch();
    const res = await run("/it/logbook/arrestati-dalla-guardia-costiera-greca");
    expect(res.headers["cache-control"]).toContain("s-maxage");
    expect(res.headers["cache-control"]).toContain("stale-while-revalidate");
    expect(res.headers["cache-control"]).not.toContain("max-age=31536000");
  });
});
