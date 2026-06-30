import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { StorageError } from "./storage-error";

/**
 * SSRF / resource-exhaustion guard for storage's outbound downloads
 * (`putFromUrl`).
 *
 * NOTE: this MIRRORS `@warlock.js/ai`'s `src/security/private-ip.ts` and
 * `src/security/outbound-policy.ts`. It is duplicated here intentionally
 * because `@warlock.js/core` cannot depend on `@warlock.js/ai`. Pending
 * extraction of a shared security package, keep the two copies in sync.
 */

/** 50 MiB — default cap on a downloaded body (storage files run larger than AI payloads). */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** 30s — default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options controlling a guarded outbound fetch. Every field is optional;
 * {@link resolveFetchPolicy} fills safe defaults. The defaults are
 * deliberately strict (https+http, private-IP deny ON, 30s timeout,
 * 50 MiB cap) so a caller that does not tune them still gets a hardened
 * request.
 */
export type SafeFetchOptions = {
  /**
   * Whether to ALLOW private / loopback / link-local / metadata hosts.
   * Default `false` — the SSRF guard is on (private hosts are denied).
   */
  allowPrivateHosts?: boolean;
  /**
   * Maximum response body size in bytes. A declared `content-length` over
   * this fails fast; otherwise the body is read with a running cap and the
   * stream is aborted on overflow. Default `52_428_800` (50 MiB).
   */
  maxBytes?: number;
  /** Per-request timeout in milliseconds. Default `30_000`. */
  timeoutMs?: number;
  /**
   * URL schemes permitted for the request, compared case-insensitively.
   * Default `["https", "http"]`.
   */
  allowedSchemes?: string[];
  /**
   * Injected `fetch` implementation (for tests or proxies). Defaults to the
   * global `fetch`.
   */
  fetch?: typeof fetch;
};

/** {@link SafeFetchOptions} with every default resolved — never partial. */
type ResolvedFetchPolicy = {
  allowPrivateHosts: boolean;
  maxBytes: number;
  timeoutMs: number;
  allowedSchemes: string[];
  fetch: typeof fetch;
};

/**
 * Fill a {@link SafeFetchOptions} with strict defaults: https+http,
 * private-IP deny on, 30s timeout, 50 MiB cap, global `fetch`.
 */
function resolveFetchPolicy(options: SafeFetchOptions = {}): ResolvedFetchPolicy {
  return {
    allowPrivateHosts: options.allowPrivateHosts ?? false,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowedSchemes: options.allowedSchemes ?? ["https", "http"],
    fetch: options.fetch ?? globalThis.fetch,
  };
}

/** Parse a dotted-quad into four octets, or `null` if malformed. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) {
    return true; // unparseable → refuse, fail closed
  }

  const [a, b] = octets;

  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local + metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 192 && b === 0) || // 192.0.0.0/24 + 192.0.2.0/24 (IETF/test)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51) || // 198.51.100.0/24 test-net-2
    (a === 203 && b === 0) || // 203.0.113.0/24 test-net-3
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0]; // drop zone id

  // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::a.b.c.d) — defer to the v4
  // check on the trailing dotted-quad so an inward-mapped address is caught.
  const v4 = normalized.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    return isPrivateIpv4(v4[1]);
  }

  if (normalized === "::1" || normalized === "::") {
    return true; // loopback / unspecified
  }

  // Expand only the leading group enough to classify the reserved blocks.
  const firstGroup = normalized.split(":")[0];
  const head = firstGroup === "" ? 0 : Number.parseInt(firstGroup, 16);

  // fc00::/7 unique-local (fc.. / fd..)
  if ((head & 0xfe00) === 0xfc00) {
    return true;
  }
  // fe80::/10 link-local
  if ((head & 0xffc0) === 0xfe80) {
    return true;
  }

  return false;
}

/**
 * True when `ip` is a private, loopback, link-local, unique-local,
 * carrier-grade-NAT, unspecified, or otherwise non-public address — the set
 * an SSRF guard must refuse. Accepts IPv4 and IPv6 literals (including
 * IPv4-mapped IPv6 like `::ffff:169.254.169.254`). A non-IP string returns
 * `false` (the caller resolves hostnames via DNS first).
 *
 * The cloud-metadata endpoint `169.254.169.254` is covered by the IPv4
 * link-local range `169.254.0.0/16`.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isPrivateIpv4(ip);
  }
  if (family === 6) {
    return isPrivateIpv6(ip);
  }
  return false;
}

/** Strip the `[ ]` IPv6 brackets `URL.hostname` keeps. */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Reject when `host` is — or resolves to — a private / reserved address.
 * IP literals are checked directly; hostnames are resolved via DNS and every
 * returned address is checked (a public name pointing inward is caught). A
 * resolution failure fails closed.
 */
async function assertHostNotPrivate(host: string, rawUrl: string): Promise<void> {
  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new StorageError(
        `outbound request blocked — "${host}" is a private/reserved address`,
        { context: { url: rawUrl, address: host } },
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch (cause) {
    throw new StorageError(
      `outbound request blocked — could not resolve host "${host}" to verify it is public`,
      { cause, context: { url: rawUrl, host } },
    );
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new StorageError(
        `outbound request blocked — host "${host}" resolves to a private/reserved address (${address})`,
        { context: { url: rawUrl, host, address } },
      );
    }
  }
}

/**
 * Validate a URL against the policy BEFORE any network call: scheme
 * allowlist and (when private hosts are not allowed) a DNS resolution that
 * rejects private / loopback / link-local / metadata addresses — the SSRF
 * guard. Returns the parsed `URL` on success; throws {@link StorageError}
 * otherwise.
 */
async function assertUrlAllowed(rawUrl: string, policy: ResolvedFetchPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new StorageError(`outbound request blocked — invalid URL: ${rawUrl}`, {
      context: { url: rawUrl },
    });
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (!policy.allowedSchemes.some((s) => s.toLowerCase() === scheme)) {
    throw new StorageError(
      `outbound request blocked — scheme "${scheme}" is not allowed (allowed: ${policy.allowedSchemes.join(", ")})`,
      { context: { url: rawUrl, scheme } },
    );
  }

  if (!policy.allowPrivateHosts) {
    const host = stripBrackets(url.hostname);
    await assertHostNotPrivate(host, rawUrl);
  }

  return url;
}

/**
 * Result of {@link safeFetchToBuffer}: the (capped) body plus the response's
 * content-type, so callers can derive a MIME type and enforce a non-empty
 * content-type check.
 */
export type SafeFetchResult = {
  buffer: Buffer;
  contentType: string | null;
  status: number;
  statusText: string;
  ok: boolean;
};

/**
 * SSRF-guarded download: validates the URL (scheme allowlist + post-DNS
 * private-IP deny), performs the request with a timeout via
 * `AbortController`, then streams the body with a hard byte cap — aborting
 * the moment the running total exceeds `maxBytes`. A declared
 * `content-length` over the cap fails fast.
 *
 * @throws {StorageError} On a blocked URL, timeout, or oversized body.
 */
export async function safeFetchToBuffer(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const policy = resolveFetchPolicy(options);
  const url = await assertUrlAllowed(rawUrl, policy);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new StorageError(`outbound request timed out after ${policy.timeoutMs}ms`, {
        context: { url: rawUrl, timeoutMs: policy.timeoutMs },
      }),
    );
  }, policy.timeoutMs);

  try {
    const response = await policy.fetch(url, { signal: controller.signal });

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > policy.maxBytes) {
      throw new StorageError(
        `outbound response body too large — declared ${declared} bytes exceeds the ${policy.maxBytes}-byte cap`,
        { context: { url: rawUrl, declared, maxBytes: policy.maxBytes } },
      );
    }

    const buffer = await readBodyCapped(response, policy.maxBytes, rawUrl);

    return {
      buffer,
      contentType: response.headers.get("content-type"),
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body into a Buffer with a hard byte cap. The stream is
 * read chunk-by-chunk and cancelled the moment the running total exceeds
 * `maxBytes`. Throws {@link StorageError} on overflow.
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
  rawUrl: string,
): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new StorageError(
        `outbound response body exceeded the ${maxBytes}-byte cap`,
        { context: { url: rawUrl, maxBytes } },
      );
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new StorageError(
        `outbound response body exceeded the ${maxBytes}-byte cap`,
        { context: { url: rawUrl, maxBytes } },
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
