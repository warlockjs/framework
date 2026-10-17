import { AIError, type AIErrorOptions } from "./ai-error";
import type { ErrorCategory } from "./error-category.type";
import type { AIErrorCode } from "./error-code.type";

/**
 * Any failure that originated from the model provider (OpenAI, Azure,
 * OpenRouter, local gateway). Base class for the provider subclasses
 * below — raw provider errors caught in an adapter are always wrapped
 * into *some* `ProviderError` so downstream code can branch on
 * `instanceof ProviderError` when any provider-side failure will do.
 *
 * **Subclasses (more specific first).**
 * - `ProviderRateLimitError` — 429 / rate-limit / quota exhaustion.
 * - `ProviderOverloadedError` — the provider is temporarily overloaded
 *   (Anthropic 529 `overloaded_error`); retryable.
 * - `ProviderTimeoutError` — connection or request timeout.
 * - `ContextLengthExceededError` — prompt exceeded the model window.
 * - `ContentFilterError` — response blocked by provider safety policy.
 * - `ProviderAuthError` — bad / expired API key.
 * - `InvalidRequestError` — catch-all 4xx not covered above.
 *
 * When no subclass fits (e.g. 5xx server error, unknown network
 * failure), adapters throw plain `ProviderError` with the raw payload
 * captured in `context`.
 *
 * @example
 * if (result.error instanceof ProviderError) {
 *   if (result.error instanceof ProviderRateLimitError) {
 *     return retryAfter(result.error.retryAfter ?? 1000);
 *   }
 * }
 */
export class ProviderError extends AIError {
  public static readonly defaultCategory: ErrorCategory = "provider";

  /**
   * Class-level default for {@link ProviderError.retryable}. `undefined`
   * (the base class) derives it from the HTTP status instead.
   */
  public static readonly defaultRetryable: boolean | undefined = undefined;

  /**
   * HTTP status of the failed provider response, when there was one.
   * Read from `options.status`, else from a numeric `context.status`
   * (every first-party adapter records it there). `undefined` for
   * transport failures and errors raised mid-stream.
   */
  public readonly status?: number;

  /**
   * Whether the failed call cost money — see {@link ProviderBilled}.
   * Adapters set it where their provider documents the fact; otherwise
   * it is derived from `status`: 401 / 402 / 403 (unauthenticated,
   * unfunded, forbidden) are `false`, everything else is `"unknown"`.
   */
  public readonly billed: ProviderBilled;

  /**
   * Whether retrying the same request may succeed. Rate limits, timeouts,
   * overloads and 5xx / 408 / 409 responses are retryable; auth, quota,
   * invalid-request, context-length and content-filter failures are not.
   */
  public readonly retryable: boolean;

  public constructor(
    message: string,
    options?: ProviderErrorOptions,
    code: AIErrorCode = "PROVIDER_ERROR",
  ) {
    super(code, message, options);
    this.name = "ProviderError";
    this.status = options?.status ?? readContextStatus(options?.context);
    this.billed = options?.billed ?? billedFromStatus(this.status);
    this.retryable =
      options?.retryable ??
      (this.constructor as typeof ProviderError).defaultRetryable ??
      retryableFromStatus(this.status);
  }
}

/**
 * Whether a failed provider call was billed.
 *
 * - `false` — nothing was charged. Always the case for 401 / 402 / 403
 *   (the request was never authenticated, funded or authorized), and for
 *   the statuses a provider documents as free (Google Gemini: 400 and
 *   500).
 * - `true` — the adapter knows tokens were charged.
 * - `"unknown"` — the call may have been charged. Most providers publish
 *   no rule for failed requests (rate limits, overloads, 5xx, timeouts,
 *   errors raised after streaming began), so this fails closed: treat it
 *   as possibly billed when you settle a budget.
 */
export type ProviderBilled = boolean | "unknown";

/**
 * Constructor payload for {@link ProviderError} and its subclasses: the
 * shared `AIErrorOptions` plus the provider facts adapters know.
 */
export type ProviderErrorOptions = AIErrorOptions & {
  /** HTTP status of the failed response. Defaults to a numeric `context.status`. */
  status?: number;
  /** Billing fact; defaults to the status-derived value. */
  billed?: ProviderBilled;
  /** Override the class / status-derived retryability. */
  retryable?: boolean;
};

/** Statuses whose request never reached a billable account. */
const UNBILLED_STATUSES: ReadonlySet<number> = new Set([401, 402, 403]);

function readContextStatus(context: Record<string, unknown> | undefined): number | undefined {
  const status = context?.status;

  return typeof status === "number" ? status : undefined;
}

function billedFromStatus(status: number | undefined): ProviderBilled {
  if (status === undefined) {
    return "unknown";
  }

  return UNBILLED_STATUSES.has(status) ? false : "unknown";
}

function retryableFromStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return false;
  }

  return status >= 500 || status === 408 || status === 409 || status === 429;
}
