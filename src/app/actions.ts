"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { runMigrations } from "@/db/client";
import { markRead, markUnread, setStarred, markFeedRead, markFolderRead, markAllRead } from "@/articles/state";
import { previewOpmlImport, importOpmlEntries } from "@/opml/importer";
import type { OpmlPreviewEntry, OpmlPreviewResult, OpmlImportSummary } from "@/opml/types";
import { exportOpml } from "@/opml/exporter";
import { addFeedByUrl, unsubscribe, deleteFeedAndArticles, moveToFolder, renameSubscription, updateFeedUrl, createFolder, type AddFeedResult } from "@/feeds/manage";
import { refreshFeed } from "@/jobs/refresh";
import { refreshAllDueFeeds, refreshFeedsNow } from "@/jobs/scheduler";
import { searchArticles as searchArticlesQuery } from "@/search/index";
import { listArticles, type ArticleView } from "@/articles/queries";

runMigrations();

export interface LoadMoreParams {
  view: ArticleView;
  feedId?: number;
  folderId?: number;
  query?: string;
  cursor: { sortKey: string; id: number };
}

export async function loadMoreArticlesAction(params: LoadMoreParams) {
  const userId = getCurrentUserId();
  if (params.query) {
    // Search results are a single bounded batch (see search/index.ts), not
    // cursor-paginated — there's nothing more to load past the first page.
    return { items: [], nextCursor: null } as Awaited<ReturnType<typeof listArticles>>;
  }
  return listArticles({ userId, view: params.view, feedId: params.feedId, folderId: params.folderId, cursor: params.cursor, limit: 50 });
}

export async function markArticleRead(articleId: number) {
  markRead(getCurrentUserId(), articleId);
  revalidatePath("/");
}

export async function markArticleUnread(articleId: number) {
  markUnread(getCurrentUserId(), articleId);
  revalidatePath("/");
}

export async function toggleStar(articleId: number, starred: boolean) {
  setStarred(getCurrentUserId(), articleId, starred);
  revalidatePath("/");
}

export async function markAllReadAction(scope: { feedId?: number; folderId?: number }) {
  const userId = getCurrentUserId();
  if (scope.feedId) markFeedRead(userId, scope.feedId);
  else if (scope.folderId) markFolderRead(userId, scope.folderId);
  else markAllRead(userId);
  revalidatePath("/");
}

const MAX_OPML_BYTES = Number(process.env.MAX_OPML_SIZE ?? 10 * 1024 * 1024);

export async function previewOpml(fileContents: string): Promise<OpmlPreviewResult> {
  // Client-side size checks (ImportOpmlFlow) are a UX nicety, not a
  // boundary — a server action is a public entry point, so the limit is
  // re-enforced here regardless of what the calling client already checked.
  if (Buffer.byteLength(fileContents, "utf-8") > MAX_OPML_BYTES) {
    throw new Error(`OPML file exceeds the maximum allowed size of ${Math.round(MAX_OPML_BYTES / 1024 / 1024)} MB`);
  }
  return previewOpmlImport(fileContents, getCurrentUserId());
}

export async function confirmOpmlImport(entries: OpmlPreviewEntry[]): Promise<OpmlImportSummary> {
  const userId = getCurrentUserId();
  const summary = importOpmlEntries(userId, entries);
  revalidatePath("/");
  // Kick off an initial refresh for newly imported feeds in the background;
  // don't block the import confirmation on network fetches.
  void refreshAllDueFeeds({ force: false }).catch(() => {});
  return summary;
}

export async function exportOpmlAction(): Promise<string> {
  return exportOpml(getCurrentUserId());
}

export async function addFeedAction(url: string, folderId: number | null): Promise<AddFeedResult> {
  const result = await addFeedByUrl(getCurrentUserId(), url, folderId);
  if (result.kind === "subscribed") {
    void refreshFeed(result.feedId).catch(() => {});
  }
  revalidatePath("/");
  return result;
}

export async function unsubscribeAction(subscriptionId: number) {
  unsubscribe(getCurrentUserId(), subscriptionId);
  revalidatePath("/");
}

export async function deleteFeedAction(feedId: number) {
  deleteFeedAndArticles(getCurrentUserId(), feedId);
  revalidatePath("/");
}

export async function moveToFolderAction(subscriptionId: number, folderId: number | null) {
  moveToFolder(getCurrentUserId(), subscriptionId, folderId);
  revalidatePath("/");
}

export async function renameSubscriptionAction(subscriptionId: number, customTitle: string | null) {
  renameSubscription(getCurrentUserId(), subscriptionId, customTitle);
  revalidatePath("/");
}

export async function updateFeedUrlAction(feedId: number, newUrl: string) {
  const result = await updateFeedUrl(getCurrentUserId(), feedId, newUrl);
  if (result.kind === "updated") {
    void refreshFeed(feedId).catch(() => {});
  }
  revalidatePath("/");
  return result;
}

export async function createFolderAction(name: string) {
  const folder = createFolder(getCurrentUserId(), name);
  revalidatePath("/");
  return folder;
}

export async function refreshFeedAction(feedId: number) {
  const outcome = await refreshFeed(feedId);
  revalidatePath("/");
  return outcome;
}

export async function refreshAllAction() {
  const outcomes = await refreshFeedsNow(getCurrentUserId());
  revalidatePath("/");
  return outcomes;
}

export async function searchArticlesAction(query: string) {
  return searchArticlesQuery(getCurrentUserId(), query);
}
