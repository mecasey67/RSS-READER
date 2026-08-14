"use client";

import { useState } from "react";
import { previewOpml, confirmOpmlImport } from "@/app/actions";
import type { OpmlPreviewEntry, OpmlPreviewResult, OpmlImportSummary } from "@/opml/types";

const MAX_OPML_BYTES = 10 * 1024 * 1024;

type Step = "pick" | "preview" | "summary";

export function ImportOpmlFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpmlPreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<OpmlImportSummary | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_OPML_BYTES) {
      setError(`File is too large (max ${Math.round(MAX_OPML_BYTES / 1024 / 1024)} MB).`);
      return;
    }
    if (!/\.(opml|xml)$/i.test(file.name)) {
      setError("Please choose a .opml or .xml file.");
      return;
    }
    setIsBusy(true);
    try {
      const text = await file.text();
      const result = await previewOpml(text);
      setPreview(result);
      setSelected(new Set(result.entries.filter((e) => e.status !== "invalid").map((e) => e.key)));
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse that file.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setIsBusy(true);
    const entries = preview.entries.filter((e) => selected.has(e.key));
    try {
      const result = await confirmOpmlImport(entries);
      setSummary(result);
      setStep("summary");
    } finally {
      setIsBusy(false);
    }
  }

  if (step === "pick") {
    return (
      <div className="w-full max-w-md">
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-border p-8 text-center hover:border-accent">
          <input
            type="file"
            accept=".opml,.xml"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <span className="text-sm text-muted">{isBusy ? "Reading file…" : "Click to choose an .opml or .xml file"}</span>
        </label>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (step === "preview" && preview) {
    return (
      <div className="w-full max-w-lg text-left">
        <div className="mb-3 flex gap-4 text-sm">
          <span>{preview.newCount} new</span>
          <span className="text-muted">{preview.duplicateCount} already subscribed</span>
          <span className="text-danger">{preview.invalidCount} invalid</span>
          {preview.folderNames.length > 0 && <span className="text-muted">{preview.folderNames.length} folders</span>}
        </div>
        <div className="max-h-72 overflow-y-auto rounded border border-border">
          <table className="w-full text-sm">
            <tbody>
              {preview.entries.map((entry) => (
                <PreviewRow
                  key={entry.key}
                  entry={entry}
                  checked={selected.has(entry.key)}
                  onToggle={(checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(entry.key);
                      else next.delete(entry.key);
                      return next;
                    });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => setStep("pick")} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isBusy || selected.size === 0}
            className="rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
          >
            {isBusy ? "Importing…" : `Import ${selected.size} feed${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    );
  }

  if (step === "summary" && summary) {
    return (
      <div className="w-full max-w-md text-left">
        <h3 className="mb-2 text-sm font-semibold">OPML Import Complete</h3>
        <ul className="space-y-1 text-sm text-muted">
          <li>{summary.found} subscriptions found</li>
          <li>{summary.imported} imported</li>
          <li>{summary.alreadySubscribed} already subscribed</li>
          <li>{summary.invalid} invalid</li>
          <li>Folders created: {summary.foldersCreated}</li>
        </ul>
        <button type="button" onClick={onDone} className="mt-4 w-full rounded bg-accent py-2 text-sm text-accent-foreground">
          Continue to Reader
        </button>
      </div>
    );
  }

  return null;
}

function PreviewRow({
  entry,
  checked,
  onToggle,
}: {
  entry: OpmlPreviewEntry;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="w-8 px-2 py-1.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={entry.status === "invalid"}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Import ${entry.title ?? entry.feedUrl}`}
        />
      </td>
      <td className="px-2 py-1.5">
        <div className="truncate font-medium text-foreground">{entry.title ?? entry.feedUrl}</div>
        <div className="truncate text-xs text-muted">
          {entry.folderPath.join(" / ")}
          {entry.folderPath.length > 0 && " · "}
          {entry.feedUrl}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right text-xs">
        {entry.status === "new" && <span className="text-accent">new</span>}
        {entry.status === "duplicate" && <span className="text-muted">duplicate</span>}
        {entry.status === "invalid" && <span className="text-danger" title={entry.reason}>invalid</span>}
      </td>
    </tr>
  );
}
