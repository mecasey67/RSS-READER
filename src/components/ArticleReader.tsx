"use client";

import { useEffect, useRef } from "react";
import type { ArticleDetail } from "@/articles/queries";
import { markArticleRead, markArticleUnread, toggleStar } from "@/app/actions";
import { formatFullDate } from "@/lib/format-time";

interface ArticleReaderProps {
  article: ArticleDetail | null;
  onBack: () => void;
  onChanged: () => void;
}

export function ArticleReader({ article, onBack, onChanged }: ArticleReaderProps) {
  const markedRef = useRef<number | null>(null);

  // Opening an article marks it read — this only fires when the reader pane
  // actually mounts this article (an explicit selection), never from a list
  // item merely scrolling into view.
  useEffect(() => {
    if (!article || article.isRead || markedRef.current === article.id) return;
    markedRef.current = article.id;
    markArticleRead(article.id).then(onChanged);
  }, [article, onChanged]);

  if (!article) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Select an article to read.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" onClick={onBack} className="rounded px-2 py-1 text-sm text-muted hover:bg-surface-hover md:hidden">
          ← Back
        </button>
        <div className="flex flex-1 items-center justify-end gap-1">
          <IconButton
            label={article.isRead ? "Mark unread" : "Mark read"}
            onClick={async () => {
              if (article.isRead) await markArticleUnread(article.id);
              else await markArticleRead(article.id);
              onChanged();
            }}
          >
            {article.isRead ? "○" : "●"}
          </IconButton>
          <IconButton
            label={article.isStarred ? "Unstar" : "Star"}
            active={article.isStarred}
            onClick={async () => {
              await toggleStar(article.id, !article.isStarred);
              onChanged();
            }}
          >
            {article.isStarred ? "★" : "☆"}
          </IconButton>
          {article.originalUrl && (
            <a
              href={article.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
            >
              View Original ↗
            </a>
          )}
        </div>
      </div>

      <article className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
        <h1 className="text-2xl font-bold leading-tight text-foreground">{article.title || "(untitled)"}</h1>
        <div className="mt-2 text-sm text-muted">
          <span>{article.feedTitle}</span>
          {article.author && <span> · {article.author}</span>}
          <span> · {formatFullDate(article.publishedAt ?? article.firstSeenAt)}</span>
        </div>
        {/* contentHtml is sanitized once, at ingestion time (src/security/sanitize.ts),
            before it's ever written to the database — this is the single sanitization point. */}
        <div className="article-content mt-6" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
      </article>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded px-2 py-1 text-sm hover:bg-surface-hover ${active ? "text-star" : "text-foreground"}`}
    >
      {children}
    </button>
  );
}
