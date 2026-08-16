"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SidebarData } from "@/articles/queries";
import type { Selection } from "./ReaderShell";

interface SidebarProps {
  data: SidebarData;
  selection: Selection;
  onSelect: (next: Partial<Selection>) => void;
}

const COLLAPSED_STORAGE_KEY = "sidebarCollapsedFolderIds";

export function Sidebar({ data, selection, onSelect }: SidebarProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Reading a browser-only preference on mount — genuinely synchronizing
    // with external storage, not deriving state from props.
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsedIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  function toggleFolder(folderId: number) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  const isActive = (test: Partial<Selection>) =>
    !selection.query &&
    (test.view ? selection.view === test.view && !selection.feedId && !selection.folderId : true) &&
    (test.feedId !== undefined ? selection.feedId === test.feedId : true) &&
    (test.folderId !== undefined ? selection.folderId === test.folderId : true);

  return (
    <nav aria-label="Feeds and folders" className="p-2 text-sm">
      <ul className="mb-3 space-y-0.5">
        <SidebarRow
          label="Unread"
          count={data.totalUnread}
          active={isActive({ view: "unread" })}
          onClick={() => onSelect({ view: "unread", feedId: undefined, folderId: undefined })}
        />
        <SidebarRow
          label="All Articles"
          active={isActive({ view: "all" })}
          onClick={() => onSelect({ view: "all", feedId: undefined, folderId: undefined })}
        />
        <SidebarRow
          label="Starred"
          count={data.starredCount}
          active={isActive({ view: "starred" })}
          onClick={() => onSelect({ view: "starred", feedId: undefined, folderId: undefined })}
        />
      </ul>

      <div className="mb-2 flex items-center justify-between px-2">
        <Link href="/manage" className="text-xs text-muted hover:text-foreground hover:underline">
          Manage feeds
        </Link>
      </div>

      {data.folders.map((folder) => {
        // Keep a folder expanded if it currently contains the active
        // selection, even if the user had collapsed it — otherwise the
        // highlighted feed/folder would silently disappear from view.
        const containsActive = folder.id === selection.folderId || folder.feeds.some((f) => f.id === selection.feedId);
        const collapsed = collapsedIds.has(folder.id) && !containsActive;

        return (
          <div key={folder.id} className="mb-2">
            <div
              className={`flex items-center rounded ${isActive({ folderId: folder.id }) ? "bg-surface-hover" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleFolder(folder.id)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
                className="px-1.5 py-1 text-muted hover:text-foreground"
              >
                <span aria-hidden="true" className="inline-block w-3 text-center">
                  {collapsed ? "▸" : "▾"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSelect({ view: "unread", folderId: folder.id, feedId: undefined })}
                aria-current={isActive({ folderId: folder.id }) ? "true" : undefined}
                className={`flex min-w-0 flex-1 items-center justify-between py-1 pr-2 text-left font-semibold hover:text-accent ${
                  isActive({ folderId: folder.id }) ? "text-accent" : "text-foreground"
                }`}
              >
                <span className="truncate">{folder.name}</span>
                {!!folder.unreadCount && <span className="ml-2 shrink-0 text-xs tabular-nums text-muted">{folder.unreadCount}</span>}
              </button>
            </div>
            {!collapsed && (
              <ul className="ml-3 space-y-0.5 border-l border-border pl-2">
                {folder.feeds.map((feed) => (
                  <SidebarRow
                    key={feed.id}
                    label={feed.title}
                    count={feed.unreadCount}
                    active={isActive({ feedId: feed.id })}
                    warn={feed.status !== "active"}
                    onClick={() => onSelect({ view: "unread", feedId: feed.id, folderId: undefined })}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {data.unfiledFeeds.length > 0 && (
        <ul className="space-y-0.5">
          {data.unfiledFeeds.map((feed) => (
            <SidebarRow
              key={feed.id}
              label={feed.title}
              count={feed.unreadCount}
              active={isActive({ feedId: feed.id })}
              warn={feed.status !== "active"}
              onClick={() => onSelect({ view: "unread", feedId: feed.id, folderId: undefined })}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

function SidebarRow({
  label,
  count,
  active,
  bold,
  warn,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  bold?: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-surface-hover ${
          active ? "bg-surface-hover text-accent" : "text-foreground"
        } ${bold ? "font-semibold" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {warn && (
            <span aria-label="Feed has a problem" title="This feed has a problem — see Manage feeds" className="text-danger">
              ⚠
            </span>
          )}
          <span className="truncate">{label}</span>
        </span>
        {!!count && <span className="ml-2 shrink-0 text-xs tabular-nums text-muted">{count}</span>}
      </button>
    </li>
  );
}
