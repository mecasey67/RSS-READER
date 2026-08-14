"use client";

import { useEffect, useRef } from "react";

const SHORTCUTS: Array<[string, string]> = [
  ["j", "Next article"],
  ["k", "Previous article"],
  ["o / Enter", "Open selected article"],
  ["m", "Toggle read / unread"],
  ["s", "Toggle star"],
  ["v", "View original"],
  ["r", "Refresh"],
  ["/", "Focus search"],
  ["?", "Toggle this help"],
  ["Esc", "Close dialog"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        <h2 id="shortcut-help-title" className="mb-3 text-sm font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="space-y-1.5 text-sm">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <dt className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">{key}</dt>
              <dd className="text-muted">{desc}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded border border-border py-1.5 text-sm hover:bg-surface-hover"
        >
          Close
        </button>
      </div>
    </div>
  );
}
