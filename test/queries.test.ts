import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";

import { db, runMigrations } from "@/db/client";
import { users, feeds, folders, subscriptions, articles } from "@/db/schema";
import { listArticles, getSidebarData, getArticle } from "@/articles/queries";
import { markRead, setStarred } from "@/articles/state";

function freshUser(): number {
  const email = `q-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [u] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
  return u.id;
}

beforeAll(() => {
  runMigrations();
});

describe("listArticles pagination", () => {
  it("returns pages in reverse-chronological order with a working cursor", () => {
    const userId = freshUser();
    const now = Date.now();
    const [feed] = db.insert(feeds).values({ feedUrl: `https://q-${Math.random()}.example.com/feed`, status: "active", createdAt: "x", updatedAt: "x" }).returning().all();
    db.insert(subscriptions).values({ userId, feedId: feed.id, folderId: null, createdAt: "x" }).run();

    for (let i = 0; i < 25; i++) {
      const publishedAt = new Date(now - i * 60_000).toISOString(); // each one minute apart, i=0 is newest... wait i=0 should be oldest for clarity
      db.insert(articles)
        .values({
          feedId: feed.id,
          externalId: `a${i}`,
          title: `Article ${i}`,
          publishedAt,
          contentHash: `h${i}`,
          firstSeenAt: publishedAt,
          lastSeenAt: publishedAt,
          createdAt: publishedAt,
          dbUpdatedAt: publishedAt,
        })
        .run();
    }

    const page1 = listArticles({ userId, limit: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0].title).toBe("Article 0"); // i=0 has the most recent (largest) timestamp
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listArticles({ userId, limit: 10, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(10);
    expect(page2.items[0].title).toBe("Article 10");

    const page3 = listArticles({ userId, limit: 10, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(5);
    expect(page3.nextCursor).toBeNull();

    const seenIds = new Set([...page1.items, ...page2.items, ...page3.items].map((a) => a.id));
    expect(seenIds.size).toBe(25); // no duplicates or gaps across pages
  });

  it("filters by unread and starred views", () => {
    const userId = freshUser();
    const [feed] = db.insert(feeds).values({ feedUrl: `https://q2-${Math.random()}.example.com/feed`, status: "active", createdAt: "x", updatedAt: "x" }).returning().all();
    db.insert(subscriptions).values({ userId, feedId: feed.id, folderId: null, createdAt: "x" }).run();

    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const [a] = db
        .insert(articles)
        .values({ feedId: feed.id, externalId: `b${i}`, title: `B${i}`, contentHash: `hb${i}`, firstSeenAt: "2024-01-01", lastSeenAt: "2024-01-01", createdAt: "2024-01-01", dbUpdatedAt: "2024-01-01" })
        .returning()
        .all();
      ids.push(a.id);
    }
    markRead(userId, ids[0]);
    setStarred(userId, ids[1], true);

    const unread = listArticles({ userId, view: "unread" });
    expect(unread.items.map((i) => i.id).sort()).toEqual([ids[1], ids[2]].sort());

    const starred = listArticles({ userId, view: "starred" });
    expect(starred.items.map((i) => i.id)).toEqual([ids[1]]);
  });
});

describe("getSidebarData", () => {
  it("computes unread counts per feed and per folder, plus starred total", () => {
    const userId = freshUser();
    const [folder] = db.insert(folders).values({ userId, name: "Tech", parentId: null, createdAt: "x", updatedAt: "x" }).returning().all();
    const [feed1] = db.insert(feeds).values({ feedUrl: `https://s1-${Math.random()}.example.com/feed`, title: "Feed One", status: "active", createdAt: "x", updatedAt: "x" }).returning().all();
    const [feed2] = db.insert(feeds).values({ feedUrl: `https://s2-${Math.random()}.example.com/feed`, title: "Feed Two", status: "active", createdAt: "x", updatedAt: "x" }).returning().all();
    db.insert(subscriptions).values({ userId, feedId: feed1.id, folderId: folder.id, createdAt: "x" }).run();
    db.insert(subscriptions).values({ userId, feedId: feed2.id, folderId: null, createdAt: "x" }).run();

    for (let i = 0; i < 3; i++) {
      db.insert(articles).values({ feedId: feed1.id, externalId: `f1-${i}`, contentHash: `f1h${i}`, firstSeenAt: "x", lastSeenAt: "x", createdAt: "x", dbUpdatedAt: "x" }).run();
    }
    for (let i = 0; i < 2; i++) {
      db.insert(articles).values({ feedId: feed2.id, externalId: `f2-${i}`, contentHash: `f2h${i}`, firstSeenAt: "x", lastSeenAt: "x", createdAt: "x", dbUpdatedAt: "x" }).run();
    }

    const data = getSidebarData(userId);
    const tech = data.folders.find((f) => f.name === "Tech")!;
    expect(tech.unreadCount).toBe(3);
    expect(tech.feeds[0].unreadCount).toBe(3);
    expect(data.unfiledFeeds.find((f) => f.id === feed2.id)?.unreadCount).toBe(2);
    expect(data.totalUnread).toBe(5);
  });
});

describe("getArticle", () => {
  it("returns full content with read/starred flags", () => {
    const userId = freshUser();
    const [feed] = db.insert(feeds).values({ feedUrl: `https://g-${Math.random()}.example.com/feed`, status: "active", createdAt: "x", updatedAt: "x" }).returning().all();
    db.insert(subscriptions).values({ userId, feedId: feed.id, folderId: null, createdAt: "x" }).run();
    const [a] = db
      .insert(articles)
      .values({ feedId: feed.id, externalId: "g1", title: "Detail", contentHtml: "<p>Hi</p>", contentHash: "gh1", firstSeenAt: "x", lastSeenAt: "x", createdAt: "x", dbUpdatedAt: "x" })
      .returning()
      .all();

    const detail = getArticle(userId, a.id);
    expect(detail?.title).toBe("Detail");
    expect(detail?.contentHtml).toBe("<p>Hi</p>");
    expect(detail?.isRead).toBe(false);

    markRead(userId, a.id);
    const after = getArticle(userId, a.id);
    expect(after?.isRead).toBe(true);
  });

  it("returns null for a nonexistent article", () => {
    const userId = freshUser();
    expect(getArticle(userId, 999999)).toBeNull();
  });
});
