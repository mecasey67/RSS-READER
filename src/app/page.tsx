import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { getSidebarData, listArticles, getArticle, type ArticleView } from "@/articles/queries";
import { searchArticles } from "@/search/index";
import { isAuthEnabled } from "@/security/auth";
import { ReaderShell } from "@/components/ReaderShell";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const userId = getCurrentUserId();
  const sidebar = getSidebarData(userId);

  const hasAnySubscription = sidebar.folders.length > 0 || sidebar.unfiledFeeds.length > 0;
  if (!hasAnySubscription) {
    redirect("/setup");
  }

  const params = await searchParams;
  const view = (params.view as ArticleView) ?? "unread";
  const feedId = params.feed ? Number(params.feed) : undefined;
  const folderId = params.folder ? Number(params.folder) : undefined;
  const articleId = params.article ? Number(params.article) : undefined;
  const query = params.q ?? "";

  const list = query
    ? searchArticles(userId, query)
    : listArticles({ userId, view, feedId, folderId, limit: 50 });

  const article = articleId ? getArticle(userId, articleId) : null;

  return (
    <ReaderShell
      sidebar={sidebar}
      initialList={list}
      initialArticle={article}
      selection={{ view, feedId, folderId, articleId, query }}
      authEnabled={isAuthEnabled()}
    />
  );
}
