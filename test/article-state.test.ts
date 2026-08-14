import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";

import { db, runMigrations } from "@/db/client";
import { users, feeds, folders, subscriptions, articles, userArticleStates } from "@/db/schema";
import { markRead, markUnread, setStarred, markFeedRead, markFolderRead, markAllRead } from "@/articles/state";

let userId: number;

function freshUser(): number {
  const email = `state-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [u] = db.insert(users).values({ email, passwordHash: "x" }).returning().all();
  return u.id;
}

function makeFeedWithArticles(count: number, folderId: number | null = null): { feedId: number; articleIds: number[] } {
  const now = new Date().toISOString();
  const [feed] = db.insert(feeds).values({ feedUrl: `https://state-test-${Math.random()}.example.com/feed`, status: "active", createdAt: now, updatedAt: now }).returning().all();
  db.insert(subscriptions).values({ userId, feedId: feed.id, folderId, createdAt: now }).run();
  const articleIds: number[] = [];
  for (let i = 0; i < count; i++) {
    const [a] = db
      .insert(articles)
      .values({
        feedId: feed.id,
        externalId: `art-${i}-${Math.random()}`,
        title: `Article ${i}`,
        contentHash: `hash-${i}-${Math.random()}`,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        dbUpdatedAt: now,
      })
      .returning()
      .all();
    articleIds.push(a.id);
  }
  return { feedId: feed.id, articleIds };
}

beforeAll(() => {
  runMigrations();
});

describe("markRead / markUnread / setStarred", () => {
  it("creates state on first mark and toggles correctly", () => {
    userId = freshUser();
    const { articleIds } = makeFeedWithArticles(1);
    const [id] = articleIds;

    markRead(userId, id);
    let state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
    expect(state?.isRead).toBe(true);
    expect(state?.readAt).not.toBeNull();

    markUnread(userId, id);
    state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
    expect(state?.isRead).toBe(false);
    expect(state?.readAt).toBeNull();

    setStarred(userId, id, true);
    state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
    expect(state?.isStarred).toBe(true);

    setStarred(userId, id, false);
    state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
    expect(state?.isStarred).toBe(false);
  });
});

describe("batch mark-read operations", () => {
  it("markFeedRead marks every article in a feed", () => {
    userId = freshUser();
    const { feedId, articleIds } = makeFeedWithArticles(5);
    markFeedRead(userId, feedId);

    for (const id of articleIds) {
      const state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
      expect(state?.isRead).toBe(true);
    }
  });

  it("markFolderRead marks every article across every feed in the folder, and no others", () => {
    userId = freshUser();
    const now = new Date().toISOString();
    const [folder] = db.insert(folders).values({ userId, name: "Tech", parentId: null, createdAt: now, updatedAt: now }).returning().all();

    const inFolder = makeFeedWithArticles(3, folder.id);
    const outsideFolder = makeFeedWithArticles(2, null);

    markFolderRead(userId, folder.id);

    for (const id of inFolder.articleIds) {
      const state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
      expect(state?.isRead).toBe(true);
    }
    for (const id of outsideFolder.articleIds) {
      const state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
      expect(state?.isRead ?? false).toBe(false);
    }
  });

  it("markAllRead marks every subscribed article across all feeds", () => {
    userId = freshUser();
    const a = makeFeedWithArticles(4);
    const b = makeFeedWithArticles(6);

    markAllRead(userId);

    for (const id of [...a.articleIds, ...b.articleIds]) {
      const state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
      expect(state?.isRead).toBe(true);
    }
  });

  it("does not mark another user's articles as read", () => {
    userId = freshUser();
    const otherUser = freshUser();
    const mine = makeFeedWithArticles(2);

    markAllRead(otherUser);

    for (const id of mine.articleIds) {
      const state = db.select().from(userArticleStates).where(eq(userArticleStates.articleId, id)).get();
      expect(state?.isRead ?? false).toBe(false);
    }
  });
});
