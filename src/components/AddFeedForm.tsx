"use client";

import { useState } from "react";
import { addFeedAction } from "@/app/actions";
import type { AddFeedResult } from "@/feeds/manage";

export function AddFeedForm({ onSubscribed, folderId = null }: { onSubscribed: () => void; folderId?: number | null }) {
  const [url, setUrl] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<AddFeedResult | null>(null);

  async function submit(chosenUrl?: string) {
    setIsBusy(true);
    setResult(null);
    try {
      const outcome = await addFeedAction(chosenUrl ?? url, folderId);
      if (outcome.kind === "subscribed" || outcome.kind === "already_subscribed") {
        onSubscribed();
      } else {
        setResult(outcome);
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md text-left">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <label htmlFor="add-feed-url" className="sr-only">
          Feed or website URL
        </label>
        <input
          id="add-feed-url"
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com or https://example.com/feed.xml"
          className="flex-1 rounded border border-border bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted"
        />
        <button type="submit" disabled={isBusy || !url} className="rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50">
          {isBusy ? "Checking…" : "Add"}
        </button>
      </form>

      {result?.kind === "not_found" && (
        <p className="mt-2 text-sm text-danger">
          No feed found at that address. We only subscribe to feeds explicitly advertised by the page — try pasting the feed URL directly.
        </p>
      )}
      {result?.kind === "error" && <p className="mt-2 text-sm text-danger">{result.message}</p>}
      {result?.kind === "needs_selection" && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-muted">Multiple feeds were found on that page — choose one:</p>
          <ul className="space-y-1">
            {result.candidates.map((c) => (
              <li key={c.url}>
                <button
                  type="button"
                  onClick={() => submit(c.url)}
                  className="w-full rounded border border-border px-2.5 py-1.5 text-left text-sm hover:bg-surface-hover"
                >
                  {c.title ?? c.url}
                  <span className="block truncate text-xs text-muted">{c.url}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
