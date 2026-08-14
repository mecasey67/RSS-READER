import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFeedXml, FeedParseError } from "@/feeds/parser";
import { normalizeFeed } from "@/feeds/normalizer";

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures/feeds", name), "utf-8");
}

describe("RSS 2.0 basic feed", () => {
  it("normalizes title, guid, and dates", async () => {
    const parsed = await parseFeedXml(fixture("rss2-basic.xml"));
    const normalized = normalizeFeed(parsed as never, "https://example.com/feed.xml");

    expect(normalized.meta.title).toBe("Example RSS Blog");
    expect(normalized.articles).toHaveLength(2);
    expect(normalized.articles[0].title).toBe("First Post");
    expect(normalized.articles[0].externalId).toBe("urn:uuid:1111-2222-3333");
    expect(normalized.articles[0].publishedAt).toBe("2024-01-01T10:00:00.000Z");
  });
});

describe("Atom 1.0 basic feed", () => {
  it("normalizes entries into the same canonical shape as RSS", async () => {
    const parsed = await parseFeedXml(fixture("atom-basic.xml"));
    const normalized = normalizeFeed(parsed as never, "https://example.org/feed.xml");

    expect(normalized.articles).toHaveLength(2);
    expect(normalized.articles[0].externalId).toBe("tag:example.org,2024:entry-one");
    expect(normalized.articles[0].contentHtml).toContain("<strong>content</strong>");
    expect(normalized.articles[0].originalUrl).toBe("https://example.org/entry-one");
  });
});

describe("RSS with unsafe HTML content", () => {
  it("sanitizes dangerous markup while keeping safe formatting", async () => {
    const parsed = await parseFeedXml(fixture("rss-html-content.xml"));
    const normalized = normalizeFeed(parsed as never, "https://html.example.com/feed.xml");
    const html = normalized.articles[0].contentHtml;

    expect(html).toContain("<strong>world</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<iframe");
  });
});

describe("RSS with malformed dates", () => {
  it("imports every item even when dates are missing or garbage", async () => {
    const parsed = await parseFeedXml(fixture("rss-malformed-dates.xml"));
    const normalized = normalizeFeed(parsed as never, "https://dates.example.com/feed.xml");

    expect(normalized.articles).toHaveLength(4);
    expect(normalized.articles[0].publishedAt).not.toBeNull();
    expect(normalized.articles[1].publishedAt).toBeNull(); // garbage date
    expect(normalized.articles[2].publishedAt).toBeNull(); // missing date
    expect(normalized.articles[3].publishedAt).toBe("2024-03-05T00:00:00.000Z"); // bare date
  });
});

describe("RSS without guids", () => {
  it("falls back to url-derived or hash-derived identifiers", async () => {
    const parsed = await parseFeedXml(fixture("rss-no-guids.xml"));
    const normalized = normalizeFeed(parsed as never, "https://noguid.example.com/feed.xml");

    expect(normalized.articles[0].externalId).toBe("url:https://noguid.example.com/post-1");
    expect(normalized.articles[1].externalId).toMatch(/^fallback:/);
  });
});

describe("broken XML", () => {
  it("throws a typed FeedParseError instead of crashing", async () => {
    await expect(parseFeedXml(fixture("broken.xml"))).rejects.toBeInstanceOf(FeedParseError);
  });
});

describe("empty feed", () => {
  it("parses successfully with zero articles", async () => {
    const parsed = await parseFeedXml(fixture("empty.xml"));
    const normalized = normalizeFeed(parsed as never, "https://empty.example.com/feed.xml");
    expect(normalized.articles).toHaveLength(0);
    expect(normalized.meta.title).toBe("Empty Feed");
  });
});
