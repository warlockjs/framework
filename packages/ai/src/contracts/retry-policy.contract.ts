import type { AIErrorCode } from "../errors/error-code.type";
import type { RetryBackoff } from "./workflow/retry-config.type";

/** Which wait budget a retry draws from. */
export type RetryBudgetKind = "general" | "offline";

/**
 * Details of one retry about to happen, passed to
 * {@link RetryPolicy.onRetry} before the wait.
 */
export type RetryEvent = {
  /** The call about to start, counting every call made (2 for the first retry). */
  attempt: number;
  /** Milliseconds the call waits before the next attempt. */
  delayMs: number;
  /** The error that ended the previous attempt, verbatim. */
  cause: unknown;
  /** The budget this retry is charged to. */
  budget: RetryBudgetKind;
};

/**
 * Retry policy for a single model call, applied by `retryModel`.
 * Every field is optional; the defaults are listed per field.
 */
export type RetryPolicy = {
  /** Total attempts including the first, offline retries not counted. Default 3. */
  attempts?: number;
  /** Delay unit in ms: `"exponential"` waits `baseMs * 2^(n-1)`, `"linear"` `baseMs * n`. Default 500. */
  baseMs?: number;
  /** Delay strategy between attempts. Default `"exponential"`. */
  backoff?: RetryBackoff;
  /** Upper bound for a backoff wait in ms. Default 30000. */
  maxDelayMs?: number;
  /**
   * Largest multiplier applied at random to each backoff wait: a value of
   * `1.2` waits between 1x and 1.2x the delay. Default off (`1`).
   */
  jitter?: number;
  /**
   * Which failures are retried. An allow-list of {@link AIErrorCode}
   * strings or a predicate `(error, attempt) => boolean`. Default: the
   * transient set (`PROVIDER_RATE_LIMIT`, `PROVIDER_OVERLOADED`,
   * `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`). A cancelled call is never
   * retried. A response header `x-should-retry` (on the error's
   * `context.headers`) overrides the decision: `"true"` retries,
   * `"false"` does not.
   */
  retryOn?: AIErrorCode[] | ((error: unknown, attempt: number) => boolean);
  /**
   * Wait at least the provider's `retryAfter` (rate-limit errors), even
   * when the backoff is shorter. `true` honors it up to 15 minutes,
   * `{ maxMs }` up to that cap, `false` ignores it. Not limited by
   * `maxDelayMs`. Default true.
   */
  honorRetryAfter?: boolean | { maxMs: number };
  /**
   * Keep retrying network-unreachable failures (`ENOTFOUND`, `EAI_AGAIN`,
   * `ENETUNREACH`, `EHOSTUNREACH`, `ENETDOWN`; not `ECONNREFUSED`) on a
   * separate budget: they do not use `attempts`, wait at most
   * `maxDelayMs` between tries, and stop once `budgetMs` of waiting is
   * spent. Default `false`.
   */
  offline?: { budgetMs: number; maxDelayMs: number } | false;
  /** Stop retrying once this many timeout failures (`PROVIDER_TIMEOUT`) happened. Default unlimited. */
  maxTimeouts?: number;
  /** Called before each wait; a throwing hook is ignored. */
  onRetry?: (event: RetryEvent) => void;
};
