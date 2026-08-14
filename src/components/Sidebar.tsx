"use client";

import Link from "next/link";
import type { SidebarData } from "@/articles/queries";
import type { Selection } from "./ReaderShell";

interface SidebarProps {
  data: SidebarData;
  selection: Selection;
  onSelect: (next: Partial<Selection>) => void;
}

export function Sidebar({ data, selection, onSelect }: SidebarProps) {
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

      {data.folders.map((folder) => (
        <div key={folder.id} className="mb-2">
          <SidebarRow
            label={folder.name}
            count={folder.unreadCount}
            active={isActive({ folderId: folder.id })}
            bold
            onClick={() => onSelect({ view: "unread", folderId: folder.id, feedId: undefined })}
          />
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
        </div>
      ))}

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
