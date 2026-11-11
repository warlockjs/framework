import { randomUUID } from "node:crypto";
import { log } from "@warlock.js/logger";
import { AIError } from "../errors/ai-error";
import type { ErrorCategory } from "../errors/error-category.type";

/** What a client sees for a failed run: a stable code, a fixed message, a reference. */
export type ServePublicError = {
  /** The `AIError` code (`"PROVIDER_TIMEOUT"`, …), or `"INTERNAL_ERROR"` for anything else. */
  code: string;
  /** A fixed message for the error's category; never the raw error text. */
  message: string;
  /** Short id logged on the server with the full error; quote it to support. */
  reference: string;
};

const LOG_MODULE = "ai.serve";

const DEFAULT_MESSAGE =
  "The assistant could not complete the request. Try again, and quote the reference if it keeps failing.";

/**
 * Fixed client-facing message per error category. Raw messages can carry
 * provider responses, internal hosts or tool output, so they stay in the
 * server log under the reference id.
 */
const CATEGORY_MESSAGES: Partial<Record<ErrorCategory, string>> = {
  auth: "The AI service is not available right now. Contact support and quote the reference.",
  "rate-limit": "The AI service is busy. Wait a moment and try again.",
  quota: "The AI service is not available right now. Contact support and quote the reference.",
  timeout: "The AI service took too long to answer. Try again.",
  provider: "The AI service failed to answer. Try again in a moment.",
  "content-filter":
    "The answer was blocked by the content filter. Rephrase the request and try again.",
  guardrail:
    "The request or its answer was blocked by a content policy. Rephrase the request and try again.",
  validation: "The request could not be processed. Check the message and try again.",
  schema: "The assistant returned an answer in an unexpected format. Try again.",
  cancelled: "The request was cancelled.",
  budget: "The usage limit for this conversation was reached. Try again later.",
  "context-length": "The conversation is too long. Start a new conversation and try again.",
  "max-trips": "The assistant could not finish this request. Try a simpler request.",
  "max-iterations": "The assistant could not finish this request. Try a simpler request.",
  "max-steps": "The assistant could not finish this request. Try a simpler request.",
  incomplete: "The assistant could not finish this request. Try again.",
};

/**
 * Build the error describer for one served request. Each distinct error
 * object gets one reference id and one server log line (with the full
 * error), however many frames mention it.
 */
export function createPublicErrorDescriber(): (error: unknown) => ServePublicError {
  const seen = new WeakMap<object, ServePublicError>();

  return (error: unknown): ServePublicError => {
    const known = typeof error === "object" && error !== null ? seen.get(error) : undefined;

    if (known) {
      return known;
    }

    const reference = randomUUID().slice(0, 8);
    const described: ServePublicError =
      error instanceof AIError
        ? {
            code: error.code,
            message: CATEGORY_MESSAGES[error.category] ?? DEFAULT_MESSAGE,
            reference,
          }
        : { code: "INTERNAL_ERROR", message: DEFAULT_MESSAGE, reference };

    if (typeof error === "object" && error !== null) {
      seen.set(error, described);
    }

    log.error(LOG_MODULE, "run.failed", error instanceof Error ? error : String(error), {
      reference,
      code: described.code,
    });

    return described;
  };
}
