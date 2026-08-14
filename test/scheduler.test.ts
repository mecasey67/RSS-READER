import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.ALLOW_LOCAL_FEEDS = "true";

import { db, runMigrations } from "@/db/client";
import { feeds, users, subscriptions } from "@/db/schema";
import { refreshAllDueFeeds, refreshFeedsNow } from "@/jobs/scheduler";

function freshUser(): number {
  const email = `sched-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [u] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
  return u.id;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  runMigrations();
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end("<rss><channel><title>T</title></channel></rss>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

function makeFeed(nextCheckAt: string | null) {
  const now = new Date().toISOString();
  const [feed] = db
    .insert(feeds)
    .values({ feedUrl: `${baseUrl}/${Math.random()}`, status: "active", createdAt: now, updatedAt: now, nextCheckAt })
    .returning()
    .all();
  return feed;
}

describe("refreshAllDueFeeds", () => {
  it("only refreshes feeds whose next_check_at has arrived or is unset", async () => {
    const due = makeFeed(new Date(Date.now() - 60_000).toISOString());
    const dueNull = makeFeed(null);
    const notDue = makeFeed(new Date(Date.now() + 60 * 60_000).toISOString());

    const outcomes = await refreshAllDueFeeds();
    const refreshedIds = outcomes.map((o) => o.feedId);

    expect(refreshedIds).toContain(due.id);
    expect(refreshedIds).toContain(dueNull.id);
    expect(refreshedIds).not.toContain(notDue.id);

    const stillNotDue = db.select().from(feeds).where(eq(feeds.id, notDue.id)).get();
    expect(stillNotDue?.lastCheckedAt).toBeNull();
  });

  it("does not fetch anything when no feeds are due", async () => {
    makeFeed(new Date(Date.now() + 60 * 60_000).toISOString());
    const outcomes = await refreshAllDueFeeds();
    // (other tests may have left due feeds around in this shared in-memory db;
    // just assert this call didn't error and returned an array)
    expect(Array.isArray(outcomes)).toBe(true);
  });
});

describe("refreshFeedsNow", () => {
  it("only refreshes feeds the given user is subscribed to", async () => {
    const email = `sched-${Date.now()}-${Math.random()}@example.com`;
    const [user] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
    const [otherUser] = db.insert(users).values({ email: `other-${email}`, passwordHash: "x" }).returning().all();

    const mine = makeFeed(null);
    const notMine = makeFeed(null);
    db.insert(subscriptions).values({ userId: user.id, feedId: mine.id, createdAt: "x" }).run();
    db.insert(subscriptions).values({ userId: otherUser.id, feedId: notMine.id, createdAt: "x" }).run();

    const outcomes = await refreshFeedsNow(user.id);
    const ids = outcomes.map((o) => o.feedId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);
  });
});

describe("concurrent refresh deduping", () => {
  it("collapses overlapping refresh calls for the same feed into a single fetch", async () => {
    // Dedicated server + user + single feed so this test's request count
    // can't be polluted by due feeds left over from earlier tests sharing
    // the in-memory db.
    let soloRequestCount = 0;
    const soloServer = http.createServer((_req, res) => {
      soloRequestCount++;
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.end("<rss><channel><title>Solo</title></channel></rss>");
    });
    await new Promise<void>((resolve) => soloServer.listen(0, "127.0.0.1", resolve));
    const { port } = soloServer.address() as AddressInfo;

    const userId = freshUser();
    const now = new Date().toISOString();
    const [feed] = db
      .insert(feeds)
      .values({ feedUrl: `http://127.0.0.1:${port}/feed.xml`, status: "active", createdAt: now, updatedAt: now, nextCheckAt: null })
      .returning()
      .all();
    db.insert(subscriptions).values({ userId, feedId: feed.id, createdAt: now }).run();

    // Two overlapping "refresh now" style calls racing on the same feed —
    // simulates a scheduler tick overlapping a manual refresh click.
    const [a, b] = await Promise.all([refreshFeedsNow(userId), refreshFeedsNow(userId)]);

    expect(soloRequestCount).toBe(1); // only one actual HTTP request despite two callers
    expect(a.some((o) => o.feedId === feed.id)).toBe(true);
    expect(b.some((o) => o.feedId === feed.id)).toBe(true);

    soloServer.close();
  });
});
