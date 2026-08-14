import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { articles, subscriptions, userArticleStates } from "@/db/schema";

function upsertState(userId: number, articleId: number, patch: Partial<typeof userArticleStates.$inferInsert>) {
  const existing = db
    .select()
    .from(userArticleStates)
    .where(and(eq(userArticleStates.userId, userId), eq(userArticleStates.articleId, articleId)))
    .get();

  if (existing) {
    db.update(userArticleStates)
      .set(patch)
      .where(and(eq(userArticleStates.userId, userId), eq(userArticleStates.articleId, articleId)))
      .run();
  } else {
    db.insert(userArticleStates)
      .values({ userId, articleId, isRead: false, isStarred: false, ...patch })
      .run();
  }
}

export function markRead(userId: number, articleId: number) {
  upsertState(userId, articleId, { isRead: true, readAt: new Date().toISOString() });
}

export function markUnread(userId: number, articleId: number) {
  upsertState(userId, articleId, { isRead: false, readAt: null });
}

export function setStarred(userId: number, articleId: number, starred: boolean) {
  upsertState(userId, articleId, { isStarred: starred, starredAt: starred ? new Date().toISOString() : null });
}

/** Marks every currently-visible article id read in one batch write. */
export function markManyRead(userId: number, articleIds: number[]) {
  if (articleIds.length === 0) return;
  const now = new Date().toISOString();

  db.transaction((tx) => {
    const existingRows = tx
      .select({ articleId: userArticleStates.articleId })
      .from(userArticleStates)
      .where(and(eq(userArticleStates.userId, userId), inArray(userArticleStates.articleId, articleIds)))
      .all();
    const existingIds = new Set(existingRows.map((r) => r.articleId));

    if (existingIds.size > 0) {
      tx.update(userArticleStates)
        .set({ isRead: true, readAt: now })
        .where(and(eq(userArticleStates.userId, userId), inArray(userArticleStates.articleId, Array.from(existingIds))))
        .run();
    }

    const missing = articleIds.filter((id) => !existingIds.has(id));
    for (const articleId of missing) {
      tx.insert(userArticleStates).values({ userId, articleId, isRead: true, readAt: now, isStarred: false }).run();
    }
  });
}

/** Marks every article in a feed read (used by "mark all as read" at feed scope). */
export function markFeedRead(userId: number, feedId: number) {
  const ids = db.select({ id: articles.id }).from(articles).where(eq(articles.feedId, feedId)).all();
  markManyRead(userId, ids.map((r) => r.id));
}

/** Marks every article in every feed belonging to a folder read. */
export function markFolderRead(userId: number, folderId: number) {
  const feedIds = db
    .select({ feedId: subscriptions.feedId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.folderId, folderId)))
    .all()
    .map((r) => r.feedId);
  if (feedIds.length === 0) return;
  const ids = db.select({ id: articles.id }).from(articles).where(inArray(articles.feedId, feedIds)).all();
  markManyRead(userId, ids.map((r) => r.id));
}

/** Marks every unread article currently subscribed to by the user read. */
export function markAllRead(userId: number) {
  const feedIds = db
    .select({ feedId: subscriptions.feedId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .all()
    .map((r) => r.feedId);
  if (feedIds.length === 0) return;
  const ids = db.select({ id: articles.id }).from(articles).where(inArray(articles.feedId, feedIds)).all();
  markManyRead(userId, ids.map((r) => r.id));
}
