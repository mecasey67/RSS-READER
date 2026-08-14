import type Parser from "rss-parser";
import { parseFeedDate, toIso } from "@/lib/dates";
import { normalizeUrl } from "@/lib/urls";
import { sanitizeArticleHtml, sanitizePlainSummary } from "@/security/sanitize";
import { computeContentHash, computeFallbackId } from "@/articles/dedupe";
import type { NormalizedArticle, NormalizedFeed, NormalizedFeedMeta } from "./types";

type RawItem = Parser.Item & {
  contentSnippet?: string;
  "content:encoded"?: string;
  id?: string; // Atom
  image?: { url?: string };
};

type RawFeed = Parser.Output<RawItem> & {
  image?: { url?: string };
  icon?: string;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function extractFirstImage(html: string | null): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFeed(raw: RawFeed, feedUrl: string): NormalizedFeed {
  const meta: NormalizedFeedMeta = {
    title: firstNonEmpty(raw.title),
    description: firstNonEmpty(raw.description),
    siteUrl: firstNonEmpty(raw.link) ? normalizeUrl(raw.link!, feedUrl) : null,
    language: firstNonEmpty((raw as { language?: string }).language),
    iconUrl: firstNonEmpty(raw.image?.url, raw.icon) ? normalizeUrl((raw.image?.url ?? raw.icon)!, feedUrl) : null,
  };

  const articles = (raw.items ?? []).map((item) => normalizeItem(item, feedUrl));

  return { meta, articles };
}

function normalizeItem(item: RawItem, feedUrl: string): NormalizedArticle {
  const rawHtml = firstNonEmpty(item["content:encoded"], item.content, item.summary) ?? "";
  const contentHtml = sanitizeArticleHtml(rawHtml);
  const contentText = htmlToText(contentHtml);
  const summaryHtml = sanitizeArticleHtml(
    firstNonEmpty(item.contentSnippet ? undefined : item.summary, item.summary) ?? rawHtml,
  );

  const originalUrlRaw = firstNonEmpty(item.link);
  const originalUrl = originalUrlRaw ? normalizeUrl(originalUrlRaw, feedUrl) : null;
  const canonicalUrl = originalUrl;

  const publishedDate = parseFeedDate(item.isoDate ?? item.pubDate ?? null);
  const publishedAt = toIso(publishedDate);

  const title = firstNonEmpty(item.title);

  const guid = firstNonEmpty(item.guid, item.id);
  const externalId = guid ?? (originalUrl ? `url:${originalUrl}` : computeFallbackId({
    feedUrl,
    title,
    publishedAt,
    url: originalUrl,
  }));

  const imageUrl = firstNonEmpty(item.enclosure?.url) ?? extractFirstImage(contentHtml);

  const contentHash = computeContentHash({ title, contentText, publishedAt });

  return {
    externalId,
    canonicalUrl,
    originalUrl,
    title,
    author: firstNonEmpty(item.creator, (item as { author?: string }).author),
    publishedAt,
    updatedAt: null,
    summaryHtml: sanitizePlainSummaryOrHtml(summaryHtml),
    contentHtml,
    contentText,
    imageUrl: imageUrl ? normalizeUrl(imageUrl, feedUrl) : null,
    contentHash,
  };
}

function sanitizePlainSummaryOrHtml(summaryHtml: string): string {
  // Store the summary as sanitized plain text for compact list rendering;
  // the full sanitized HTML is kept separately in contentHtml.
  return sanitizePlainSummary(summaryHtml, 500);
}
