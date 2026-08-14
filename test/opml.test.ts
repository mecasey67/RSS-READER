import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";

import { db, runMigrations } from "@/db/client";
import { users, folders, feeds, subscriptions } from "@/db/schema";
import { parseOpml, OpmlParseError } from "@/opml/parser";
import { previewOpmlImport, importOpmlEntries } from "@/opml/importer";
import { exportOpml } from "@/opml/exporter";

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures/opml", name), "utf-8");
}

let userId: number;
function freshUserId(): number {
  const email = `opml-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [u] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
  return u.id;
}

beforeAll(() => {
  runMigrations();
});

describe("parseOpml", () => {
  it("parses a flat OPML file", () => {
    const result = parseOpml(fixture("flat.opml"));
    expect(result.outlines).toHaveLength(2);
    expect(result.outlines[0].xmlUrl).toBe("https://arstechnica.com/feed/");
  });

  it("parses categorized (one level) folders", () => {
    const result = parseOpml(fixture("categorized.opml"));
    expect(result.outlines.filter((o) => o.isFolder)).toHaveLength(2);
    const tech = result.outlines.find((o) => o.title === "Technology")!;
    expect(tech.children).toHaveLength(2);
  });

  it("parses nested folders preserving hierarchy", () => {
    const result = parseOpml(fixture("nested.opml"));
    const news = result.outlines.find((o) => o.title === "News")!;
    const local = news.children.find((o) => o.title === "Local")!;
    expect(local.isFolder).toBe(true);
    expect(local.children[0].xmlUrl).toBe("https://localpaper.example.com/feed");
  });

  it("handles unicode folder and feed names", () => {
    const result = parseOpml(fixture("unicode.opml"));
    expect(result.outlines.some((o) => o.title === "日本語のブログ")).toBe(true);
    expect(result.outlines.some((o) => o.title?.includes("🚀"))).toBe(true);
  });

  it("keeps malformed/empty leaf entries visible rather than silently dropping them", () => {
    const result = parseOpml(fixture("malformed-entries.opml"));
    expect(result.outlines).toHaveLength(4); // nothing silently dropped
    expect(result.outlines.some((o) => o.title === "Good Feed")).toBe(true);
    expect(result.outlines.some((o) => o.title === "Another Good Feed")).toBe(true);
    expect(result.outlines.find((o) => o.title === null)?.xmlUrl).toBeNull(); // the bare <outline/>
  });

  it("throws OpmlParseError for empty input", () => {
    expect(() => parseOpml("")).toThrow(OpmlParseError);
  });

  it("throws OpmlParseError when there is no <opml> root", () => {
    expect(() => parseOpml("<html></html>")).toThrow(OpmlParseError);
  });
});

describe("previewOpmlImport", () => {
  it("classifies invalid xmlUrl and missing xmlUrl entries", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("missing-xmlurl.opml"), userId);
    expect(preview.invalidCount).toBe(1);
    expect(preview.newCount).toBe(1);
  });

  it("flags in-file duplicates including tracking-parameter variants", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("duplicates.opml"), userId);
    expect(preview.newCount).toBe(1);
    expect(preview.duplicateCount).toBe(2);
  });

  it("flags feeds the user is already subscribed to", () => {
    userId = freshUserId();
    const first = previewOpmlImport(fixture("flat.opml"), userId);
    importOpmlEntries(userId, first.entries);

    const second = previewOpmlImport(fixture("flat.opml"), userId);
    expect(second.duplicateCount).toBe(2);
    expect(second.newCount).toBe(0);
  });

  it("reports discovered folder names", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("categorized.opml"), userId);
    expect(preview.folderNames.sort()).toEqual(["Libraries", "Technology"]);
  });
});

describe("importOpmlEntries", () => {
  it("creates folders and subscriptions matching a categorized OPML file", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("categorized.opml"), userId);
    const summary = importOpmlEntries(userId, preview.entries);

    expect(summary.imported).toBe(3);
    expect(summary.foldersCreated).toBe(2);

    const userFolders = db.select().from(folders).where(eq(folders.userId, userId)).all();
    expect(userFolders.map((f) => f.name).sort()).toEqual(["Libraries", "Technology"]);

    const subs = db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).all();
    expect(subs).toHaveLength(3);
  });

  it("preserves nested folder hierarchy via parentId", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("nested.opml"), userId);
    importOpmlEntries(userId, preview.entries);

    const userFolders = db.select().from(folders).where(eq(folders.userId, userId)).all();
    const news = userFolders.find((f) => f.name === "News")!;
    const local = userFolders.find((f) => f.name === "Local")!;
    expect(local.parentId).toBe(news.id);
  });

  it("importing the same file twice creates no duplicate feeds or subscriptions", () => {
    userId = freshUserId();
    const preview1 = previewOpmlImport(fixture("flat.opml"), userId);
    const summary1 = importOpmlEntries(userId, preview1.entries);
    expect(summary1.imported).toBe(2);

    const preview2 = previewOpmlImport(fixture("flat.opml"), userId);
    const summary2 = importOpmlEntries(userId, preview2.entries);
    expect(summary2.imported).toBe(0);
    expect(summary2.alreadySubscribed).toBe(2);

    const allFeeds = db.select().from(feeds).all();
    const matchingFeeds = allFeeds.filter((f) => f.feedUrl.includes("arstechnica.com") || f.feedUrl.includes("daringfireball.net"));
    expect(matchingFeeds).toHaveLength(2);
  });

  it("continues importing valid feeds when some entries are invalid", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("malformed-entries.opml"), userId);
    const summary = importOpmlEntries(userId, preview.entries);

    expect(summary.imported).toBe(2); // "Good Feed" and "Another Good Feed"
    expect(summary.invalid).toBe(2); // "Bad URL Feed" + the bare <outline/>
  });

  it("imports a large (200-feed) OPML file across many folders efficiently", () => {
    userId = freshUserId();
    const start = Date.now();
    const preview = previewOpmlImport(fixture("large.opml"), userId);
    const summary = importOpmlEntries(userId, preview.entries);
    const elapsedMs = Date.now() - start;

    expect(summary.imported).toBe(200);
    expect(summary.foldersCreated).toBe(8);
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe("exportOpml", () => {
  it("produces valid, re-importable OPML with folders preserved", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("categorized.opml"), userId);
    importOpmlEntries(userId, preview.entries);

    const xml = exportOpml(userId);
    expect(xml).toContain("<opml");
    // normalizeFeedUrl strips a single trailing slash on import.
    expect(xml).toContain('xmlUrl="https://arstechnica.com/feed"');
    expect(xml).toContain('text="Technology"');
    expect(xml).toContain('text="Libraries"');

    // Round-trip: re-parsing the export should find the same feeds.
    const roundTripPreview = previewOpmlImport(xml, freshUserId());
    expect(roundTripPreview.entries.filter((e) => e.status !== "invalid")).toHaveLength(3);
  });

  it("escapes XML-unsafe characters in titles", () => {
    userId = freshUserId();
    const preview = previewOpmlImport(fixture("unicode.opml"), userId);
    importOpmlEntries(userId, preview.entries);

    const xml = exportOpml(userId);
    expect(xml).toContain("日本語のブログ");
    expect(xml).toContain("Emoji Blog 🚀");
    expect(xml).not.toContain("Café & Société"); // unescaped & would be invalid XML
  });
});
