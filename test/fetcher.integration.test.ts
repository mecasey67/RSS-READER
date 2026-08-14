import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";

process.env.ALLOW_LOCAL_FEEDS = "true";

import { fetchFeed, FeedFetchError } from "@/feeds/fetcher";

let server: Server;
let baseUrl: string;
let lastRequestHeaders: http.IncomingHttpHeaders = {};
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastRequestHeaders = req.headers;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  lastRequestHeaders = {};
});

describe("fetchFeed integration", () => {
  it("handles a plain 200 response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.end("<rss></rss>");
    };
    const result = await fetchFeed(`${baseUrl}/feed.xml`);
    expect(result.status).toBe("ok");
    expect(result.body).toBe("<rss></rss>");
    expect(result.httpStatus).toBe(200);
  });

  it("sends a descriptive User-Agent header", async () => {
    handler = (_req, res) => res.end("ok");
    await fetchFeed(`${baseUrl}/feed.xml`);
    expect(lastRequestHeaders["user-agent"]).toMatch(/ModernRSSReader/);
  });

  it("sends conditional headers when etag/lastModified are provided", async () => {
    handler = (_req, res) => res.end("ok");
    await fetchFeed(`${baseUrl}/feed.xml`, { etag: '"abc123"', lastModified: "Wed, 01 Jan 2024 00:00:00 GMT" });
    expect(lastRequestHeaders["if-none-match"]).toBe('"abc123"');
    expect(lastRequestHeaders["if-modified-since"]).toBe("Wed, 01 Jan 2024 00:00:00 GMT");
  });

  it("handles HTTP 304 Not Modified without a body", async () => {
    handler = (_req, res) => {
      res.writeHead(304, { ETag: '"abc123"' });
      res.end();
    };
    const result = await fetchFeed(`${baseUrl}/feed.xml`, { etag: '"abc123"' });
    expect(result.status).toBe("not_modified");
    expect(result.httpStatus).toBe(304);
  });

  it("follows redirects while re-validating each hop", async () => {
    handler = (req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: `${baseUrl}/final` });
        res.end();
      } else {
        res.writeHead(200);
        res.end("final content");
      }
    };
    const result = await fetchFeed(`${baseUrl}/start`);
    expect(result.status).toBe("ok");
    expect(result.body).toBe("final content");
    expect(result.finalUrl).toBe(`${baseUrl}/final`);
  });

  it("throws FeedFetchError on HTTP 500", async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end("server error");
    };
    await expect(fetchFeed(`${baseUrl}/feed.xml`)).rejects.toBeInstanceOf(FeedFetchError);
  });

  it("throws FeedFetchError with retryAfterSeconds on HTTP 429", async () => {
    handler = (_req, res) => {
      res.writeHead(429, { "Retry-After": "120" });
      res.end();
    };
    try {
      await fetchFeed(`${baseUrl}/feed.xml`);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FeedFetchError);
      expect((err as FeedFetchError).retryAfterSeconds).toBe(120);
    }
  });

  it("throws FeedFetchError('too_large') when response exceeds MAX_FEED_SIZE", async () => {
    const original = process.env.MAX_FEED_SIZE;
    process.env.MAX_FEED_SIZE = "10";
    handler = (_req, res) => res.end("this response body is way more than ten bytes long");
    try {
      await expect(fetchFeed(`${baseUrl}/feed.xml`)).rejects.toMatchObject({ kind: "too_large" });
    } finally {
      process.env.MAX_FEED_SIZE = original;
    }
  });
});
