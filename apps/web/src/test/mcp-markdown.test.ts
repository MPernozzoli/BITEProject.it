import { describe, expect, it } from "vitest";
import { countWords, markdownToTiptap, tiptapToMarkdown } from "@/server/mcp/markdown";

/** Il round-trip è la garanzia che un agente possa leggere, modificare e riscrivere senza perdere pezzi. */
function roundTrip(markdown: string): string {
  return tiptapToMarkdown(markdownToTiptap(markdown));
}

describe("markdownToTiptap", () => {
  it("produce un documento ProseMirror valido anche da input vuoto", () => {
    expect(markdownToTiptap("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("converte titoli, paragrafi e liste", () => {
    const doc = markdownToTiptap("# Titolo\n\nUn paragrafo.\n\n- uno\n- due\n");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(doc.content?.[1]).toMatchObject({ type: "paragraph" });
    expect(doc.content?.[2]).toMatchObject({ type: "bulletList" });
    expect(doc.content?.[2]?.content).toHaveLength(2);
  });

  it("converte una tabella Markdown in nodi TipTap semantici", () => {
    const doc = markdownToTiptap("| Porto | Miglia |\n| --- | --- |\n| Bonifacio | 42 |");
    expect(doc.content?.[0]).toMatchObject({ type: "table" });
    expect(doc.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({ type: "tableHeader" });
    expect(doc.content?.[0]?.content?.[1]?.content?.[0]).toMatchObject({ type: "tableCell" });
  });

  it("limita i titoli ai livelli ammessi dall'editor", () => {
    const doc = markdownToTiptap("##### Troppo profondo");
    expect(doc.content?.[0]?.attrs?.level).toBe(3);
  });

  it("applica i mark inline", () => {
    const doc = markdownToTiptap("Testo **grassetto**, *corsivo* e `codice`.");
    const marks = (doc.content?.[0]?.content ?? []).flatMap((node) => node.marks?.map((mark) => mark.type) ?? []);
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
    expect(marks).toContain("code");
  });

  it("porta il link nel mark, non nel testo", () => {
    const doc = markdownToTiptap("Vai su [BITE](https://biteproject.it).");
    const link = (doc.content?.[0]?.content ?? []).find((node) => node.marks?.some((mark) => mark.type === "link"));
    expect(link?.marks?.[0]?.attrs?.href).toBe("https://biteproject.it");
    expect(link?.text).toBe("BITE");
  });

  it("estrae le immagini dal paragrafo, perché nello schema sono blocchi", () => {
    const doc = markdownToTiptap("![vela](https://cdn.example/vela.jpg)");
    expect(doc.content?.[0]).toMatchObject({ type: "image", attrs: { src: "https://cdn.example/vela.jpg", alt: "vela" } });
  });

  it("un'immagine con titolo diventa una mediaFigure con didascalia", () => {
    const doc = markdownToTiptap('![vela](https://cdn.example/vela.jpg "In rada a Bonifacio")');
    expect(doc.content?.[0]).toMatchObject({
      type: "mediaFigure",
      attrs: { kind: "image", src: "https://cdn.example/vela.jpg", alt: "vela", caption: "In rada a Bonifacio" },
    });
  });
});

describe("tiptapToMarkdown", () => {
  it("rende i nodi custom in forma leggibile invece di perderli", () => {
    const markdown = tiptapToMarkdown({
      type: "doc",
      content: [
        { type: "mediaFigure", attrs: { kind: "image", src: "https://cdn.example/a.jpg", caption: "In rada" } },
        {
          type: "paragraph",
          content: [{ type: "articleMapSceneAnchor", attrs: { sceneLabel: "Bocche di Bonifacio", anchorText: "qui" } }],
        },
      ],
    });
    expect(markdown).toContain('![In rada](https://cdn.example/a.jpg "In rada")');
    expect(markdown).toContain("⟨mappa: Bocche di Bonifacio⟩");
  });

  it("tollera documenti nulli o malformati", () => {
    expect(tiptapToMarkdown(null)).toBe("");
    expect(tiptapToMarkdown({ type: "doc" })).toBe("");
    expect(tiptapToMarkdown("non un documento")).toBe("");
  });
});

describe("round-trip", () => {
  const cases: [string, string][] = [
    ["titolo e paragrafo", "# Rotta verso sud\n\nSiamo partiti all'alba."],
    ["lista puntata", "- uno\n- due\n- tre"],
    ["lista numerata", "1. primo\n2. secondo"],
    ["tabella", "| Porto | Miglia |\n| --- | --- |\n| Bonifacio | 42 |\n| Capri | 68 |"],
    ["citazione", "> Il mare non ha memoria."],
    ["blocco di codice", "```ts\nconst x = 1;\n```"],
    ["separatore", "Prima\n\n---\n\nDopo"],
    ["formattazione inline", "Testo **grassetto** e *corsivo*."],
    ["link", "Vai su [BITE](https://biteproject.it)."],
    ["foto senza didascalia", "![vela al tramonto](https://cdn.example/vela.jpg)"],
    ["foto con didascalia", '![vela](https://cdn.example/vela.jpg "In rada a Bonifacio")'],
  ];

  for (const [name, markdown] of cases) {
    it(`preserva ${name}`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }

  it("è stabile alla seconda conversione", () => {
    const source = "## Sezione\n\nUn testo con [link](https://esempio.it) e **enfasi**.\n\n- a\n- b";
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
  });
});

describe("countWords", () => {
  it("conta le parole del corpo ignorando la sintassi", () => {
    expect(countWords(markdownToTiptap("# Titolo\n\nUno due tre."))).toBe(4);
  });
});
