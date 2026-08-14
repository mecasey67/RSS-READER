import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.ALLOW_LOCAL_FEEDS = "true";

import { db, runMigrations } from "@/db/client";
import { feeds, folders, users, subscriptions } from "@/db/schema";
import { updateFeedUrl } from "@/feeds/manage";

let server: Server;
let baseUrl: string;

function freshUser(): number {
  const email = `urlupdate-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [u] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
  return u.id;
}

beforeAll(async () => {
  runMigrations();
  server = http.createServer((req, res) => {
    if (req.url?.includes("/not-a-feed")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>not a feed</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end(
      '<rss version="2.0"><channel><title>Updated Feed</title><link>https://example.com</link><description>d</description></channel></rss>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

function makeSubscribedFeed(userId: number, feedUrl: string, folderId: number | null = null) {
  const now = new Date().toISOString();
  const [feed] = db
    .insert(feeds)
    .values({
      feedUrl,
      status: "temporarily_failed",
      consecutiveFailureCount: 3,
      etag: '"old-etag"',
      lastModified: "old-last-modified",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const [sub] = db.insert(subscriptions).values({ userId, feedId: feed.id, folderId, createdAt: now }).returning().all();
  return { feed, sub };
}

describe("updateFeedUrl", () => {
  it("updates the URL in place, preserving feed id, folder, and subscription", async () => {
    const userId = freshUser();
    const [folder] = db.insert(folders).values({ userId, name: "Tech", parentId: null, createdAt: "x", updatedAt: "x" }).returning().all();
    const { feed, sub } = makeSubscribedFeed(userId, `${baseUrl}/old-path-${Math.random()}`, folder.id);

    const newUrl = `${baseUrl}/new-path-${Math.random()}`;
    const result = await updateFeedUrl(userId, feed.id, newUrl);

    expect(result.kind).toBe("updated");

    const updated = db.select().from(feeds).where(eq(feeds.id, feed.id)).get();
    expect(updated?.feedUrl).toBe(newUrl);
    // identity and folder assignment survive the URL change
    const stillSubscribed = db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)).get();
    expect(stillSubscribed?.feedId).toBe(feed.id);
    expect(stillSubscribed?.folderId).toBe(folder.id);
  });

  it("resets conditional-request and backoff state on a successful update", async () => {
    const userId = freshUser();
    const { feed } = makeSubscribedFeed(userId, `${baseUrl}/old-${Math.random()}`);

    await updateFeedUrl(userId, feed.id, `${baseUrl}/fresh-${Math.random()}`);

    const updated = db.select().from(feeds).where(eq(feeds.id, feed.id)).get();
    expect(updated?.etag).toBeNull();
    expect(updated?.lastModified).toBeNull();
    expect(updated?.consecutiveFailureCount).toBe(0);
    expect(updated?.status).toBe("active");
  });

  it("returns unchanged when the normalized URL is identical to the current one", async () => {
    const userId = freshUser();
    const url = `${baseUrl}/same-path`;
    const { feed } = makeSubscribedFeed(userId, url);

    // trailing slash normalizes to the same URL already stored
    const result = await updateFeedUrl(userId, feed.id, `${url}/`);
    expect(result.kind).toBe("unchanged");
  });

  it("rejects a URL already used by a different feed", async () => {
    const userId = freshUser();
    const takenUrl = `${baseUrl}/taken-${Math.random()}`;
    makeSubscribedFeed(userId, takenUrl);
    const { feed: feedToChange } = makeSubscribedFeed(userId, `${baseUrl}/mine-${Math.random()}`);

    const result = await updateFeedUrl(userId, feedToChange.id, takenUrl);
    expect(result.kind).toBe("conflict");

    const unchanged = db.select().from(feeds).where(eq(feeds.id, feedToChange.id)).get();
    expect(unchanged?.feedUrl).not.toBe(takenUrl);
  });

  it("rejects a URL that isn't a valid feed", async () => {
    const userId = freshUser();
    const { feed } = makeSubscribedFeed(userId, `${baseUrl}/old-${Math.random()}`);

    const result = await updateFeedUrl(userId, feed.id, `${baseUrl}/not-a-feed`);
    expect(result.kind).toBe("invalid");
  });

  it("rejects updating a feed the user isn't subscribed to", async () => {
    const owner = freshUser();
    const intruder = freshUser();
    const { feed } = makeSubscribedFeed(owner, `${baseUrl}/owned-${Math.random()}`);

    const result = await updateFeedUrl(intruder, feed.id, `${baseUrl}/hijack-${Math.random()}`);
    expect(result.kind).toBe("invalid");

    const unchanged = db.select().from(feeds).where(eq(feeds.id, feed.id)).get();
    expect(unchanged?.feedUrl).not.toContain("hijack");
  });
});
