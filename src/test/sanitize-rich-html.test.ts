import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";

describe("sanitizeRichHtml", () => {
  it("removes inline handlers and javascript URLs", () => {
    const sanitized = sanitizeRichHtml(
      '<p onclick="alert(1)">Hi</p><a href="javascript:alert(1)" target="_blank">link</a>'
    );

    expect(sanitized).toContain("<p>Hi</p>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
  });

  it("preserves trusted YouTube embeds and removes untrusted iframes", () => {
    const trusted = sanitizeRichHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/demo"></iframe>'
    );
    const untrusted = sanitizeRichHtml(
      '<iframe src="https://evil.example/embed/demo"></iframe>'
    );

    expect(trusted).toContain("youtube-nocookie.com/embed/demo");
    expect(untrusted).not.toContain("<iframe");
  });
});
