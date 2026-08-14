import Link from "next/link";
import { getCurrentUserId } from "@/lib/current-user";
import { listFeedsForManagement } from "@/feeds/manage";
import { db } from "@/db/client";
import { folders as foldersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ManageFeedsTable } from "@/components/ManageFeedsTable";

export const dynamic = "force-dynamic";

export default function ManagePage() {
  const userId = getCurrentUserId();
  const feedRows = listFeedsForManagement(userId);
  const folders = db.select().from(foldersTable).where(eq(foldersTable.userId, userId)).all();

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-muted hover:underline">
            ← Back to reader
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Manage feeds</h1>
        </div>
      </div>
      <ManageFeedsTable initialFeeds={feedRows} folders={folders.map((f) => ({ id: f.id, name: f.name }))} />
    </main>
  );
}
