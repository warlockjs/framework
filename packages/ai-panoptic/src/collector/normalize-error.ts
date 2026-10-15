import { redact, scrubSecrets } from "@warlock.js/ai";
import type { TraceSpanError } from "../contracts/trace.type";

/**
 * Project a captured execution error onto the structural
 * {@link TraceSpanError} shape used on a failed / cancelled span.
 *
 * Source errors are typically `AIError` instances (every error surfaced
 * by `@warlock.js/ai` is one), but the collector never depends on the
 * concrete class — it reads only the structural surface (`name` / `code`
 * / `message` / `stack`) so a plain `Error`, an `AIError`, or any
 * thrown value all normalize identically. The result is a JSON-safe
 * plain object so it survives serialization to a backend collector
 * unchanged.
 *
 * The error `type` prefers the stable `code` (e.g. `"RATE_LIMIT"`) over
 * the class `name`, falling back to `name` and finally to the generic
 * `"Error"` so the field is always populated.
 *
 * @example
 * const spanError = normalizeError(report.error);
 * // { type: "RATE_LIMIT", message: "429 Too Many Requests", stack: "..." }
 */
export function normalizeError(error: unknown): TraceSpanError | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }

  if (typeof error !== "object") {
    return {
      type: "Error",
      message: scrubSecrets(String(error)),
    };
  }

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: unknown;
  };

  const type = pickString(candidate.code) ?? pickString(candidate.name) ?? "Error";
  const message = pickString(candidate.message) ?? "";
  const stack = pickString(candidate.stack);

  // Scrub free-text secrets (Bearer tokens, api keys) from the message and
  // stack, and deep-redact the cause (a raw provider SDK error can carry
  // auth/cookie headers) before either is stored or exported (S4).
  const normalized: TraceSpanError = {
    type,
    message: scrubSecrets(message),
  };

  if (stack !== undefined) {
    normalized.stack = scrubSecrets(stack);
  }

  if (candidate.cause !== undefined && candidate.cause !== null) {
    normalized.cause =
      typeof candidate.cause === "object"
        ? redact(candidate.cause)
        : scrubSecrets(String(candidate.cause));
  }

  return normalized;
}

/**
 * Return the value when it is a non-empty string, otherwise `undefined`.
 * Keeps `normalizeError` from promoting empty / non-string fields.
 */
function pickString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}
