import { describe, it, expect } from "vitest";
import { computeContentHash, computeFallbackId } from "@/articles/dedupe";

describe("computeContentHash", () => {
  it("is stable for identical input", () => {
    const a = computeContentHash({ title: "T", contentText: "C", publishedAt: "2024-01-01T00:00:00Z" });
    const b = computeContentHash({ title: "T", contentText: "C", publishedAt: "2024-01-01T00:00:00Z" });
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    const a = computeContentHash({ title: "T", contentText: "C1", publishedAt: null });
    const b = computeContentHash({ title: "T", contentText: "C2", publishedAt: null });
    expect(a).not.toBe(b);
  });
});

describe("computeFallbackId", () => {
  it("is deterministic for the same feed/title/date/url", () => {
    const input = { feedUrl: "https://example.com/feed.xml", title: "Post", publishedAt: null, url: null };
    expect(computeFallbackId(input)).toBe(computeFallbackId({ ...input }));
  });

  it("differs across feeds even with the same title", () => {
    const a = computeFallbackId({ feedUrl: "https://a.example.com/feed.xml", title: "Post", publishedAt: null, url: null });
    const b = computeFallbackId({ feedUrl: "https://b.example.com/feed.xml", title: "Post", publishedAt: null, url: null });
    expect(a).not.toBe(b);
  });

  it("is prefixed for identifiability", () => {
    expect(computeFallbackId({ feedUrl: "f", title: null, publishedAt: null, url: null })).toMatch(/^fallback:/);
  });
});
