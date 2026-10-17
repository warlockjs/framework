import type { ErrorCategory } from "./error-category.type";
import { ProviderError, type ProviderErrorOptions } from "./provider-error";

/**
 * Provider rejected the credential — missing / invalid / expired API
 * key or insufficient permissions on the underlying account. Not
 * retryable; fix the credential and retry.
 *
 * @example
 * if (result.error instanceof ProviderAuthError) {
 *   notifyOps("rotate API key", result.error.context);
 * }
 */
export class ProviderAuthError extends ProviderError {
  public static readonly defaultCategory: ErrorCategory = "auth";
  public static readonly defaultRetryable: boolean | undefined = false;

  public constructor(message: string, options?: ProviderErrorOptions) {
    super(message, options, "PROVIDER_AUTH");
    this.name = "ProviderAuthError";
  }
}
