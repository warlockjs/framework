import type { ErrorCategory } from "./error-category.type";
import { ProviderError, type ProviderErrorOptions } from "./provider-error";

/**
 * Payload for `ProviderOverloadedError`. `retryAfter` is the server's
 * hint in milliseconds, when it sent one.
 */
export type ProviderOverloadedErrorOptions = ProviderErrorOptions & {
  retryAfter?: number;
};

/**
 * The provider is temporarily overloaded and refused the call — not a
 * problem with the account or the request. Anthropic signals it with HTTP
 * 529 / `overloaded_error` (also as a mid-stream `error` event); other
 * adapters map their own "service overloaded" signals here. Always
 * `retryable`: back off and retry, or fall back to another model.
 *
 * `billed` is `"unknown"`: no provider documents whether an overloaded
 * call is charged.
 *
 * @example
 * if (result.error?.code === "PROVIDER_OVERLOADED") {
 *   await sleep(result.error.retryAfter ?? 2_000);
 * }
 */
export class ProviderOverloadedError extends ProviderError {
  public static readonly defaultCategory: ErrorCategory = "provider";
  public static readonly defaultRetryable: boolean | undefined = true;

  public readonly retryAfter?: number;

  public constructor(message: string, options?: ProviderOverloadedErrorOptions) {
    super(message, options, "PROVIDER_OVERLOADED");
    this.name = "ProviderOverloadedError";
    this.retryAfter = options?.retryAfter;
  }
}
