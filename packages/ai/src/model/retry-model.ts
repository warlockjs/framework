import type { Message } from "../contracts/conversation-message.type";
import type {
  ModelCallOptions,
  ModelContract,
  ModelResponse,
  ModelStreamChunk,
} from "../contracts/model.contract";
import type { RetryBudgetKind, RetryPolicy } from "../contracts/retry-policy.contract";
import { AIError } from "../errors/ai-error";
import type { AIErrorCode } from "../errors/error-code.type";
import { sleep } from "../workflow/cancellation";
import { isAbortError } from "../workflow/retry";

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_RETRY_AFTER_CAP_MS = 15 * 60_000;

const DEFAULT_RETRYABLE_CODES: readonly AIErrorCode[] = [
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_OVERLOADED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
];

/** Network-unreachable codes. `ECONNREFUSED` is deliberately absent: the host answered. */
const OFFLINE_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
]);

/** True when the error, or anything in its `cause` chain, carries an offline network code. */
function isOfflineError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const { code, cause, context } = current as {
      code?: unknown;
      cause?: unknown;
      context?: Record<string, unknown>;
    };

    if (typeof code === "string" && OFFLINE_CODES.has(code)) return true;

    const contextCode = context?.code;

    if (typeof contextCode === "string" && OFFLINE_CODES.has(contextCode)) return true;

    current = cause;
  }

  return false;
}

/** The `x-should-retry` response header on the error, when a provider sent one. */
function shouldRetryHeader(error: unknown): boolean | undefined {
  const raw = (error as { context?: { headers?: unknown } } | null)?.context?.headers;

  if (!raw || typeof raw !== "object") return undefined;

  const headers = raw as Record<string, unknown> & { get?: (name: string) => unknown };
  const value =
    typeof headers.get === "function" ? headers.get("x-should-retry") : headers["x-should-retry"];

  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;

  return undefined;
}

type RetryStep = { delayMs: number; budget: RetryBudgetKind };

/**
 * Wrap a model so a transient provider failure is retried on the same
 * model, with backoff, jitter, the provider's `retryAfter` and an optional
 * separate offline budget, before the error reaches the caller. Put the
 * retrying model first in a `fallbackModel` chain to retry and then fail
 * over.
 *
 * `stream()` retries only while no content chunk has been emitted; after
 * the first `delta` / `tool-call` the error propagates. Provider SDK
 * clients keep their own internal retries (`maxRetries`); set that to 0
 * on the adapter when this wrapper should be the only retry layer.
 *
 * @example
 * const model = retryModel(ai.openai.model({ name: "gpt-4o" }), {
 *   attempts: 10,
 *   baseMs: 2000,
 *   maxDelayMs: 10_000,
 *   jitter: 1.2,
 *   offline: { budgetMs: 3_600_000, maxDelayMs: 30_000 },
 *   onRetry: ({ attempt, delayMs, budget }) => log.warn(`${budget} retry ${attempt} in ${delayMs}ms`),
 * });
 */
export function retryModel(model: ModelContract, policy: RetryPolicy = {}): ModelContract {
  const totalAttempts = Math.max(1, Math.floor(policy.attempts ?? DEFAULT_ATTEMPTS));
  const base = policy.baseMs ?? DEFAULT_BASE_MS;
  const cap = policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitter = policy.jitter !== undefined && policy.jitter > 1 ? policy.jitter : 1;

  const retryAfterCap =
    policy.honorRetryAfter === false
      ? 0
      : typeof policy.honorRetryAfter === "object"
        ? policy.honorRetryAfter.maxMs
        : DEFAULT_RETRY_AFTER_CAP_MS;

  const backoffDelay = (attempt: number): number => {
    const { backoff } = policy;

    if (typeof backoff === "function") return backoff(attempt);
    if (backoff === "none") return 0;
    if (backoff === "linear") return base * attempt;

    return base * 2 ** (attempt - 1);
  };

  const matchesRetryOn = (error: unknown, attempt: number): boolean => {
    const { retryOn } = policy;

    if (typeof retryOn === "function") return retryOn(error, attempt) !== false;

    const codes = retryOn ?? DEFAULT_RETRYABLE_CODES;

    return error instanceof AIError && codes.includes(error.code);
  };

  /** Per-call counters; one instance per `complete()` / `stream()` call. */
  const createRun = () => {
    let calls = 1;
    let generalAttempts = 1;
    let offlineCount = 0;
    let offlineWaited = 0;
    let timeouts = 0;

    /** Decide whether `error` is retried; returns the wait, or undefined to rethrow. */
    return (error: unknown): (RetryStep & { attempt: number }) | undefined => {
      if (isAbortError(error) || (error instanceof AIError && error.category === "cancelled")) {
        return undefined;
      }

      const header = shouldRetryHeader(error);

      if (header === false) return undefined;

      if (policy.offline && isOfflineError(error)) {
        const gap = Math.min(base * 2 ** offlineCount, policy.offline.maxDelayMs);

        if (offlineWaited + gap > policy.offline.budgetMs) return undefined;

        offlineCount++;
        offlineWaited += gap;
        calls++;

        return { attempt: calls, delayMs: gap, budget: "offline" };
      }

      if (error instanceof AIError && error.code === "PROVIDER_TIMEOUT") {
        timeouts++;

        if (policy.maxTimeouts !== undefined && timeouts >= policy.maxTimeouts) return undefined;
      }

      if (generalAttempts >= totalAttempts) return undefined;
      if (header !== true && !matchesRetryOn(error, generalAttempts)) return undefined;

      let delay = Math.min(Math.max(0, backoffDelay(generalAttempts)), cap);

      if (jitter > 1) delay *= 1 + Math.random() * (jitter - 1);

      const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter;

      if (retryAfterCap > 0 && typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
        delay = Math.max(delay, Math.min(retryAfter, retryAfterCap));
      }

      generalAttempts++;
      calls++;

      return { attempt: calls, delayMs: Math.round(delay), budget: "general" };
    };
  };

  const wait = async (
    step: RetryStep & { attempt: number },
    error: unknown,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    try {
      policy.onRetry?.({
        attempt: step.attempt,
        delayMs: step.delayMs,
        cause: error,
        budget: step.budget,
      });
    } catch {
      // A failing hook never changes the retry decision.
    }

    if (step.delayMs > 0) await sleep(step.delayMs, signal);
  };

  const wrapper: ModelContract = {
    name: model.name,
    provider: model.provider,
    capabilities: model.capabilities,
    pricing: model.pricing,

    async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
      const decide = createRun();

      for (;;) {
        try {
          return await model.complete(messages, options);
        } catch (error) {
          const step = decide(error);

          if (!step) throw error;

          await wait(step, error, options?.signal);
        }
      }
    },

    async *stream(
      messages: Message[],
      options?: ModelCallOptions,
    ): AsyncIterable<ModelStreamChunk> {
      const decide = createRun();

      for (;;) {
        let emitted = false;

        try {
          for await (const chunk of model.stream(messages, options)) {
            if (chunk.type !== "usage") emitted = true;

            yield chunk;
          }

          return;
        } catch (error) {
          const step = emitted ? undefined : decide(error);

          if (!step) throw error;

          await wait(step, error, options?.signal);
        }
      }
    },
  };

  if (model.countTokens) {
    wrapper.countTokens = (messages, options) => model.countTokens!(messages, options);
  }

  return wrapper;
}
