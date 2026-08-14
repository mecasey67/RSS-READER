import { Agent, fetch as undiciFetch } from "undici";
import { validateFetchUrl, safeLookup, SsrfBlockedError } from "@/security/ssrf";

// Read lazily (not as module-level constants) so tests can override env vars
// per-case and an admin can reconfigure without a process-wide reload order
// dependency.
function userAgent(): string {
  return process.env.USER_AGENT ?? "ModernRSSReader/1.0 (+self-hosted feed reader; https://github.com/)";
}
function fetchTimeoutMs(): number {
  return Number(process.env.FETCH_TIMEOUT_MS ?? 15_000);
}
function maxFeedSizeBytes(): number {
  return Number(process.env.MAX_FEED_SIZE ?? 10 * 1024 * 1024); // 10 MB
}
const MAX_REDIRECTS = 5;

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "too_large" | "http_error" | "network" | "ssrf" | "redirect_loop",
    readonly httpStatus?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FeedFetchError";
  }
}

export interface FeedFetchResult {
  status: "ok" | "not_modified";
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
  httpStatus: number;
  finalUrl: string;
  retryAfterSeconds?: number;
}

// One Agent per fetch call (not process-wide) so per-request DNS pinning via
// safeLookup can't leak state between unrelated hosts.
function buildAgent() {
  return new Agent({
    connect: { lookup: safeLookup as never, timeout: fetchTimeoutMs() },
  });
}

export async function fetchFeed(
  url: string,
  opts: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FeedFetchResult> {
  let currentUrl = url;
  const agent = buildAgent();
  const timeoutMs = fetchTimeoutMs();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validated = validateFetchUrl(currentUrl); // throws SsrfBlockedError

    const headers: Record<string, string> = {
      "User-Agent": userAgent(),
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8, */*;q=0.5",
    };
    if (opts.etag) headers["If-None-Match"] = opts.etag;
    if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(validated, {
        headers,
        redirect: "manual",
        dispatcher: agent,
        signal: controller.signal as never,
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw new FeedFetchError(err.message, "ssrf");
      if ((err as Error).name === "AbortError") {
        throw new FeedFetchError(`Request timed out after ${timeoutMs}ms`, "timeout");
      }
      throw new FeedFetchError(`Network error fetching feed: ${(err as Error).message}`, "network");
    } finally {
      clearTimeout(timeout);
    }

    // Manual redirect handling: re-validate the Location header against
    // SSRF rules before following it, closing the "trusted feed redirects
    // to internal resource" gap.
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      const location = new URL(response.headers.get("location")!, validated).toString();
      currentUrl = location;
      continue;
    }

    if (response.status === 304) {
      return {
        status: "not_modified",
        httpStatus: 304,
        finalUrl: validated.toString(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      throw new FeedFetchError(`HTTP ${response.status}`, "http_error", response.status, retryAfter);
    }

    if (!response.ok) {
      throw new FeedFetchError(`HTTP ${response.status}`, "http_error", response.status);
    }

    const body = await readBodyWithLimit(response, maxFeedSizeBytes());

    return {
      status: "ok",
      body,
      httpStatus: response.status,
      finalUrl: validated.toString(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  }

  throw new FeedFetchError("Too many redirects", "redirect_loop");
}

async function readBodyWithLimit(response: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FeedFetchError(`Feed response exceeded max size of ${maxBytes} bytes`, "too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds;
  const date = new Date(header);
  if (!Number.isNaN(date.getTime())) return Math.max(0, Math.round((date.getTime() - Date.now()) / 1000));
  return undefined;
}
