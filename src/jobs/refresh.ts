import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { feeds, articles, type FeedStatus } from "@/db/schema";
import { fetchFeed, FeedFetchError } from "@/feeds/fetcher";
import { parseFeedXml, FeedParseError } from "@/feeds/parser";
import { normalizeFeed } from "@/feeds/normalizer";
import { logger } from "@/lib/logger";

const REFRESH_INTERVAL_MINUTES = Number(process.env.FEED_REFRESH_INTERVAL ?? 20);
const MAX_BACKOFF_MINUTES = 24 * 60;
const PERMANENT_FAILURE_THRESHOLD = 8;

export interface RefreshOutcome {
  feedId: number;
  outcome: "fetched" | "not_modified" | "failed";
  newArticles: number;
  updatedArticles: number;
  error?: string;
}

function backoffMinutes(consecutiveFailures: number): number {
  const minutes = REFRESH_INTERVAL_MINUTES * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(minutes, MAX_BACKOFF_MINUTES);
}

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function refreshFeed(feedId: number): Promise<RefreshOutcome> {
  const feed = db.select().from(feeds).where(eq(feeds.id, feedId)).get();
  if (!feed) throw new Error(`Feed ${feedId} not found`);

  logger.info("feed.fetch.started", { feedId, url: feed.feedUrl });
  const now = new Date().toISOString();

  try {
    const result = await fetchFeed(feed.feedUrl, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });

    logger.info("feed.fetch.completed", { feedId, httpStatus: result.httpStatus, status: result.status });

    if (result.status === "not_modified") {
      db.update(feeds)
        .set({
          lastCheckedAt: now,
          lastSuccessfulFetchAt: now,
          nextCheckAt: inMinutes(REFRESH_INTERVAL_MINUTES),
          consecutiveFailureCount: 0,
          status: "active" as FeedStatus,
          httpStatus: result.httpStatus,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(feeds.id, feedId))
        .run();
      return { feedId, outcome: "not_modified", newArticles: 0, updatedArticles: 0 };
    }

    let parsed;
    try {
      parsed = await parseFeedXml(result.body ?? "");
    } catch (err) {
      throw err instanceof FeedParseError ? err : new FeedParseError(String(err));
    }

    const normalized = normalizeFeed(parsed as never, feed.feedUrl);
    logger.info("feed.parse.result", { feedId, entries: normalized.articles.length });

    const { inserted, updated } = storeArticles(feedId, normalized.articles);

    db.update(feeds)
      .set({
        title: feed.title ?? normalized.meta.title,
        description: normalized.meta.description ?? feed.description,
        siteUrl: normalized.meta.siteUrl ?? feed.siteUrl,
        language: normalized.meta.language ?? feed.language,
        iconUrl: normalized.meta.iconUrl ?? feed.iconUrl,
        etag: result.etag ?? null,
        lastModified: result.lastModified ?? null,
        lastCheckedAt: now,
        lastSuccessfulFetchAt: now,
        nextCheckAt: inMinutes(REFRESH_INTERVAL_MINUTES),
        consecutiveFailureCount: 0,
        status: "active" as FeedStatus,
        httpStatus: result.httpStatus,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(feeds.id, feedId))
      .run();

    logger.info("feed.articles.stored", { feedId, inserted, updated });
    return { feedId, outcome: "fetched", newArticles: inserted, updatedArticles: updated };
  } catch (err) {
    return handleFailure(feedId, feed.consecutiveFailureCount, err);
  }
}

function handleFailure(feedId: number, priorFailures: number, err: unknown): RefreshOutcome {
  const now = new Date().toISOString();
  const failures = priorFailures + 1;

  let httpStatus: number | undefined;
  let retryAfter: number | undefined;
  let message = String(err);
  let permanent = false;

  if (err instanceof FeedFetchError) {
    httpStatus = err.httpStatus;
    retryAfter = err.retryAfterSeconds;
    message = err.message;
    // 404/410 are explicit "resource is gone" signals; still require a run
    // of repeated failures before calling it permanent, except 410 which is
    // unambiguous.
    if (httpStatus === 410) permanent = true;
  } else if (err instanceof FeedParseError) {
    message = err.message;
  } else {
    message = (err as Error).message ?? String(err);
  }

  if (failures >= PERMANENT_FAILURE_THRESHOLD) permanent = true;

  const status: FeedStatus = permanent ? "permanently_failed" : "temporarily_failed";
  const backoff = retryAfter ? Math.max(retryAfter / 60, backoffMinutes(failures)) : backoffMinutes(failures);

  logger.warn("feed.fetch.failed", { feedId, failures, status, message, httpStatus });

  db.update(feeds)
    .set({
      lastCheckedAt: now,
      nextCheckAt: permanent ? null : inMinutes(backoff),
      consecutiveFailureCount: failures,
      status,
      httpStatus: httpStatus ?? null,
      lastError: message,
      updatedAt: now,
    })
    .where(eq(feeds.id, feedId))
    .run();

  return { feedId, outcome: "failed", newArticles: 0, updatedArticles: 0, error: message };
}

function storeArticles(
  feedId: number,
  incoming: ReturnType<typeof normalizeFeed>["articles"],
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  db.transaction((tx) => {
    for (const item of incoming) {
      if (!item.externalId) continue; // normalizer always sets one, but stay defensive

      const existing =
        tx
          .select()
          .from(articles)
          .where(and(eq(articles.feedId, feedId), eq(articles.externalId, item.externalId)))
          .get() ??
        (item.canonicalUrl
          ? tx
              .select()
              .from(articles)
              .where(and(eq(articles.feedId, feedId), eq(articles.canonicalUrl, item.canonicalUrl)))
              .get()
          : undefined);

      if (!existing) {
        tx.insert(articles)
          .values({
            feedId,
            externalId: item.externalId,
            canonicalUrl: item.canonicalUrl,
            originalUrl: item.originalUrl,
            title: item.title,
            author: item.author,
            publishedAt: item.publishedAt,
            updatedAt: item.updatedAt,
            summaryHtml: item.summaryHtml,
            contentHtml: item.contentHtml,
            contentText: item.contentText,
            imageUrl: item.imageUrl,
            contentHash: item.contentHash,
            firstSeenAt: now,
            lastSeenAt: now,
            createdAt: now,
            dbUpdatedAt: now,
          })
          .run();
        inserted++;
        continue;
      }

      if (existing.contentHash === item.contentHash) {
        tx.update(articles).set({ lastSeenAt: now }).where(eq(articles.id, existing.id)).run();
        continue;
      }

      // Content changed since we last saw it: update fields but preserve
      // identity (id) and first_seen_at so read/starred state is untouched.
      tx.update(articles)
        .set({
          title: item.title,
          author: item.author,
          summaryHtml: item.summaryHtml,
          contentHtml: item.contentHtml,
          contentText: item.contentText,
          imageUrl: item.imageUrl,
          updatedAt: now,
          contentHash: item.contentHash,
          lastSeenAt: now,
          dbUpdatedAt: now,
        })
        .where(eq(articles.id, existing.id))
        .run();
      updated++;
    }
  });

  return { inserted, updated };
}
