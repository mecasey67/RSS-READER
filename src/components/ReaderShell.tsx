"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SidebarData, ArticleListPage, ArticleDetail, ArticleView } from "@/articles/queries";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleReader } from "./ArticleReader";
import { SearchBar } from "./SearchBar";
import { ShortcutHelp } from "./ShortcutHelp";
import { ThemeToggle } from "./ThemeToggle";
import { markArticleRead, markArticleUnread, toggleStar } from "@/app/actions";
import { logoutAction } from "@/app/login/actions";

export interface Selection {
  view: ArticleView;
  feedId?: number;
  folderId?: number;
  articleId?: number;
  query: string;
}

interface ReaderShellProps {
  sidebar: SidebarData;
  initialList: ArticleListPage;
  initialArticle: ArticleDetail | null;
  selection: Selection;
  authEnabled: boolean;
}

type MobilePane = "feeds" | "list" | "article";
export type ArticleListViewMode = "list" | "cards";

export function ReaderShell({ sidebar, initialList, initialArticle, selection, authEnabled }: ReaderShellProps) {
  const router = useRouter();
  const [mobilePane, setMobilePane] = useState<MobilePane>(selection.articleId ? "article" : "list");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [viewMode, setViewMode] = useState<ArticleListViewMode>("list");

  useEffect(() => {
    // Reading a browser-only preference on mount (same pattern as
    // ThemeToggle) — genuinely synchronizing with external storage, not
    // deriving state from props.
    const stored = localStorage.getItem("articleListViewMode");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "cards" || stored === "list") setViewMode(stored);
  }, []);

  function toggleViewMode() {
    const next: ArticleListViewMode = viewMode === "list" ? "cards" : "list";
    setViewMode(next);
    localStorage.setItem("articleListViewMode", next);
  }

  // Cards is a full-width browsing layout — once an article is open, the
  // reader pane needs the space back, so reading always happens in the
  // normal list+reader layout regardless of which mode you browsed in.
  const showCardsGrid = viewMode === "cards" && !selection.articleId;
  const effectiveListMode: ArticleListViewMode = selection.articleId ? "list" : viewMode;

  const navigate = useCallback(
    (next: Partial<Selection>, opts: { keepQuery?: boolean } = {}) => {
      const merged: Selection = { ...selection, articleId: undefined, ...next };
      if (!opts.keepQuery && next.query === undefined) merged.query = "";
      const params = new URLSearchParams();
      if (merged.query) {
        params.set("q", merged.query);
      } else {
        params.set("view", merged.view);
        if (merged.feedId) params.set("feed", String(merged.feedId));
        if (merged.folderId) params.set("folder", String(merged.folderId));
      }
      if (merged.articleId) params.set("article", String(merged.articleId));
      router.push(`/?${params.toString()}`);
    },
    [router, selection],
  );

  const selectArticle = useCallback(
    (articleId: number) => {
      navigate({ ...selection, articleId });
      setMobilePane("article");
    },
    [navigate, selection],
  );

  // j/k/o/m/s/v navigation — see ShortcutHelp for the full list. Ignored
  // while the user is typing in a text input/textarea/contenteditable.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }

    function handleKeydown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const ids = initialList.items.map((i) => i.id);
      const currentIndex = selection.articleId ? ids.indexOf(selection.articleId) : -1;

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const next = ids[Math.min(currentIndex + 1, ids.length - 1)] ?? ids[0];
          if (next !== undefined) selectArticle(next);
          break;
        }
        case "k": {
          e.preventDefault();
          const prev = ids[Math.max(currentIndex - 1, 0)];
          if (prev !== undefined) selectArticle(prev);
          break;
        }
        case "o":
        case "Enter": {
          if (selection.articleId) break; // already open
          const current = ids[Math.max(currentIndex, 0)];
          if (current !== undefined) selectArticle(current);
          break;
        }
        case "m": {
          if (!initialArticle) break;
          e.preventDefault();
          (initialArticle.isRead ? markArticleUnread(initialArticle.id) : markArticleRead(initialArticle.id)).then(() =>
            router.refresh(),
          );
          break;
        }
        case "s": {
          if (!initialArticle) break;
          e.preventDefault();
          toggleStar(initialArticle.id, !initialArticle.isStarred).then(() => router.refresh());
          break;
        }
        case "v": {
          if (!initialArticle?.originalUrl) break;
          e.preventDefault();
          window.open(initialArticle.originalUrl, "_blank", "noopener,noreferrer");
          break;
        }
        case "/": {
          e.preventDefault();
          document.getElementById("search-input")?.focus();
          break;
        }
        case "r": {
          e.preventDefault();
          router.refresh();
          break;
        }
        case "?": {
          e.preventDefault();
          setShowShortcuts((s) => !s);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [initialList.items, selectArticle, selection.articleId, router, initialArticle]);

  const title = useMemo(() => {
    if (selection.query) return `Search: "${selection.query}"`;
    if (selection.feedId) {
      const feed = [...sidebar.folders.flatMap((f) => f.feeds), ...sidebar.unfiledFeeds].find((f) => f.id === selection.feedId);
      return feed?.title ?? "Feed";
    }
    if (selection.folderId) {
      const folder = sidebar.folders.find((f) => f.id === selection.folderId);
      return folder?.name ?? "Folder";
    }
    return selection.view === "starred" ? "Starred" : selection.view === "unread" ? "Unread" : "All Articles";
  }, [selection, sidebar]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <button
          className="rounded px-2 py-1 text-sm text-muted hover:bg-surface-hover md:hidden"
          onClick={() => setMobilePane("feeds")}
          aria-label="Show feeds"
        >
          ☰
        </button>
        <span className="font-semibold tracking-tight">Reader</span>
        <div className="ml-4 flex-1">
          <SearchBar initialQuery={selection.query} onSearch={(q) => navigate({ query: q })} />
        </div>
        <button
          className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover"
          onClick={toggleViewMode}
          aria-label={viewMode === "list" ? "Switch to Cards view" : "Switch to List view"}
          title={viewMode === "list" ? "Switch to Cards view" : "Switch to List view"}
        >
          {viewMode === "list" ? "⊞" : "☰"}
        </button>
        <button
          className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover"
          onClick={() => setShowShortcuts(true)}
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
        <ThemeToggle />
        {authEnabled && (
          <form action={logoutAction}>
            <button type="submit" className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover">
              Log out
            </button>
          </form>
        )}
      </header>

      <div className={`grid flex-1 min-h-0 grid-cols-1 ${showCardsGrid ? "md:grid-cols-[240px_1fr]" : "md:grid-cols-[240px_360px_1fr]"}`}>
        <div className={`${mobilePane === "feeds" ? "block" : "hidden"} min-h-0 overflow-y-auto border-r border-border md:block`}>
          <Sidebar
            data={sidebar}
            selection={selection}
            onSelect={(next) => {
              navigate(next);
              setMobilePane("list");
            }}
          />
        </div>

        <div className={`${mobilePane === "list" ? "block" : "hidden"} min-h-0 overflow-y-auto ${showCardsGrid ? "" : "border-r border-border"} md:block`}>
          <ArticleList
            key={`${selection.view}-${selection.feedId}-${selection.folderId}-${selection.query}`}
            title={title}
            page={initialList}
            selectedArticleId={selection.articleId}
            onSelect={selectArticle}
            selection={selection}
            viewMode={effectiveListMode}
          />
        </div>

        {!showCardsGrid && (
          <div className={`${mobilePane === "article" ? "block" : "hidden"} min-h-0 overflow-y-auto md:block`}>
            <ArticleReader
              article={initialArticle}
              onBack={() => setMobilePane("list")}
              onChanged={() => router.refresh()}
            />
          </div>
        )}
      </div>

      {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
