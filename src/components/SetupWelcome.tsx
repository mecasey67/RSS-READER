"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImportOpmlFlow } from "./ImportOpmlFlow";
import { AddFeedForm } from "./AddFeedForm";

type Mode = "choose" | "import" | "add";

export function SetupWelcome() {
  const [mode, setMode] = useState<Mode>("choose");
  const router = useRouter();

  if (mode === "import") {
    return <ImportOpmlFlow onDone={() => router.push("/")} />;
  }
  if (mode === "add") {
    return <AddFeedForm onSubscribed={() => router.push("/")} />;
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <button
        type="button"
        onClick={() => setMode("import")}
        className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-foreground"
      >
        Import OPML
      </button>
      <button
        type="button"
        onClick={() => setMode("add")}
        className="rounded-lg border border-border px-4 py-3 text-sm font-medium hover:bg-surface-hover"
      >
        Add Feed
      </button>
    </div>
  );
}
