import { describe, expect, it } from "vitest";
import { renderTiptapToHtml, extractPlainText } from "../../api/_lib/tiptap-html";

const doc = (content: unknown[]) => ({ type: "doc", content });

describe("renderTiptapToHtml", () => {
  it("renders headings and paragraphs with text", () => {
    const html = renderTiptapToHtml(
      doc([
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Un titolo" }] },
        { type: "paragraph", content: [{ type: "text", text: "Corpo dell'articolo." }] },
      ])
    );
    expect(html).toContain("<h2>Un titolo</h2>");
    expect(html).toContain("<p>Corpo dell&#39;articolo.</p>");
  });

  it("preserves inline formatting marks", () => {
    const html = renderTiptapToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "grassetto", marks: [{ type: "bold" }] },
            { type: "text", text: " e " },
            { type: "text", text: "corsivo", marks: [{ type: "italic" }] },
          ],
        },
      ])
    );
    expect(html).toContain("<strong>grassetto</strong>");
    expect(html).toContain("<em>corsivo</em>");
  });

  it("renders safe links and drops javascript: URLs", () => {
    const html = renderTiptapToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
            { type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
      ])
    );
    expect(html).toContain('<a href="https://example.com">ok</a>');
    // The malicious href is stripped, but the text is preserved.
    expect(html).toContain("bad");
    expect(html).not.toContain("javascript:");
  });

  it("escapes HTML in text nodes (no XSS)", () => {
    const html = renderTiptapToHtml(
      doc([{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }])
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders images with validated src", () => {
    const html = renderTiptapToHtml(
      doc([{ type: "image", attrs: { src: "https://cdn.test/img.jpg", alt: "Foto" } }])
    );
    expect(html).toContain('src="https://cdn.test/img.jpg"');
    expect(html).toContain('alt="Foto"');
  });

  it("only allows YouTube iframes in embeds", () => {
    const allowed = renderTiptapToHtml(
      doc([{ type: "youtube", attrs: { src: "https://www.youtube-nocookie.com/embed/abc" } }])
    );
    expect(allowed).toContain("<iframe");
    const blocked = renderTiptapToHtml(
      doc([{ type: "youtube", attrs: { src: "https://evil.example/embed/abc" } }])
    );
    expect(blocked).not.toContain("<iframe");
  });

  it("renders lists and blockquotes", () => {
    const html = renderTiptapToHtml(
      doc([
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "uno" }] }] },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "citazione" }] }] },
      ])
    );
    expect(html).toContain("<ul><li><p>uno</p></li></ul>");
    expect(html).toContain("<blockquote><p>citazione</p></blockquote>");
  });

  it("extractPlainText flattens the document", () => {
    const text = extractPlainText(
      doc([
        { type: "heading", content: [{ type: "text", text: "Titolo" }] },
        { type: "paragraph", content: [{ type: "text", text: "Testo del corpo." }] },
      ])
    );
    expect(text).toBe("Titolo Testo del corpo.");
  });
});
