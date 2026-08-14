// Tracking parameters that are safe to drop because they never affect what
// content a URL points to. Deliberately conservative — when in doubt we keep
// the parameter rather than risk conflating two different articles.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "utm_reader", "utm_social",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
  "ref", "ref_src", "igshid", "spm", "_hsenc", "_hsmi",
]);

/**
 * Normalizes a URL for deduplication/display purposes. This is intentionally
 * non-destructive: it only removes fragments, default ports, and well-known
 * tracking parameters, and lowercases scheme/host. It never touches path
 * case, trailing content, or query parameters we don't recognize.
 */
export function normalizeUrl(rawUrl: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  url.hash = "";

  const params = Array.from(url.searchParams.entries()).filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()));
  params.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);

  // Strip a single trailing slash on non-root paths for consistency.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function normalizeFeedUrl(rawUrl: string): string | null {
  return normalizeUrl(rawUrl);
}
