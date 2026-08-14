import pLimit from "p-limit";
import { lte, or, isNull, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { feeds, subscriptions } from "@/db/schema";
import { refreshFeed, type RefreshOutcome } from "./refresh";
import { logger } from "@/lib/logger";

const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY ?? 4);
const SCHEDULER_TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 60_000);

// Guards against refresh storms from repeated manual-refresh clicks or
// overlapping scheduler ticks: only one refresh per feed id may be in
// flight at a time: concurrent callers await the same in-flight promise
// instead of issuing a second fetch.
const inFlight = new Map<number, Promise<RefreshOutcome>>();

function refreshFeedDeduped(feedId: number): Promise<RefreshOutcome> {
  const existing = inFlight.get(feedId);
  if (existing) return existing;
  const promise = refreshFeed(feedId).finally(() => inFlight.delete(feedId));
  inFlight.set(feedId, promise);
  return promise;
}

async function refreshFeedIds(feedIds: number[]): Promise<RefreshOutcome[]> {
  const limit = pLimit(FETCH_CONCURRENCY);
  return Promise.all(feedIds.map((id) => limit(() => refreshFeedDeduped(id))));
}

/** Refreshes every feed whose next_check_at has arrived (or has none yet). */
export async function refreshAllDueFeeds(opts: { force?: boolean } = {}): Promise<RefreshOutcome[]> {
  const now = new Date().toISOString();
  const due = opts.force
    ? db.select({ id: feeds.id }).from(feeds).all()
    : db
        .select({ id: feeds.id })
        .from(feeds)
        .where(or(isNull(feeds.nextCheckAt), lte(feeds.nextCheckAt, now)))
        .all();

  if (due.length === 0) return [];
  logger.info("scheduler.tick", { dueCount: due.length });
  return refreshFeedIds(due.map((f) => f.id));
}

/** Refreshes every feed the given user is subscribed to, right now (manual "Refresh all"). */
export async function refreshFeedsNow(userId: number): Promise<RefreshOutcome[]> {
  const rows = db.select({ feedId: subscriptions.feedId }).from(subscriptions).where(eq(subscriptions.userId, userId)).all();
  return refreshFeedIds(rows.map((r) => r.feedId));
}

let schedulerHandle: NodeJS.Timeout | null = null;

/** Starts the in-process background polling loop. Idempotent. */
export function startScheduler() {
  if (schedulerHandle) return;
  logger.info("scheduler.started", { tickMs: SCHEDULER_TICK_MS, concurrency: FETCH_CONCURRENCY });
  schedulerHandle = setInterval(() => {
    refreshAllDueFeeds().catch((err) => logger.error("scheduler.tick.failed", { message: String(err) }));
  }, SCHEDULER_TICK_MS);
  // Don't let the interval keep the process alive by itself in non-server contexts (e.g. scripts/tests).
  schedulerHandle.unref?.();
}

export function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
