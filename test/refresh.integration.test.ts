import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.ALLOW_LOCAL_FEEDS = "true";
process.env.FEED_REFRESH_INTERVAL = "20";

import { db, runMigrations } from "@/db/client";
import { feeds, articles, users, userArticleStates } from "@/db/schema";
import { refreshFeed } from "@/jobs/refresh";

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures/feeds", name), "utf-8");
}

let server: Server;
let baseUrl: string;
let feedUrlCounter = 0;
function uniqueFeedUrl() {
  feedUrlCounter += 1;
  return `${baseUrl}?instance=${feedUrlCounter}`;
}
let currentBody = fixture("rss-article-updated-v1.xml");
let currentEtag = '"v1"';

beforeAll(async () => {
  runMigrations();
  server = http.createServer((req, res) => {
    if (req.headers["if-none-match"] === currentEtag) {
      res.writeHead(304, { ETag: currentEtag });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/rss+xml", ETag: currentEtag });
    res.end(currentBody);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/feed.xml`;
});

afterAll(() => {
  server.close();
});

describe("refreshFeed", () => {
  it("fetches and stores a new feed's articles", async () => {
    const [feed] = db.insert(feeds).values({ feedUrl: uniqueFeedUrl() }).returning().all();
    const outcome = await refreshFeed(feed.id);

    expect(outcome.outcome).toBe("fetched");
    expect(outcome.newArticles).toBe(1);

    const stored = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("Original Title");
  });

  it("returns not_modified and stores no duplicate on a 304 response", async () => {
    const [feed] = db.insert(feeds).values({ feedUrl: uniqueFeedUrl() }).returning().all();
    await refreshFeed(feed.id);
    db.update(feeds).set({ etag: currentEtag }).where(eq(feeds.id, feed.id)).run();

    const outcome = await refreshFeed(feed.id);
    expect(outcome.outcome).toBe("not_modified");

    const stored = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(stored).toHaveLength(1);
  });

  it("updates an existing article's content without creating a duplicate row or losing user state", async () => {
    const [user] = db
      .insert(users)
      .values({ email: `u-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x" })
      .returning()
      .all();
    const [feed] = db.insert(feeds).values({ feedUrl: uniqueFeedUrl() }).returning().all();

    currentBody = fixture("rss-article-updated-v1.xml");
    currentEtag = '"v1"';
    await refreshFeed(feed.id);

    const before = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(before).toHaveLength(1);
    const articleId = before[0].id;
    const firstSeenAt = before[0].firstSeenAt;

    db.insert(userArticleStates)
      .values({ userId: user.id, articleId, isStarred: true, starredAt: new Date().toISOString() })
      .run();

    currentBody = fixture("rss-article-updated-v2.xml");
    currentEtag = '"v2"';
    const outcome = await refreshFeed(feed.id);

    expect(outcome.outcome).toBe("fetched");
    expect(outcome.updatedArticles).toBe(1);
    expect(outcome.newArticles).toBe(0);

    const after = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(articleId); // identity preserved
    expect(after[0].title).toBe("Updated Title (corrected typo)");
    expect(after[0].firstSeenAt).toBe(firstSeenAt); // first_seen_at untouched

    const state = db
      .select()
      .from(userArticleStates)
      .where(eq(userArticleStates.articleId, articleId))
      .get();
    expect(state?.isStarred).toBe(true); // star survived the content update
  });

  it("collapses duplicate items within a single feed body into one article", async () => {
    currentBody = fixture("rss-duplicate-items.xml");
    currentEtag = '"dupe-1"';
    const [feed] = db.insert(feeds).values({ feedUrl: uniqueFeedUrl() }).returning().all();

    const outcome = await refreshFeed(feed.id);
    expect(outcome.newArticles).toBe(1);

    const stored = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(stored).toHaveLength(1);
  });

  it("re-importing the same unchanged feed twice never duplicates articles", async () => {
    currentBody = fixture("rss2-basic.xml");
    currentEtag = '"basic-no-conditional-support"';
    const [feed] = db.insert(feeds).values({ feedUrl: uniqueFeedUrl() }).returning().all();

    await refreshFeed(feed.id);
    // Simulate a server that doesn't honor conditional requests (still 200s
    // with identical content) — dedup must still hold via content hash.
    db.update(feeds).set({ etag: null, lastModified: null }).where(eq(feeds.id, feed.id)).run();
    const second = await refreshFeed(feed.id);

    expect(second.newArticles).toBe(0);
    expect(second.updatedArticles).toBe(0);

    const stored = db.select().from(articles).where(eq(articles.feedId, feed.id)).all();
    expect(stored).toHaveLength(2);
  });

  it("marks a feed permanently_failed on HTTP 410 Gone", async () => {
    const goneServer = http.createServer((_req, res) => {
      res.writeHead(410);
      res.end();
    });
    await new Promise<void>((resolve) => goneServer.listen(0, "127.0.0.1", resolve));
    const { port } = goneServer.address() as AddressInfo;

    const [feed] = db.insert(feeds).values({ feedUrl: `http://127.0.0.1:${port}/gone.xml` }).returning().all();
    const outcome = await refreshFeed(feed.id);

    expect(outcome.outcome).toBe("failed");
    const updated = db.select().from(feeds).where(eq(feeds.id, feed.id)).get();
    expect(updated?.status).toBe("permanently_failed");
    expect(updated?.nextCheckAt).toBeNull();

    goneServer.close();
  });

  it("marks a feed temporarily_failed (not permanent) after a single transient error", async () => {
    const errServer = http.createServer((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    await new Promise<void>((resolve) => errServer.listen(0, "127.0.0.1", resolve));
    const { port } = errServer.address() as AddressInfo;

    const [feed] = db.insert(feeds).values({ feedUrl: `http://127.0.0.1:${port}/err.xml` }).returning().all();
    const outcome = await refreshFeed(feed.id);

    expect(outcome.outcome).toBe("failed");
    const updated = db.select().from(feeds).where(eq(feeds.id, feed.id)).get();
    expect(updated?.status).toBe("temporarily_failed");
    expect(updated?.consecutiveFailureCount).toBe(1);
    expect(updated?.nextCheckAt).not.toBeNull();

    errServer.close();
  });
});
