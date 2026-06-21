import {
  AIError,
  ContextLengthExceededError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  QuotaExceededError,
} from "@warlock.js/ai";

/**
 * Raw-error fields the wrapper reads off an AWS SDK exception. Every
 * Bedrock error is a Smithy `__BaseException` with a stable `name`
 * (`"ThrottlingException"`, `"ValidationException"`, …) and a
 * `$metadata` carrying `httpStatusCode` + `requestId`. We duck-type
 * because retries and proxies sometimes flatten the prototype chain.
 */
type BedrockErrorShape = {
  name?: string;
  message?: string;
  httpStatusCode?: number;
  requestId?: string;
  code?: string;
};

const TIMEOUT_NAMES = new Set([
  "ModelTimeoutException",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
]);

/**
 * Wrap any thrown value caught inside the Bedrock adapter into the
 * appropriate `@warlock.js/ai` `AIError` subclass.
 *
 * **Dispatch strategy.** AWS errors carry no provider machine `code`;
 * the stable identifier is the Smithy exception `name`. Dispatch keys
 * on `name`, falls back to `$metadata.httpStatusCode` when the name is
 * missing (flattened/proxied errors). `ValidationException` is split:
 * the "input is too long / exceeds context window" phrasing maps to
 * `ContextLengthExceededError`, everything else to
 * `InvalidRequestError`.
 *
 * `AIError` instances pass through unchanged so `catch/throw wrap(e)`
 * pipelines never double-wrap.
 *
 * @example
 * try {
 *   return await this.client.send(new ConverseCommand(...));
 * } catch (thrown) {
 *   throw wrapBedrockError(thrown);
 * }
 */
export function wrapBedrockError(thrown: unknown): AIError {
  if (thrown instanceof AIError) {
    return thrown;
  }

  const shape = toShape(thrown);
  const context = buildContext(shape);
  const message = shape.message ?? (thrown instanceof Error ? thrown.message : String(thrown));

  if (isTimeout(shape)) {
    return new ProviderTimeoutError(message, { cause: thrown, context });
  }

  if (shape.name === "AccessDeniedException" || shape.httpStatusCode === 403) {
    return new ProviderAuthError(message, { cause: thrown, context });
  }

  if (shape.httpStatusCode === 401) {
    return new ProviderAuthError(message, { cause: thrown, context });
  }

  if (shape.name === "ServiceQuotaExceededException") {
    return new QuotaExceededError(message, { cause: thrown, context });
  }

  if (shape.name === "ThrottlingException" || shape.httpStatusCode === 429) {
    return new ProviderRateLimitError(message, { cause: thrown, context });
  }

  if (shape.name === "ValidationException") {
    if (/too long|context window|maximum context|exceeds the maximum/i.test(message)) {
      return new ContextLengthExceededError(message, { cause: thrown, context });
    }

    return new InvalidRequestError(message, { cause: thrown, context });
  }

  if (
    shape.name === "ResourceNotFoundException" ||
    shape.name === "ConflictException" ||
    isClientStatus(shape.httpStatusCode)
  ) {
    return new InvalidRequestError(message, { cause: thrown, context });
  }

  return new ProviderError(message, { cause: thrown, context });
}

/**
 * Read the raw error shape without depending on `instanceof`. AWS
 * exceptions expose `$metadata`; plain/proxied errors may carry
 * `status` / `code` instead.
 */
function toShape(thrown: unknown): BedrockErrorShape {
  if (typeof thrown !== "object" || thrown === null) {
    return {};
  }

  const raw = thrown as Record<string, unknown>;
  const metadata = raw.$metadata as { httpStatusCode?: number; requestId?: string } | undefined;

  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    httpStatusCode:
      metadata && typeof metadata.httpStatusCode === "number"
        ? metadata.httpStatusCode
        : typeof raw.status === "number"
          ? (raw.status as number)
          : undefined,
    requestId: metadata && typeof metadata.requestId === "string" ? metadata.requestId : undefined,
    code: typeof raw.code === "string" ? raw.code : undefined,
  };
}

/**
 * Decide whether the error is a timeout. Bedrock surfaces
 * `ModelTimeoutException`; the AWS transport layer surfaces
 * `TimeoutError` / `ETIMEDOUT` / `ECONNABORTED`.
 */
function isTimeout(shape: BedrockErrorShape): boolean {
  if (shape.name && TIMEOUT_NAMES.has(shape.name)) {
    return true;
  }

  return shape.code === "ETIMEDOUT" || shape.code === "ECONNABORTED";
}

/** True for HTTP 4xx — a client-side request problem, not a server fault. */
function isClientStatus(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Attach the raw diagnostic fields to `error.context`. The Smithy
 * exception `name` is the closest thing Bedrock has to a stable error
 * code, so it lands on `context.code`.
 */
function buildContext(shape: BedrockErrorShape): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (shape.httpStatusCode !== undefined) {
    context.status = shape.httpStatusCode;
  }

  if (shape.name) {
    context.code = shape.name;
  }

  if (shape.requestId) {
    context.requestId = shape.requestId;
  }

  return context;
}
