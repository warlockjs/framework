/**
 * HTTP middleware error codes.
 *
 * Mirrors the convention used by `@warlock.js/auth`'s `AuthErrorCodes` —
 * stable string identifiers clients can branch on without parsing message text.
 *
 * Range `EC100..EC199` is reserved for `@warlock.js/core` HTTP middleware.
 * `EC001..EC099` belongs to `@warlock.js/auth`.
 */
export enum HttpErrorCodes {
  /**
   * Same idempotency key reused with a different request body.
   * Client likely has a bug — same intent must reuse the same body.
   */
  IdempotencyKeyConflict = "EC100",

  /**
   * Idempotency key header is malformed (wrong length / non-printable chars).
   */
  IdempotencyKeyInvalid = "EC101",

  /**
   * Per-route rate limit exceeded. Different from the global `@fastify/rate-limit` 429.
   */
  RateLimitExceeded = "EC102",

  /**
   * Per-route concurrency cap reached — too many in-flight requests against this endpoint.
   */
  ConcurrencyLimitReached = "EC103",

  /**
   * Request `Content-Length` exceeds the per-route body cap.
   */
  BodyTooLarge = "EC104",

  /**
   * Client IP failed the `ipFilter()` allow/deny check.
   */
  IpForbidden = "EC105",

  /**
   * Application is in maintenance mode and the request did not match the allowlist.
   */
  Maintenance = "EC106",
}
