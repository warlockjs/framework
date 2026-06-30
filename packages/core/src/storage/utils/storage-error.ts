/**
 * Base error for the storage subsystem.
 *
 * The storage drivers historically threw bare `Error`s. The security
 * guards added to the local and cloud drivers (path-traversal containment,
 * SSRF-guarded `putFromUrl`) need a named, catchable error so callers can
 * branch on `instanceof StorageError` instead of string-matching messages.
 *
 * `context` is a free-form diagnostic bag (offending location, host, URL)
 * mirroring the convention used by `@warlock.js/ai`'s error classes — it is
 * for logs and telemetry, treated as opaque by consumers.
 */
export type StorageErrorOptions = {
  cause?: unknown;
  context?: Record<string, unknown>;
};

/**
 * Error thrown by storage drivers for refused or invalid operations
 * (path-traversal attempts, blocked outbound fetches, oversized downloads).
 */
export class StorageError extends Error {
  /**
   * Optional original thrown value preserved through re-wrapping.
   */
  public readonly cause?: unknown;

  /**
   * Optional free-form diagnostic bag (location, host, url, …).
   */
  public readonly context?: Record<string, unknown>;

  public constructor(message: string, options?: StorageErrorOptions) {
    super(message);
    this.name = "StorageError";
    this.cause = options?.cause;
    this.context = options?.context;
  }
}
