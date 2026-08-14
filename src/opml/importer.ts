import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { feeds, folders, subscriptions } from "@/db/schema";
import { normalizeFeedUrl } from "@/lib/urls";
import { parseOpml, type OpmlOutline, OpmlParseError } from "./parser";
import type { OpmlPreviewEntry, OpmlPreviewResult, OpmlImportSummary } from "./types";

export { OpmlParseError };

function collectFolderNames(outlines: OpmlOutline[], acc = new Set<string>()): Set<string> {
  for (const o of outlines) {
    if (o.isFolder) {
      acc.add(o.title ?? o.text ?? "Untitled");
      collectFolderNames(o.children, acc);
    }
  }
  return acc;
}

function existingSubscribedFeedUrls(userId: number): Set<string> {
  const rows = db
    .select({ feedUrl: feeds.feedUrl })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(eq(subscriptions.userId, userId))
    .all();
  return new Set(rows.map((r) => r.feedUrl));
}

/**
 * Read-only: parses the OPML file and classifies every discovered feed as
 * new / duplicate / invalid without writing anything to the database, so the
 * UI can show a preview before the user confirms the import.
 */
export function previewOpmlImport(xml: string, userId: number): OpmlPreviewResult {
  const parsed = parseOpml(xml);
  const alreadySubscribed = existingSubscribedFeedUrls(userId);
  const seenInFile = new Set<string>();
  const entries: OpmlPreviewEntry[] = [];
  let keyCounter = 0;

  function walk(outlines: OpmlOutline[], folderPath: string[]) {
    for (const outline of outlines) {
      if (outline.isFolder) {
        walk(outline.children, [...folderPath, outline.title ?? outline.text ?? "Untitled"]);
        continue;
      }

      keyCounter++;
      const key = String(keyCounter);
      const rawXmlUrl = outline.xmlUrl ?? "";
      const normalized = rawXmlUrl ? normalizeFeedUrl(rawXmlUrl) : null;

      if (!normalized) {
        entries.push({
          key,
          feedUrl: rawXmlUrl,
          rawXmlUrl,
          title: outline.title ?? outline.text,
          htmlUrl: outline.htmlUrl,
          folderPath,
          status: "invalid",
          reason: rawXmlUrl ? "Not a valid feed URL" : "Missing xmlUrl",
        });
        continue;
      }

      const status = seenInFile.has(normalized) || alreadySubscribed.has(normalized) ? "duplicate" : "new";
      seenInFile.add(normalized);

      entries.push({
        key,
        feedUrl: normalized,
        rawXmlUrl,
        title: outline.title ?? outline.text,
        htmlUrl: outline.htmlUrl,
        folderPath,
        status,
      });
    }
  }

  walk(parsed.outlines, []);

  return {
    documentTitle: parsed.title,
    entries,
    totalFound: entries.length,
    newCount: entries.filter((e) => e.status === "new").length,
    duplicateCount: entries.filter((e) => e.status === "duplicate").length,
    invalidCount: entries.filter((e) => e.status === "invalid").length,
    folderNames: Array.from(collectFolderNames(parsed.outlines)),
  };
}

/**
 * Writes the selected entries to the database. Idempotent: re-importing the
 * same entries (e.g. re-running the same OPML file) never creates duplicate
 * folders, feeds, or subscriptions — everything is find-or-create.
 */
export function importOpmlEntries(userId: number, entries: OpmlPreviewEntry[]): OpmlImportSummary {
  const summary: OpmlImportSummary = { found: entries.length, imported: 0, alreadySubscribed: 0, invalid: 0, foldersCreated: 0 };
  const folderCache = new Map<string, number>(); // "parentId|name" -> folder id

  db.transaction((tx) => {
    const findOrCreateFolder = (path: string[]): number | null => {
      let parentId: number | null = null;
      for (const name of path) {
        const cacheKey: string = `${parentId}|${name}`;
        if (folderCache.has(cacheKey)) {
          parentId = folderCache.get(cacheKey)!;
          continue;
        }
        let existing: typeof folders.$inferSelect | undefined;
        if (parentId === null) {
          existing = tx.select().from(folders).where(and(eq(folders.userId, userId), eq(folders.name, name), isNull(folders.parentId))).get();
        } else {
          existing = tx.select().from(folders).where(and(eq(folders.userId, userId), eq(folders.name, name), eq(folders.parentId, parentId))).get();
        }

        if (existing) {
          folderCache.set(cacheKey, existing.id);
          parentId = existing.id;
        } else {
          const now = new Date().toISOString();
          const [created] = tx
            .insert(folders)
            .values({ userId, name, parentId, createdAt: now, updatedAt: now })
            .returning()
            .all();
          folderCache.set(cacheKey, created.id);
          parentId = created.id;
          summary.foldersCreated++;
        }
      }
      return parentId;
    };

    for (const entry of entries) {
      if (entry.status === "invalid") {
        summary.invalid++;
        continue;
      }

      const folderId = entry.folderPath.length ? findOrCreateFolder(entry.folderPath) : null;

      let feed = tx.select().from(feeds).where(eq(feeds.feedUrl, entry.feedUrl)).get();
      if (!feed) {
        const now = new Date().toISOString();
        const [created] = tx
          .insert(feeds)
          .values({
            feedUrl: entry.feedUrl,
            siteUrl: entry.htmlUrl,
            title: entry.title,
            status: "active",
            createdAt: now,
            updatedAt: now,
            // Due immediately so a fresh import gets its first refresh promptly.
            nextCheckAt: now,
          })
          .returning()
          .all();
        feed = created;
      }

      const existingSub = tx
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feed.id)))
        .get();

      if (existingSub) {
        summary.alreadySubscribed++;
        continue;
      }

      tx.insert(subscriptions)
        .values({ userId, feedId: feed.id, folderId, createdAt: new Date().toISOString() })
        .run();
      summary.imported++;
    }
  });

  return summary;
}
