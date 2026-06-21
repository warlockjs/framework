import {
  AIError,
  ContextLengthExceededError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "@warlock.js/ai";

/**
 * Raw-error fields the wrapper reads off an Ollama client error. The
 * `ollama` client throws a `ResponseError` (`name: "ResponseError"`,
 * numeric `status_code`, message = the server's `error` text) for HTTP
 * faults; transport failures surface as a `fetch`-layer `TypeError`
 * with an `ECONNREFUSED` / `ETIMEDOUT` cause. We duck-type both —
 * `ResponseError` is internal to the package and not exported.
 */
type OllamaErrorShape = {
  name?: string;
  message?: string;
  statusCode?: number;
  code?: string;
};

/**
 * Wrap any thrown value caught inside the Ollama adapter into the
 * appropriate `@warlock.js/ai` `AIError` subclass.
 *
 * **Dispatch strategy.** HTTP faults carry `status_code`; the local
 * daemon being down surfaces as a connection error (`ECONNREFUSED` /
 * "fetch failed") — mapped to `ProviderError` since it's an
 * operational "is Ollama running?" condition, not a request defect.
 * `400` with context-length phrasing maps to
 * `ContextLengthExceededError`.
 *
 * `AIError` instances pass through unchanged so `catch/throw wrap(e)`
 * pipelines never double-wrap.
 *
 * @example
 * try {
 *   return await this.client.chat({ ... });
 * } catch (thrown) {
 *   throw wrapOllamaError(thrown);
 * }
 */
export function wrapOllamaError(thrown: unknown): AIError {
  if (thrown instanceof AIError) {
    return thrown;
  }

  const shape = toShape(thrown);
  const context = buildContext(shape);
  const message = shape.message ?? (thrown instanceof Error ? thrown.message : String(thrown));

  if (isTimeout(shape)) {
    return new ProviderTimeoutError(message, { cause: thrown, context });
  }

  if (isConnectionRefused(shape, message)) {
    return new ProviderError(message, { cause: thrown, context });
  }

  if (shape.statusCode === 401 || shape.statusCode === 403) {
    return new ProviderAuthError(message, { cause: thrown, context });
  }

  if (shape.statusCode === 429) {
    return new ProviderRateLimitError(message, { cause: thrown, context });
  }

  if (isClientStatus(shape.statusCode)) {
    if (/context length|too long|exceeds|maximum context/i.test(message)) {
      return new ContextLengthExceededError(message, { cause: thrown, context });
    }

    return new InvalidRequestError(message, { cause: thrown, context });
  }

  return new ProviderError(message, { cause: thrown, context });
}

/**
 * Read the raw error shape. `ResponseError` exposes `status_code`;
 * fetch-layer errors carry a `cause` whose `code` is the OS-level
 * socket error.
 */
function toShape(thrown: unknown): OllamaErrorShape {
  if (typeof thrown !== "object" || thrown === null) {
    return {};
  }

  const raw = thrown as Record<string, unknown>;
  const cause = raw.cause as Record<string, unknown> | undefined;

  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    statusCode: typeof raw.status_code === "number" ? raw.status_code : undefined,
    code:
      typeof raw.code === "string"
        ? raw.code
        : cause && typeof cause.code === "string"
          ? cause.code
          : undefined,
  };
}

/** Transport-level timeout signals. */
function isTimeout(shape: OllamaErrorShape): boolean {
  if (shape.name === "AbortError" || shape.name === "TimeoutError") {
    return true;
  }

  return shape.code === "ETIMEDOUT" || shape.code === "ECONNABORTED";
}

/**
 * The Ollama daemon not being reachable (most common local failure):
 * connection refused at the socket layer, or the `fetch failed`
 * TypeError the client surfaces when the host is down.
 */
function isConnectionRefused(shape: OllamaErrorShape, message: string): boolean {
  return shape.code === "ECONNREFUSED" || /fetch failed|econnrefused/i.test(message);
}

/** True for HTTP 4xx — a client-side request problem, not a server fault. */
function isClientStatus(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Attach the diagnostic fields to `error.context`. */
function buildContext(shape: OllamaErrorShape): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (shape.statusCode !== undefined) {
    context.status = shape.statusCode;
  }

  if (shape.code) {
    context.code = shape.code;
  }

  return context;
}
