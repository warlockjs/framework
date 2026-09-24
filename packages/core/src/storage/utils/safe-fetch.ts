import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateOrReservedIp } from "./classify-ip-address";
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
 * Cap on the number of re-validated redirect hops. Mirrors
 * `@warlock.js/ai`'s `DEFAULT_MAX_REDIRECTS`
 * (ai/src/security/outbound-policy.ts:15).
 */
const DEFAULT_MAX_REDIRECTS = 5;

/** 3xx statuses whose `Location` a follow re-issues — mirrors ai/src/security/outbound-policy.ts:18. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

export { isPrivateOrReservedIp };

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
      throw new StorageError(`outbound request blocked — "${host}" is a private/reserved address`, {
        context: { url: rawUrl, address: host },
      });
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
 * Redirects are NEVER delegated to the platform: every hop is issued with
 * `redirect: "manual"` and its `Location` is re-run through
 * {@link assertUrlAllowed} — including the DNS-resolution private-IP check
 * — before being followed (capped at {@link DEFAULT_MAX_REDIRECTS}), so a
 * 3xx from an allowed host cannot smuggle the request to a private /
 * metadata target. Mirrors `@warlock.js/ai`'s `guardedFetch`
 * (ai/src/security/outbound-policy.ts:188-284); duplicated per this
 * module's file-header note since core cannot depend on ai.
 *
 * @throws {StorageError} On a blocked URL (initial or redirect target),
 * a redirect-hop bound overflow, timeout, or oversized body.
 */
export async function safeFetchToBuffer(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const policy = resolveFetchPolicy(options);
  let url = await assertUrlAllowed(rawUrl, policy);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new StorageError(`outbound request timed out after ${policy.timeoutMs}ms`, {
        context: { url: rawUrl, timeoutMs: policy.timeoutMs },
      }),
    );
  }, policy.timeoutMs);

  try {
    let response: Response;

    for (let hop = 0; ; hop++) {
      response = await policy.fetch(url, { signal: controller.signal, redirect: "manual" });

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        break;
      }

      if (hop >= DEFAULT_MAX_REDIRECTS) {
        throw new StorageError(
          `outbound request blocked — more than ${DEFAULT_MAX_REDIRECTS} redirects`,
          { context: { url: rawUrl, maxRedirects: DEFAULT_MAX_REDIRECTS } },
        );
      }

      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new StorageError(
          `outbound request blocked — invalid redirect Location: ${location}`,
          {
            context: { url: url.toString(), location },
          },
        );
      }

      // Discard the interim body so the connection can be reused.
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }

      // The redirect target gets the SAME scheme + private-IP validation
      // (incl. DNS resolution) as the initial URL — this is what closes
      // the redirect-based SSRF bypass: a 302 from an allowed host to
      // 169.254.169.254 is re-validated here, not blindly followed.
      url = await assertUrlAllowed(target.toString(), policy);
    }

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
      throw new StorageError(`outbound response body exceeded the ${maxBytes}-byte cap`, {
        context: { url: rawUrl, maxBytes },
      });
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
      throw new StorageError(`outbound response body exceeded the ${maxBytes}-byte cap`, {
        context: { url: rawUrl, maxBytes },
      });
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
