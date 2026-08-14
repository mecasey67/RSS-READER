import { rawSqlite } from "@/db/client";

export type ArticleView = "all" | "unread" | "starred";

export interface ArticleListFilters {
  userId: number;
  view?: ArticleView;
  feedId?: number;
  folderId?: number;
  dateFrom?: string; // ISO date, inclusive
  dateTo?: string; // ISO date, inclusive
  articleIds?: number[]; // restrict to a pre-filtered set (used by search)
  cursor?: { sortKey: string; id: number } | null;
  limit?: number;
}

export interface ArticleListItem {
  id: number;
  feedId: number;
  feedTitle: string | null;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  summary: string;
  imageUrl: string | null;
  originalUrl: string | null;
  isRead: boolean;
  isStarred: boolean;
  sortKey: string;
}

export interface ArticleListPage {
  items: ArticleListItem[];
  nextCursor: { sortKey: string; id: number } | null;
}

/**
 * Cursor-based pagination ordered by effective publish time (published_at,
 * falling back to first_seen_at when the feed didn't supply a usable date)
 * descending, so the article list never gets slower as the library grows —
 * unlike OFFSET pagination, a cursor scan only touches rows past the cursor.
 */
export function listArticles(filters: ArticleListFilters): ArticleListPage {
  const limit = Math.min(filters.limit ?? 50, 200);
  const where: string[] = ["s.user_id = @userId"];
  const params: Record<string, unknown> = { userId: filters.userId, limit: limit + 1 };

  if (filters.feedId) {
    where.push("a.feed_id = @feedId");
    params.feedId = filters.feedId;
  }
  if (filters.folderId) {
    where.push("s.folder_id = @folderId");
    params.folderId = filters.folderId;
  }
  if (filters.view === "unread") {
    where.push("(uas.is_read IS NULL OR uas.is_read = 0)");
  } else if (filters.view === "starred") {
    where.push("uas.is_starred = 1");
  }
  if (filters.dateFrom) {
    where.push("COALESCE(a.published_at, a.first_seen_at) >= @dateFrom");
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push("COALESCE(a.published_at, a.first_seen_at) <= @dateTo");
    params.dateTo = filters.dateTo;
  }
  if (filters.articleIds) {
    if (filters.articleIds.length === 0) return { items: [], nextCursor: null };
    where.push(`a.id IN (${filters.articleIds.map((_, i) => `@articleId${i}`).join(",")})`);
    filters.articleIds.forEach((id, i) => (params[`articleId${i}`] = id));
  }
  if (filters.cursor) {
    where.push("(COALESCE(a.published_at, a.first_seen_at), a.id) < (@cursorSortKey, @cursorId)");
    params.cursorSortKey = filters.cursor.sortKey;
    params.cursorId = filters.cursor.id;
  }

  const rows = rawSqlite
    .prepare(
      `
      SELECT
        a.id, a.feed_id as feedId, f.title as feedTitle, a.title, a.author,
        a.published_at as publishedAt, a.first_seen_at as firstSeenAt,
        a.summary_html as summaryHtml, a.image_url as imageUrl, a.original_url as originalUrl,
        COALESCE(uas.is_read, 0) as isRead, COALESCE(uas.is_starred, 0) as isStarred,
        COALESCE(a.published_at, a.first_seen_at) as sortKey
      FROM subscriptions s
      JOIN feeds f ON f.id = s.feed_id
      JOIN articles a ON a.feed_id = f.id
      LEFT JOIN user_article_states uas ON uas.article_id = a.id AND uas.user_id = @userId
      WHERE ${where.join(" AND ")}
      ORDER BY sortKey DESC, a.id DESC
      LIMIT @limit
      `,
    )
    .all(params) as Array<{
    id: number; feedId: number; feedTitle: string | null; title: string | null; author: string | null;
    publishedAt: string | null; firstSeenAt: string; summaryHtml: string | null; imageUrl: string | null;
    originalUrl: string | null; isRead: number; isStarred: number; sortKey: string;
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((r) => ({
      id: r.id,
      feedId: r.feedId,
      feedTitle: r.feedTitle,
      title: r.title,
      author: r.author,
      publishedAt: r.publishedAt,
      firstSeenAt: r.firstSeenAt,
      summary: r.summaryHtml ?? "",
      imageUrl: r.imageUrl,
      originalUrl: r.originalUrl,
      isRead: !!r.isRead,
      isStarred: !!r.isStarred,
      sortKey: r.sortKey,
    })),
    nextCursor: hasMore ? { sortKey: page[page.length - 1].sortKey, id: page[page.length - 1].id } : null,
  };
}

export interface ArticleDetail extends ArticleListItem {
  contentHtml: string;
}

export function getArticle(userId: number, articleId: number): ArticleDetail | null {
  const row = rawSqlite
    .prepare(
      `
      SELECT
        a.id, a.feed_id as feedId, f.title as feedTitle, a.title, a.author,
        a.published_at as publishedAt, a.first_seen_at as firstSeenAt,
        a.summary_html as summaryHtml, a.content_html as contentHtml,
        a.image_url as imageUrl, a.original_url as originalUrl,
        COALESCE(uas.is_read, 0) as isRead, COALESCE(uas.is_starred, 0) as isStarred,
        COALESCE(a.published_at, a.first_seen_at) as sortKey
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN user_article_states uas ON uas.article_id = a.id AND uas.user_id = @userId
      WHERE a.id = @articleId
      `,
    )
    .get({ userId, articleId }) as
    | {
        id: number; feedId: number; feedTitle: string | null; title: string | null; author: string | null;
        publishedAt: string | null; firstSeenAt: string; summaryHtml: string | null; contentHtml: string | null;
        imageUrl: string | null; originalUrl: string | null; isRead: number; isStarred: number; sortKey: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    title: row.title,
    author: row.author,
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    summary: row.summaryHtml ?? "",
    contentHtml: row.contentHtml ?? "",
    imageUrl: row.imageUrl,
    originalUrl: row.originalUrl,
    isRead: !!row.isRead,
    isStarred: !!row.isStarred,
    sortKey: row.sortKey,
  };
}

export interface SidebarFeed {
  id: number;
  title: string;
  unreadCount: number;
  status: string;
  lastError: string | null;
}

export interface SidebarFolder {
  id: number;
  name: string;
  feeds: SidebarFeed[];
  unreadCount: number;
}

export interface SidebarData {
  totalUnread: number;
  starredCount: number;
  folders: SidebarFolder[];
  unfiledFeeds: SidebarFeed[];
}

export function getSidebarData(userId: number): SidebarData {
  const feedRows = rawSqlite
    .prepare(
      `
      SELECT
        f.id, COALESCE(s.custom_title, f.title, f.feed_url) as title, s.folder_id as folderId,
        f.status, f.last_error as lastError,
        COUNT(CASE WHEN uas.is_read IS NULL OR uas.is_read = 0 THEN a.id END) as unreadCount
      FROM subscriptions s
      JOIN feeds f ON f.id = s.feed_id
      LEFT JOIN articles a ON a.feed_id = f.id
      LEFT JOIN user_article_states uas ON uas.article_id = a.id AND uas.user_id = @userId
      WHERE s.user_id = @userId
      GROUP BY f.id
      ORDER BY title COLLATE NOCASE
      `,
    )
    .all({ userId }) as Array<{ id: number; title: string; folderId: number | null; status: string; lastError: string | null; unreadCount: number }>;

  const folderRows = rawSqlite
    .prepare(`SELECT id, name FROM folders WHERE user_id = @userId ORDER BY name COLLATE NOCASE`)
    .all({ userId }) as Array<{ id: number; name: string }>;

  const starredCount = (
    rawSqlite.prepare(`SELECT COUNT(*) as c FROM user_article_states WHERE user_id = @userId AND is_starred = 1`).get({ userId }) as { c: number }
  ).c;

  const folders: SidebarFolder[] = folderRows.map((f) => ({ id: f.id, name: f.name, feeds: [], unreadCount: 0 }));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const unfiledFeeds: SidebarFeed[] = [];
  let totalUnread = 0;

  for (const row of feedRows) {
    const feed: SidebarFeed = { id: row.id, title: row.title, unreadCount: row.unreadCount, status: row.status, lastError: row.lastError };
    totalUnread += row.unreadCount;
    const folder = row.folderId !== null ? folderById.get(row.folderId) : undefined;
    if (folder) {
      folder.feeds.push(feed);
      folder.unreadCount += row.unreadCount;
    } else {
      unfiledFeeds.push(feed);
    }
  }

  return { totalUnread, starredCount, folders, unfiledFeeds };
}
