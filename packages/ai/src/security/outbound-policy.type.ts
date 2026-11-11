/**
 * One shared policy for every server-side outbound request the framework
 * makes on a user's behalf — attachment fetches (S1), URL skill manifests
 * (S3), RAG document loaders (A4), and any future HTTP helper. Centralizing
 * the controls here means a single, audited SSRF / resource-exhaustion
 * guard instead of six ad-hoc `fetch()` call sites.
 *
 * Every field is optional; {@link resolveOutboundPolicy} fills safe
 * defaults. The defaults are deliberately strict (https-only, private-IP
 * deny on, 10s timeout, 5 MiB cap) so a caller that opts into outbound
 * fetch without tuning still gets a hardened request.
 *
 * @example
 * const policy: OutboundPolicy = {
 *   allowedSchemes: ["https"],
 *   hostAllowlist: ["cdn.example.com"],
 *   maxBytes: 1_000_000,
 *   timeoutMs: 5_000,
 * };
 */
export type OutboundPolicy = {
  /**
   * URL schemes permitted for the request. Compared case-insensitively
   * against the URL's protocol (without the trailing colon). Default
   * `["https"]` — `http` must be opted in explicitly.
   */
  allowedSchemes?: string[];
  /**
   * Host allowlist. When set, the request host must equal one of these
   * entries or be a subdomain of one (`cdn.example.com` allows
   * `a.cdn.example.com`). When omitted, any host passes the allowlist
   * check — but the private-IP guard below still applies.
   */
  hostAllowlist?: string[];
  /**
   * Resolve the host through DNS and reject when it maps to a private,
   * loopback, link-local, unique-local, or cloud-metadata
   * (`169.254.169.254`) address — the core SSRF guard. Catches a public
   * hostname that resolves inward. Default `true`.
   */
  denyPrivateIPsAfterDNS?: boolean;
  /**
   * Maximum response body size in bytes. A declared `content-length`
   * over this fails fast; otherwise the body is read with a running cap
   * and aborted on overflow. Default `5_242_880` (5 MiB).
   */
  maxBytes?: number;
  /**
   * Deadline in milliseconds for the whole exchange: the request, every
   * redirect hop, and the body read (a server that drips bytes cannot hold
   * the caller past it). Default `10_000`.
   */
  timeoutMs?: number;
  /**
   * Maximum number of redirect hops `guardedFetch` will follow. Every
   * hop's `Location` is re-validated against this policy (scheme, host
   * allowlist, private-IP guard) before it is followed — a redirect can
   * never reach a URL the original request could not have. Default `5`.
   */
  maxRedirects?: number;
  /**
   * Header names still sent after a redirect moves to ANOTHER origin, on
   * top of the built-in non-credential set (`accept`, `accept-encoding`,
   * `accept-language`, `cache-control`, `content-language`,
   * `content-type`, `pragma`, `user-agent`). Every other header the caller
   * set — `authorization`, `cookie`, or a custom secret such as
   * `x-api-key` — is dropped on that hop. Default `[]`.
   *
   * @example
   * { crossOriginHeaders: ["x-request-id"] }
   */
  crossOriginHeaders?: string[];
  /**
   * Caller `AbortSignal`, merged with the internal timeout — whichever
   * fires first aborts the request.
   */
  signal?: AbortSignal;
  /**
   * Injected `fetch` implementation (for tests, proxies, or a wrapper
   * that already enforces app-level SSRF rules). Defaults to the global
   * `fetch`. With the global `fetch`, each connection is pinned to an
   * address that passed the private-IP check (a host whose DNS answer
   * changes after the check is refused); an injected `fetch` is used
   * as-is, with the DNS pre-check still applied.
   */
  fetch?: typeof fetch;
};

/** {@link OutboundPolicy} with every default resolved — never partial. */
export type ResolvedOutboundPolicy = {
  allowedSchemes: string[];
  hostAllowlist?: string[];
  denyPrivateIPsAfterDNS: boolean;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  crossOriginHeaders: string[];
  signal?: AbortSignal;
  fetch: typeof fetch;
};
