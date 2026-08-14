import { describe, it, expect } from "vitest";
import { sanitizeArticleHtml, sanitizePlainSummary } from "@/security/sanitize";

describe("sanitizeArticleHtml", () => {
  it("strips script tags entirely", () => {
    const out = sanitizeArticleHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>hi</p>");
  });

  it("strips javascript: URLs from links", () => {
    const out = sanitizeArticleHtml('<a href="javascript:alert(1)">bad</a>');
    expect(out).not.toContain("javascript:");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeArticleHtml('<img src="https://example.com/a.png" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
  });

  it("strips iframes", () => {
    const out = sanitizeArticleHtml('<iframe src="https://evil.example.com"></iframe>');
    expect(out).not.toContain("<iframe");
  });

  it("keeps common formatting tags", () => {
    const out = sanitizeArticleHtml("<p>Hello <strong>world</strong></p><blockquote>quote</blockquote>");
    expect(out).toContain("<strong>world</strong>");
    expect(out).toContain("<blockquote>quote</blockquote>");
  });

  it("adds rel=noopener to links", () => {
    const out = sanitizeArticleHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('rel="noopener');
  });

  it("strips style attributes", () => {
    const out = sanitizeArticleHtml('<p style="position:fixed;top:0">hi</p>');
    expect(out).not.toContain("style=");
  });
});

describe("sanitizePlainSummary", () => {
  it("removes all tags and collapses whitespace", () => {
    expect(sanitizePlainSummary("<p>Hello   <b>world</b>\n\n</p>")).toBe("Hello world");
  });

  it("truncates long summaries", () => {
    const long = "a".repeat(500);
    const out = sanitizePlainSummary(long, 100);
    expect(out.length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });
});
