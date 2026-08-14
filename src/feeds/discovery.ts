import { fetchFeed, FeedFetchError } from "./fetcher";
import { normalizeUrl } from "@/lib/urls";

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: "rss" | "atom" | "unknown";
}

const FEED_LINK_RE = /<link\b[^>]*>/gi;
const FEED_MIME_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/x.atom+xml",
  "application/x-atom+xml",
]);

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

/**
 * Given an arbitrary page URL, looks for <link rel="alternate" type="...">
 * feed advertisements in the HTML head. Never guesses a feed URL that isn't
 * explicitly advertised — if discovery finds nothing, the caller must not
 * fall back to blind guesses like /feed or /rss.
 */
export async function discoverFeeds(pageUrl: string): Promise<DiscoveredFeed[]> {
  let html: string;
  try {
    const result = await fetchFeed(pageUrl);
    if (result.status !== "ok" || !result.body) return [];
    html = result.body;
  } catch (err) {
    if (err instanceof FeedFetchError) return [];
    throw err;
  }

  const head = html.slice(0, html.toLowerCase().indexOf("</head>") + 7 || html.length);
  const found: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  for (const tag of head.match(FEED_LINK_RE) ?? []) {
    const rel = attr(tag, "rel");
    if (!rel || !/alternate/i.test(rel)) continue;
    const type = attr(tag, "type")?.toLowerCase();
    if (!type || !FEED_MIME_TYPES.has(type)) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute || seen.has(absolute)) continue;
    seen.add(absolute);
    found.push({
      url: absolute,
      title: attr(tag, "title"),
      type: type.includes("atom") ? "atom" : "rss",
    });
  }

  return found;
}

/** Returns true if the given URL itself looks like it's already a feed. */
export function looksLikeFeedUrl(url: string): boolean {
  return /\.(rss|xml|atom)(\?|$)/i.test(url) || /\/feed\/?(\?|$)/i.test(url);
}
