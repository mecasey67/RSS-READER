"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FeedManagementRow } from "@/feeds/manage";
import {
  refreshFeedAction,
  refreshAllAction,
  unsubscribeAction,
  deleteFeedAction,
  moveToFolderAction,
  renameSubscriptionAction,
  createFolderAction,
  exportOpmlAction,
} from "@/app/actions";
import { formatFullDate } from "@/lib/format-time";
import { AddFeedForm } from "./AddFeedForm";
import { ImportOpmlFlow } from "./ImportOpmlFlow";

interface ManageFeedsTableProps {
  initialFeeds: FeedManagementRow[];
  folders: { id: number; name: string }[];
}

function statusLabel(row: FeedManagementRow): { text: string; tone: "ok" | "warn" | "error" } {
  if (row.status === "active" && row.consecutiveFailureCount === 0) return { text: "OK", tone: "ok" };
  if (row.status === "permanently_failed") {
    return { text: `Failed permanently${row.httpStatus ? ` (HTTP ${row.httpStatus})` : ""}`, tone: "error" };
  }
  if (row.status === "temporarily_failed" || row.consecutiveFailureCount > 0) {
    return { text: `Failed ${row.consecutiveFailureCount} time${row.consecutiveFailureCount === 1 ? "" : "s"}`, tone: "warn" };
  }
  return { text: "OK", tone: "ok" };
}

export function ManageFeedsTable({ initialFeeds, folders }: ManageFeedsTableProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [, startTransition] = useTransition();
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function handleRefreshOne(feedId: number) {
    if (refreshingId) return; // prevent refresh-storm from repeated clicks
    setRefreshingId(feedId);
    try {
      await refreshFeedAction(feedId);
      refresh();
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleRefreshAll() {
    if (refreshingId === -1) return;
    setRefreshingId(-1);
    try {
      await refreshAllAction();
      refresh();
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleExport() {
    const xml = await exportOpmlAction();
    const blob = new Blob([xml], { type: "text/x-opml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subscriptions.opml";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setShowAdd((s) => !s)} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
          Add Feed
        </button>
        <button onClick={() => setShowImport((s) => !s)} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
          Import OPML
        </button>
        <button onClick={handleExport} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
          Export OPML
        </button>
        <button
          onClick={async () => {
            const name = prompt("New folder name:");
            if (name?.trim()) {
              await createFolderAction(name.trim());
              refresh();
            }
          }}
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
        >
          New Folder
        </button>
        <button
          onClick={handleRefreshAll}
          disabled={refreshingId !== null}
          className="ml-auto rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
        >
          {refreshingId === -1 ? "Refreshing…" : "Refresh all"}
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded border border-border p-3">
          <AddFeedForm
            onSubscribed={() => {
              setShowAdd(false);
              refresh();
            }}
          />
        </div>
      )}
      {showImport && (
        <div className="mb-4 rounded border border-border p-3">
          <ImportOpmlFlow
            onDone={() => {
              setShowImport(false);
              refresh();
            }}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Feed</th>
              <th className="px-3 py-2 font-medium">Folder</th>
              <th className="px-3 py-2 font-medium">Last update</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialFeeds.map((row) => (
              <FeedRow
                key={row.subscriptionId}
                row={row}
                folders={folders}
                isRefreshing={refreshingId === row.feedId}
                onRefresh={() => handleRefreshOne(row.feedId)}
                onChanged={refresh}
              />
            ))}
            {initialFeeds.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  No subscriptions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeedRow({
  row,
  folders,
  isRefreshing,
  onRefresh,
  onChanged,
}: {
  row: FeedManagementRow;
  folders: { id: number; name: string }[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(row.title);
  const status = statusLabel(row);

  return (
    <tr className="border-t border-border align-top">
      <td className="max-w-xs px-3 py-2">
        {renaming ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await renameSubscriptionAction(row.subscriptionId, title || null);
              setRenaming(false);
              onChanged();
            }}
            className="flex gap-1"
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-border px-1.5 py-0.5 text-sm"
              autoFocus
            />
            <button type="submit" className="text-xs text-accent">
              Save
            </button>
          </form>
        ) : (
          <>
            <div className="truncate font-medium">{row.title}</div>
            <div className="truncate text-xs text-muted">{row.feedUrl}</div>
          </>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          defaultValue={row.folderId ?? ""}
          onChange={async (e) => {
            await moveToFolderAction(row.subscriptionId, e.target.value ? Number(e.target.value) : null);
            onChanged();
          }}
          className="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
        >
          <option value="">(none)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-xs text-muted">
        {row.lastSuccessfulFetchAt ? formatFullDate(row.lastSuccessfulFetchAt) : "Never"}
      </td>
      <td className="px-3 py-2">
        <span
          className={`text-xs ${status.tone === "ok" ? "text-muted" : status.tone === "warn" ? "text-star" : "text-danger"}`}
          title={row.lastError ?? undefined}
        >
          {status.text}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={onRefresh} disabled={isRefreshing} className="text-accent hover:underline disabled:opacity-50">
            {isRefreshing ? "Refreshing…" : "Refresh now"}
          </button>
          <button onClick={() => setRenaming(true)} className="text-muted hover:underline">
            Rename
          </button>
          {row.siteUrl && (
            <a href={row.siteUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:underline">
              Open site
            </a>
          )}
          <button onClick={() => navigator.clipboard.writeText(row.feedUrl)} className="text-muted hover:underline">
            Copy URL
          </button>
          <button
            onClick={async () => {
              await unsubscribeAction(row.subscriptionId);
              onChanged();
            }}
            className="text-muted hover:underline"
          >
            Unsubscribe
          </button>
          <button
            onClick={async () => {
              if (confirm(`Permanently delete "${row.title}" and all its stored articles? This cannot be undone.`)) {
                await deleteFeedAction(row.feedId);
                onChanged();
              }
            }}
            className="text-danger hover:underline"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
