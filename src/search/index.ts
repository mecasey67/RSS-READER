import { rawSqlite } from "@/db/client";
import { listArticles, type ArticleListPage } from "@/articles/queries";

function buildFtsQuery(raw: string): string {
  const terms = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16) // bound query size
    .map((t) => `"${t.replace(/"/g, '""')}"*`); // quote+prefix each term: safe against FTS5 syntax errors
  return terms.join(" ");
}

/**
 * Full-text search over title/author/content/feed title, scoped to the
 * user's own subscriptions, returned in the same reverse-chronological shape
 * as the regular article list (search is a filter, not a different view).
 */
export function searchArticles(userId: number, rawQuery: string, limit = 100): ArticleListPage {
  const ftsQuery = buildFtsQuery(rawQuery);
  if (!ftsQuery) return { items: [], nextCursor: null };

  const rows = rawSqlite
    .prepare(`SELECT rowid as id FROM articles_fts WHERE articles_fts MATCH @query LIMIT @limit`)
    .all({ query: ftsQuery, limit }) as Array<{ id: number }>;

  if (rows.length === 0) return { items: [], nextCursor: null };

  return listArticles({ userId, articleIds: rows.map((r) => r.id), limit });
}
