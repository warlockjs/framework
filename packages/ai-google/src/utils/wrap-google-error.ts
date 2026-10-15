import {
  AIError,
  ContextLengthExceededError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "@warlock.js/ai";
import { ApiError } from "@google/genai";

/**
 * Raw-error fields the wrapper reads off a Gemini SDK error.
 * `@google/genai`'s `ApiError` exposes `status` (HTTP code) +
 * `message`; transport aborts surface as `AbortError` / `ETIMEDOUT`.
 * We duck-type so proxied / re-thrown errors still classify.
 */
type GoogleErrorShape = {
  status?: number;
  message?: string;
  name?: string;
  code?: string;
};

/**
 * Wrap any thrown value caught inside the Gemini adapter into the
 * appropriate `@warlock.js/ai` `AIError` subclass.
 *
 * **Dispatch strategy.** Gemini has no machine error `code`; the
 * signals are the HTTP `status` and the canonical status phrase Google
 * embeds in `message` (`PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`,
 * `INVALID_ARGUMENT`, …). Dispatch keys on `status`, using the message
 * phrase as the tie-breaker for the two 400 sub-cases
 * (context-length vs generic) and for status-less auth/quota errors.
 *
 * `AIError` instances pass through unchanged so `catch/throw wrap(e)`
 * pipelines never double-wrap.
 *
 * @example
 * try {
 *   return await this.ai.models.generateContent(...);
 * } catch (thrown) {
 *   throw wrapGoogleError(thrown);
 * }
 */
export function wrapGoogleError(thrown: unknown): AIError {
  if (thrown instanceof AIError) {
    return thrown;
  }

  const shape = toShape(thrown);
  const context = buildContext(shape);
  const message = shape.message ?? (thrown instanceof Error ? thrown.message : String(thrown));

  if (isTimeout(shape)) {
    return new ProviderTimeoutError(message, { cause: thrown, context });
  }

  if (
    shape.status === 401 ||
    shape.status === 403 ||
    /permission_denied|api key not valid|unauthenticated/i.test(message)
  ) {
    return new ProviderAuthError(message, { cause: thrown, context });
  }

  if (shape.status === 429 || /resource_exhausted|quota/i.test(message)) {
    return new ProviderRateLimitError(message, { cause: thrown, context });
  }

  if (shape.status === 400) {
    if (/token count|context length|exceeds the maximum|input is too long/i.test(message)) {
      return new ContextLengthExceededError(message, { cause: thrown, context });
    }

    return new InvalidRequestError(message, { cause: thrown, context });
  }

  if (shape.status === 404 || isClientStatus(shape.status)) {
    return new InvalidRequestError(message, { cause: thrown, context });
  }

  return new ProviderError(message, { cause: thrown, context });
}

/**
 * Read the raw error shape. The Gemini SDK's `ApiError` carries a
 * numeric `status`; flattened/proxied errors may carry it (or `code`)
 * loosely.
 */
function toShape(thrown: unknown): GoogleErrorShape {
  if (thrown instanceof ApiError) {
    return { status: thrown.status, message: thrown.message, name: thrown.name };
  }

  if (typeof thrown === "object" && thrown !== null) {
    const raw = thrown as Record<string, unknown>;

    return {
      status: typeof raw.status === "number" ? raw.status : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
      code: typeof raw.code === "string" ? raw.code : undefined,
    };
  }

  return {};
}

/**
 * Decide whether the error is a timeout. Gemini maps gateway timeouts
 * to HTTP 504 (`DEADLINE_EXCEEDED`); transport aborts surface as
 * `AbortError` / `ETIMEDOUT` / `ECONNABORTED`.
 */
function isTimeout(shape: GoogleErrorShape): boolean {
  if (shape.status === 504) {
    return true;
  }

  if (shape.name === "AbortError" || /deadline_exceeded/i.test(shape.message ?? "")) {
    return true;
  }

  return shape.code === "ETIMEDOUT" || shape.code === "ECONNABORTED";
}

/** True for HTTP 4xx — a client-side request problem, not a server fault. */
function isClientStatus(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Attach the diagnostic fields to `error.context`. */
function buildContext(shape: GoogleErrorShape): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (shape.status !== undefined) {
    context.status = shape.status;
  }

  if (shape.name) {
    context.code = shape.name;
  }

  return context;
}
