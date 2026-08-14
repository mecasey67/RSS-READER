import dns from "node:dns";
import net from "node:net";

/**
 * SSRF protection for user-supplied feed/discovery URLs.
 *
 * The threat: a user (or a malicious redirect from a feed the user already
 * trusts) supplies a URL that causes this server to make a request to an
 * internal-only resource (localhost, RFC1918 ranges, cloud metadata
 * endpoints, etc). We block that at three points:
 *   1. Protocol allowlist (http/https only — no file:, gopher:, etc).
 *   2. Literal-IP hostnames are checked directly.
 *   3. DNS-name hostnames are resolved and the resolved IP is checked
 *      *at connect time* (not just at validation time) via a custom `lookup`
 *      function handed to the HTTP agent, which closes the DNS-rebinding
 *      TOCTOU gap between "check" and "connect".
 */

function isLocalFeedsAllowed(): boolean {
  return process.env.ALLOW_LOCAL_FEEDS === "true";
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export function assertAllowedProtocol(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`Protocol not allowed: ${url.protocol}`);
  }
}

// IPv4 ranges that must never be reached from feed fetches.
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address too.
    const embedded = lower.slice("::ffff:".length);
    if (net.isIPv4(embedded)) return isBlockedIpv4(embedded);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unrecognized format — fail closed
}

/**
 * Validates protocol + (if the hostname is a literal IP) the address itself.
 * DNS-name hostnames are validated later, at connect time, by safeLookup.
 */
export function validateFetchUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Not a valid URL: ${rawUrl}`);
  }
  assertAllowedProtocol(url);

  if (isLocalFeedsAllowed()) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlockedError(`URL resolves to a blocked address: ${hostname}`);
    }
  }
  if (hostname.toLowerCase() === "localhost") {
    throw new SsrfBlockedError("localhost is not an allowed feed host");
  }
  return url;
}

type DnsLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup`-compatible function suitable for passing as the `lookup`
 * option of an HTTP(S) agent's connect options. Node/undici call this
 * immediately before opening the socket, so validating here (rather than
 * only ahead of time) prevents an attacker from pointing a hostname at a
 * safe IP during validation and a private IP during the actual connection.
 */
export function safeLookup(
  hostname: string,
  options: dns.LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: DnsLookupCallback,
): void {
  const cb = (typeof options === "function" ? options : callback) as DnsLookupCallback;
  const opts: dns.LookupOptions = typeof options === "function" ? {} : options;
  const wantsAll = !!(opts as dns.LookupAllOptions).all;

  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (list.length === 0) {
      return cb(new Error(`DNS resolution returned no addresses for ${hostname}`) as NodeJS.ErrnoException, "", 4);
    }
    if (!isLocalFeedsAllowed()) {
      const blocked = list.find((a) => isBlockedIp(a.address));
      if (blocked) {
        return cb(
          new SsrfBlockedError(`${hostname} resolves to a blocked address (${blocked.address})`) as NodeJS.ErrnoException,
          "",
          4,
        );
      }
    }
    // Must mirror dns.lookup's own dual-mode callback contract: callers that
    // requested `{ all: true }` (Node's happy-eyeballs dual-stack connector
    // does this) expect an address array back; everyone else expects the
    // 2-arg single-address form. Returning the wrong shape surfaces as an
    // opaque "Invalid IP address: undefined" deep inside net internals.
    if (wantsAll) {
      cb(null, list as dns.LookupAddress[]);
    } else {
      const chosen = list[0];
      cb(null, chosen.address, chosen.family);
    }
  });
}
