import type { ErrorCategory } from "./error-category.type";
import { ProviderError, type ProviderErrorOptions } from "./provider-error";

/**
 * The caller aborted the provider call through its own `AbortSignal`.
 *
 * Adapters raise it when the provider SDK reports a user abort, so the
 * failure is a cancellation, not a provider fault: its category is
 * `"cancelled"`, its `name` is `"AbortError"` (what `retryModel` and
 * `fallbackModel` check), it is never retryable and a fallback chain does
 * not advance on it.
 *
 * @example
 * if (result.error instanceof ProviderAbortError) {
 *   return { status: "stopped" };
 * }
 */
export class ProviderAbortError extends ProviderError {
  public static readonly defaultCategory: ErrorCategory = "cancelled";
  public static readonly defaultRetryable: boolean | undefined = false;

  public constructor(message: string, options?: ProviderErrorOptions) {
    super(message, options);
    this.name = "AbortError";
  }
}
