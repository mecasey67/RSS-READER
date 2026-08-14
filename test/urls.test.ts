import { describe, it, expect } from "vitest";
import { normalizeUrl } from "@/lib/urls";

describe("normalizeUrl", () => {
  it("strips utm tracking parameters", () => {
    expect(normalizeUrl("https://example.com/post?utm_source=twitter&id=5")).toBe(
      "https://example.com/post?id=5",
    );
  });

  it("removes the fragment", () => {
    expect(normalizeUrl("https://example.com/post#section")).toBe("https://example.com/post");
  });

  it("lowercases scheme and host", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Post")).toBe("https://example.com/Post");
  });

  it("removes default ports", () => {
    expect(normalizeUrl("https://example.com:443/post")).toBe("https://example.com/post");
    expect(normalizeUrl("http://example.com:80/post")).toBe("http://example.com/post");
  });

  it("keeps non-default ports", () => {
    expect(normalizeUrl("https://example.com:8443/post")).toBe("https://example.com:8443/post");
  });

  it("strips a single trailing slash on non-root paths", () => {
    expect(normalizeUrl("https://example.com/post/")).toBe("https://example.com/post");
  });

  it("preserves unrecognized query parameters", () => {
    expect(normalizeUrl("https://example.com/post?id=1&page=2")).toBe(
      "https://example.com/post?id=1&page=2",
    );
  });

  it("strips recognized tracking parameters like ref", () => {
    expect(normalizeUrl("https://example.com/post?ref=hn&id=1")).toBe("https://example.com/post?id=1");
  });

  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("/post", "https://example.com/index.html")).toBe("https://example.com/post");
  });

  it("returns null for invalid URLs", () => {
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("returns null for disallowed protocols", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });
});
