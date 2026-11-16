import type { AIErrorCode } from "../errors/error-code.type";
import type { ModelContract } from "./model.contract";

/**
 * Predicate deciding whether a thrown error should advance the fallback
 * chain to the next model. Receives the original error verbatim (an
 * `AIError` subclass when the failure came from a provider adapter, or
 * any thrown value otherwise) and returns `true` to fall over, `false`
 * to re-throw immediately.
 *
 * @example
 * fallbackModel([primary, backup], {
 *   retryOn: (error) => error instanceof ProviderError,
 * });
 */
export type FallbackRetryPredicate = (error: unknown) => boolean;

/**
 * Tuning knobs for {@link fallbackModel}. `retryOn` REPLACES the built-in
 * transient-failure default (rate-limit, overloaded, timeout, and generic
 * provider errors); `alsoRetryOn` ADDS to whichever base applies. Omit
 * both to use the default unchanged.
 */
export type FallbackModelOptions = {
  /**
   * Which failures advance the chain. Either an explicit allow-list of
   * stable {@link AIErrorCode} strings, or a predicate for arbitrary
   * branching. Absent = the built-in transient set
   * (`PROVIDER_RATE_LIMIT`, `PROVIDER_OVERLOADED`, `PROVIDER_TIMEOUT`,
   * `PROVIDER_ERROR`).
   *
   * Either form REPLACES the default: a predicate that returns `false`
   * for a rate limit stops failing over on rate limits. To keep the
   * default and add a reason, use `alsoRetryOn`, or call the exported
   * `isDefaultFallbackRetryable(error)` inside your predicate.
   *
   * Non-transient failures (auth, invalid-request, context-length,
   * content-filter) are NEVER retried by default — falling over on a
   * bad API key or an oversized prompt only burns the budget on every
   * downstream model, since the same input fails identically.
   *
   * A caller's own cancellation (an aborted `signal`, an abort error, or
   * a `cancelled` error) never advances the chain, whatever `retryOn`
   * says.
   */
  retryOn?: AIErrorCode[] | FallbackRetryPredicate;
  /**
   * Extra failures that also advance the chain, on top of `retryOn` (or
   * the default when `retryOn` is absent). Same two forms as `retryOn`.
   */
  alsoRetryOn?: AIErrorCode[] | FallbackRetryPredicate;
};

/**
 * Diagnostic record of one model that the fallback chain tried and that
 * failed with a chain-advancing error. Exposed on the wrapper's
 * `lastAttempts` getter so callers can see exactly which providers were
 * burned before the chain produced a response (or re-threw the final
 * error).
 */
export type FallbackAttempt = {
  /** Model identifier that failed (`ModelContract.name`). */
  modelName: string;
  /** Provider the failed model belonged to (`ModelContract.provider`). */
  provider: string;
  /** The error that triggered the fall-over to the next model. */
  error: unknown;
};

/**
 * The `ModelContract` returned by `fallbackModel()`: a fully usable
 * model that additionally exposes which wrapped models failed (and why)
 * during the most recent call.
 */
export interface FallbackModelContract extends ModelContract {
  /**
   * Models that failed with a chain-advancing error during the most
   * recent `complete()` / `stream()` call, in attempt order. Empty when
   * the primary model succeeded outright. Overwritten on each call.
   */
  readonly lastAttempts: FallbackAttempt[];
}
