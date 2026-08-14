import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { feeds, folders, subscriptions } from "@/db/schema";
import { discoverFeeds, looksLikeFeedUrl } from "./discovery";
import { parseFeedXml } from "./parser";
import { fetchFeed } from "./fetcher";
import { normalizeFeedUrl } from "@/lib/urls";
import { logger } from "@/lib/logger";

export type AddFeedResult =
  | { kind: "subscribed"; feedId: number; title: string | null }
  | { kind: "already_subscribed"; feedId: number; title: string | null }
  | { kind: "needs_selection"; candidates: { url: string; title: string | null }[] }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

async function isValidFeed(url: string): Promise<boolean> {
  try {
    const result = await fetchFeed(url);
    if (result.status !== "ok" || !result.body) return false;
    await parseFeedXml(result.body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Accepts either a direct feed URL or an ordinary webpage URL. For webpages,
 * discovers advertised feeds via <link rel="alternate"> and never guesses a
 * feed URL that wasn't explicitly advertised.
 */
export async function addFeedByUrl(userId: number, rawUrl: string, folderId: number | null): Promise<AddFeedResult> {
  const normalized = normalizeFeedUrl(rawUrl);
  if (!normalized) return { kind: "error", message: "Not a valid URL" };

  if (looksLikeFeedUrl(normalized) && (await isValidFeed(normalized))) {
    return subscribeToFeedUrl(userId, normalized, folderId);
  }
  // Try it as a feed URL anyway (many feeds don't have a recognizable extension).
  if (await isValidFeed(normalized)) {
    return subscribeToFeedUrl(userId, normalized, folderId);
  }

  const discovered = await discoverFeeds(normalized);
  if (discovered.length === 0) return { kind: "not_found" };
  if (discovered.length === 1) return subscribeToFeedUrl(userId, discovered[0].url, folderId);
  return { kind: "needs_selection", candidates: discovered.map((d) => ({ url: d.url, title: d.title })) };
}

export function subscribeToFeedUrl(userId: number, feedUrl: string, folderId: number | null): AddFeedResult {
  const normalized = normalizeFeedUrl(feedUrl);
  if (!normalized) return { kind: "error", message: "Not a valid URL" };

  let feed = db.select().from(feeds).where(eq(feeds.feedUrl, normalized)).get();
  if (!feed) {
    const now = new Date().toISOString();
    const [created] = db
      .insert(feeds)
      .values({ feedUrl: normalized, status: "active", createdAt: now, updatedAt: now, nextCheckAt: now })
      .returning()
      .all();
    feed = created;
  }

  const existingSub = db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feed.id)))
    .get();
  if (existingSub) return { kind: "already_subscribed", feedId: feed.id, title: feed.title };

  db.insert(subscriptions).values({ userId, feedId: feed.id, folderId, createdAt: new Date().toISOString() }).run();
  logger.info("subscription.created", { userId, feedId: feed.id });
  return { kind: "subscribed", feedId: feed.id, title: feed.title };
}

export type UpdateFeedUrlResult =
  | { kind: "updated" }
  | { kind: "unchanged" }
  | { kind: "conflict"; message: string }
  | { kind: "invalid"; message: string };

/**
 * Changes a feed's URL in place — same feed row, same folder assignment,
 * same article history. Distinct from unsubscribe+re-add, which would lose
 * all of that. Conditional-request state is reset (the old ETag/Last-Modified
 * belong to the old URL) and the feed is queued for an immediate refresh.
 */
export async function updateFeedUrl(userId: number, feedId: number, rawUrl: string): Promise<UpdateFeedUrlResult> {
  const owns = db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
    .get();
  if (!owns) return { kind: "invalid", message: "Feed not found" };

  const normalized = normalizeFeedUrl(rawUrl);
  if (!normalized) return { kind: "invalid", message: "Not a valid URL" };

  const feed = db.select().from(feeds).where(eq(feeds.id, feedId)).get();
  if (!feed) return { kind: "invalid", message: "Feed not found" };
  if (feed.feedUrl === normalized) return { kind: "unchanged" };

  const conflicting = db.select().from(feeds).where(eq(feeds.feedUrl, normalized)).get();
  if (conflicting) {
    return { kind: "conflict", message: "You're already subscribed to a feed at that URL" };
  }

  if (!(await isValidFeed(normalized))) {
    return { kind: "invalid", message: "That URL doesn't look like a valid RSS/Atom feed" };
  }

  const now = new Date().toISOString();
  db.update(feeds)
    .set({
      feedUrl: normalized,
      etag: null,
      lastModified: null,
      consecutiveFailureCount: 0,
      status: "active",
      httpStatus: null,
      lastError: null,
      nextCheckAt: now,
      updatedAt: now,
    })
    .where(eq(feeds.id, feedId))
    .run();

  logger.info("feed.url_updated", { feedId });
  return { kind: "updated" };
}

export function unsubscribe(userId: number, subscriptionId: number) {
  db.delete(subscriptions).where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId))).run();
}

/** Explicit, separate action from unsubscribe(): also deletes the feed and
 * its articles, but only if no other user is still subscribed to it. */
export function deleteFeedAndArticles(userId: number, feedId: number) {
  db.transaction((tx) => {
    tx.delete(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId))).run();
    const stillSubscribed = tx.select().from(subscriptions).where(eq(subscriptions.feedId, feedId)).get();
    if (!stillSubscribed) {
      tx.delete(feeds).where(eq(feeds.id, feedId)).run(); // cascades to articles
    }
  });
}

export function moveToFolder(userId: number, subscriptionId: number, folderId: number | null) {
  db.update(subscriptions)
    .set({ folderId })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .run();
}

export function renameSubscription(userId: number, subscriptionId: number, customTitle: string | null) {
  db.update(subscriptions)
    .set({ customTitle })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .run();
}

export function createFolder(userId: number, name: string, parentId: number | null = null) {
  const now = new Date().toISOString();
  const [folder] = db.insert(folders).values({ userId, name, parentId, createdAt: now, updatedAt: now }).returning().all();
  return folder;
}

export interface FeedManagementRow {
  subscriptionId: number;
  feedId: number;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  folderId: number | null;
  folderName: string | null;
  status: string;
  lastSuccessfulFetchAt: string | null;
  lastCheckedAt: string | null;
  consecutiveFailureCount: number;
  lastError: string | null;
  httpStatus: number | null;
}

export function listFeedsForManagement(userId: number): FeedManagementRow[] {
  const rows = db
    .select({
      subscriptionId: subscriptions.id,
      feedId: feeds.id,
      customTitle: subscriptions.customTitle,
      feedTitle: feeds.title,
      feedUrl: feeds.feedUrl,
      siteUrl: feeds.siteUrl,
      folderId: subscriptions.folderId,
      folderName: folders.name,
      status: feeds.status,
      lastSuccessfulFetchAt: feeds.lastSuccessfulFetchAt,
      lastCheckedAt: feeds.lastCheckedAt,
      consecutiveFailureCount: feeds.consecutiveFailureCount,
      lastError: feeds.lastError,
      httpStatus: feeds.httpStatus,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .leftJoin(folders, eq(subscriptions.folderId, folders.id))
    .where(eq(subscriptions.userId, userId))
    .all();

  return rows.map((r) => ({
    subscriptionId: r.subscriptionId,
    feedId: r.feedId,
    title: r.customTitle ?? r.feedTitle ?? r.feedUrl,
    feedUrl: r.feedUrl,
    siteUrl: r.siteUrl,
    folderId: r.folderId,
    folderName: r.folderName,
    status: r.status,
    lastSuccessfulFetchAt: r.lastSuccessfulFetchAt,
    lastCheckedAt: r.lastCheckedAt,
    consecutiveFailureCount: r.consecutiveFailureCount,
    lastError: r.lastError,
    httpStatus: r.httpStatus,
  }));
}
