import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { feeds, folders, subscriptions } from "@/db/schema";

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  children: FolderNode[];
  feedOutlines: string[];
}

function feedOutlineXml(title: string, feedUrl: string, htmlUrl: string | null): string {
  const attrs = [
    `text="${escapeXmlAttr(title)}"`,
    `title="${escapeXmlAttr(title)}"`,
    `type="rss"`,
    `xmlUrl="${escapeXmlAttr(feedUrl)}"`,
  ];
  if (htmlUrl) attrs.push(`htmlUrl="${escapeXmlAttr(htmlUrl)}"`);
  return `<outline ${attrs.join(" ")} />`;
}

function renderFolder(node: FolderNode, indent: string): string {
  const childXml = node.children.map((c) => renderFolder(c, indent + "  ")).filter(Boolean);
  const parts = [...node.feedOutlines.map((f) => indent + "  " + f), ...childXml];
  if (parts.length === 0) return ""; // don't export empty folders
  return `${indent}<outline text="${escapeXmlAttr(node.name)}" title="${escapeXmlAttr(node.name)}">\n${parts.join("\n")}\n${indent}</outline>`;
}

export function exportOpml(userId: number): string {
  const folderRows = db.select().from(folders).where(eq(folders.userId, userId)).all();
  const subRows = db
    .select({
      folderId: subscriptions.folderId,
      customTitle: subscriptions.customTitle,
      feedTitle: feeds.title,
      feedUrl: feeds.feedUrl,
      siteUrl: feeds.siteUrl,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(eq(subscriptions.userId, userId))
    .all();

  const nodeById = new Map<number, FolderNode>();
  for (const f of folderRows) {
    nodeById.set(f.id, { id: f.id, name: f.name, parentId: f.parentId, children: [], feedOutlines: [] });
  }
  for (const node of nodeById.values()) {
    if (node.parentId !== null && nodeById.has(node.parentId)) {
      nodeById.get(node.parentId)!.children.push(node);
    }
  }

  const rootOutlines: string[] = [];
  for (const sub of subRows) {
    const title = sub.customTitle ?? sub.feedTitle ?? sub.feedUrl;
    const xml = feedOutlineXml(title, sub.feedUrl, sub.siteUrl);
    if (sub.folderId !== null && nodeById.has(sub.folderId)) {
      nodeById.get(sub.folderId)!.feedOutlines.push(xml);
    } else {
      rootOutlines.push("  " + xml);
    }
  }

  const topLevelFolders = Array.from(nodeById.values()).filter((n) => n.parentId === null || !nodeById.has(n.parentId));
  const folderXml = topLevelFolders.map((n) => renderFolder(n, "  ")).filter(Boolean);

  const now = new Date().toUTCString();
  const body = [...rootOutlines, ...folderXml].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Subscriptions</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>
`;
}
