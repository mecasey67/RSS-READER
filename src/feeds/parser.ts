import Parser from "rss-parser";

export class FeedParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "FeedParseError";
  }
}

// rss-parser (via xml2js/sax) does not resolve external entities or DTDs,
// so it is not vulnerable to classic XXE. It transparently handles RSS 2.0,
// RSS 0.9x, RSS 1.0/RDF, and Atom 1.0.
const parser = new Parser({
  timeout: 30_000,
  maxRedirects: 0, // redirects are handled by our own SSRF-safe fetcher
  customFields: {
    feed: ["icon", "language"],
    item: [
      ["content:encoded", "content:encoded"],
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
      ["id", "id"],
    ],
  },
});

export async function parseFeedXml(xml: string) {
  if (!xml || !xml.trim()) {
    throw new FeedParseError("Empty feed response");
  }
  try {
    return await parser.parseString(xml);
  } catch (err) {
    throw new FeedParseError(`Failed to parse feed XML: ${(err as Error).message}`, err);
  }
}
