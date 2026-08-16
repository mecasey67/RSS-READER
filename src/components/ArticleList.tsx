"use client";

import { useState, useTransition } from "react";
import type { ArticleListItem, ArticleListPage } from "@/articles/queries";
import type { Selection, ArticleListViewMode } from "./ReaderShell";
import { loadMoreArticlesAction } from "@/app/actions";
import { formatRelativeTime } from "@/lib/format-time";

interface ArticleListProps {
  title: string;
  page: ArticleListPage;
  selectedArticleId?: number;
  onSelect: (id: number) => void;
  selection: Selection;
  viewMode: ArticleListViewMode;
}

export function ArticleList({ title, page, selectedArticleId, onSelect, selection, viewMode }: ArticleListProps) {
  const [items, setItems] = useState<ArticleListItem[]>(page.items);
  const [nextCursor, setNextCursor] = useState(page.nextCursor);
  const [isPending, startTransition] = useTransition();

  // Re-sync when the server gives us a fresh page (e.g. after router.refresh()
  // following a read/star mutation) — without this, "load more" state would
  // otherwise permanently freeze the list at its first-render contents.
  // Adjusting state during render (React's documented pattern for "reset
  // state when a prop changes") rather than in an effect avoids the extra
  // render-then-effect-then-render cascade.
  const [prevPage, setPrevPage] = useState(page);
  if (page !== prevPage) {
    setPrevPage(page);
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }

  function loadMore() {
    if (!nextCursor) return;
    startTransition(async () => {
      const more = await loadMoreArticlesAction({
        view: selection.view,
        feedId: selection.feedId,
        folderId: selection.folderId,
        query: selection.query,
        cursor: nextCursor,
      });
      setItems((prev) => [...prev, ...more.items]);
      setNextCursor(more.nextCursor);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted">{items.length} article{items.length === 1 ? "" : "s"}</p>
      </div>

      {viewMode === "cards" ? (
        <CardsGrid items={items} selectedArticleId={selectedArticleId} onSelect={onSelect} />
      ) : (
        <ListRows items={items} selectedArticleId={selectedArticleId} onSelect={onSelect} />
      )}

      {nextCursor && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={isPending}
            className="w-full rounded border border-border py-1.5 text-xs text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

interface RowsProps {
  items: ArticleListItem[];
  selectedArticleId?: number;
  onSelect: (id: number) => void;
}

function ListRows({ items, selectedArticleId, onSelect }: RowsProps) {
  return (
    <ol className="flex-1 divide-y divide-border" aria-label="Articles">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={item.id === selectedArticleId ? "true" : undefined}
            className={`block w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-hover ${
              item.id === selectedArticleId ? "bg-surface-hover" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-transparent border border-border" : "bg-[var(--unread-dot)]"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${item.isRead ? "font-normal text-muted" : "font-semibold text-foreground"}`}>
                    {item.title || "(untitled)"}
                  </span>
                  {item.isStarred && (
                    <span aria-label="Starred" className="shrink-0 text-star">
                      ★
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {item.feedTitle} · {formatRelativeTime(item.publishedAt ?? item.firstSeenAt)}
                </div>
                {item.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.summary}</p>}
              </div>
            </div>
          </button>
        </li>
      ))}
      {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No articles here.</li>}
    </ol>
  );
}

function CardsGrid({ items, selectedArticleId, onSelect }: RowsProps) {
  if (items.length === 0) {
    return <p className="flex-1 px-3 py-8 text-center text-sm text-muted">No articles here.</p>;
  }

  return (
    <ol
      className="grid flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Articles"
    >
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={item.id === selectedArticleId ? "true" : undefined}
            className={`flex h-full w-full flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-accent ${
              item.id === selectedArticleId ? "border-accent bg-surface-hover" : "border-border"
            }`}
          >
            <div className="aspect-video w-full shrink-0 overflow-hidden bg-surface">
              {item.imageUrl ? (
                // Feed-supplied images: plain <img>, not next/image, to avoid
                // needing to allowlist every possible publisher's domain.
                <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg text-muted" aria-hidden="true">
                  {item.feedTitle?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              <div className="flex items-start justify-between gap-1.5">
                <span className={`line-clamp-2 text-sm ${item.isRead ? "font-normal text-muted" : "font-semibold text-foreground"}`}>
                  {item.title || "(untitled)"}
                </span>
                {item.isStarred && (
                  <span aria-label="Starred" className="shrink-0 text-star">
                    ★
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center gap-1.5 text-xs text-muted">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.isRead ? "bg-transparent border border-border" : "bg-[var(--unread-dot)]"}`}
                />
                <span className="truncate">
                  {item.feedTitle} · {formatRelativeTime(item.publishedAt ?? item.firstSeenAt)}
                </span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}
