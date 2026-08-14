import { describe, it, expect } from "vitest";
import { validateFetchUrl, isBlockedIp, safeLookup, SsrfBlockedError } from "@/security/ssrf";

describe("isBlockedIp", () => {
  it("blocks loopback addresses", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks private RFC1918 ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.5.5")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks link-local incl. cloud metadata endpoint", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 private addresses", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("93.184.216.34")).toBe(false); // example.com
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});

describe("validateFetchUrl", () => {
  it("rejects non-http(s) protocols", () => {
    expect(() => validateFetchUrl("file:///etc/passwd")).toThrow(SsrfBlockedError);
    expect(() => validateFetchUrl("ftp://example.com/file")).toThrow(SsrfBlockedError);
  });

  it("rejects literal loopback/private IP hosts", () => {
    expect(() => validateFetchUrl("http://127.0.0.1/feed.xml")).toThrow(SsrfBlockedError);
    expect(() => validateFetchUrl("http://169.254.169.254/latest/meta-data")).toThrow(SsrfBlockedError);
    expect(() => validateFetchUrl("http://10.0.0.1/feed")).toThrow(SsrfBlockedError);
  });

  it("rejects the literal hostname localhost", () => {
    expect(() => validateFetchUrl("http://localhost/feed.xml")).toThrow(SsrfBlockedError);
  });

  it("allows ordinary public https URLs", () => {
    expect(() => validateFetchUrl("https://example.com/feed.xml")).not.toThrow();
  });
});

describe("safeLookup", () => {
  // Regression test: Node's happy-eyeballs dual-stack connector calls the
  // custom `lookup` function with `{ all: true }` and expects an *array*
  // callback; calling back in single-address form here previously produced
  // an opaque "Invalid IP address: undefined" deep inside net internals for
  // every real (non-loopback) hostname.
  it("calls back with an array when the caller passes { all: true }", async () => {
    process.env.ALLOW_LOCAL_FEEDS = "true";
    await new Promise<void>((resolve, reject) => {
      safeLookup("localhost", { all: true }, (err, address) => {
        try {
          expect(err).toBeNull();
          expect(Array.isArray(address)).toBe(true);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("calls back with a single address string when `all` is not requested", async () => {
    process.env.ALLOW_LOCAL_FEEDS = "true";
    await new Promise<void>((resolve, reject) => {
      safeLookup("localhost", {}, (err, address, family) => {
        try {
          expect(err).toBeNull();
          expect(typeof address).toBe("string");
          expect(typeof family).toBe("number");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("still blocks private addresses when called in { all: true } mode", async () => {
    process.env.ALLOW_LOCAL_FEEDS = "false";
    await new Promise<void>((resolve, reject) => {
      // 127.0.0.1 resolves to itself via dns.lookup even in `all` mode.
      safeLookup("localhost", { all: true }, (err) => {
        try {
          // localhost resolves to a loopback address, which is blocked.
          expect(err).toBeInstanceOf(Error);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
