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
import { describe, expect, it } from "vitest";
import { wrapBedrockError } from "./wrap-bedrock-error";

/** Duck-typed AWS Smithy exception: a `name` + `$metadata`. */
function awsError(shape: {
  name?: string;
  message?: string;
  httpStatusCode?: number;
  requestId?: string;
  code?: string;
}): unknown {
  return {
    name: shape.name ?? "BedrockRuntimeServiceException",
    message: shape.message ?? "failed",
    code: shape.code,
    $metadata: { httpStatusCode: shape.httpStatusCode, requestId: shape.requestId },
  };
}

describe("wrapBedrockError", () => {
  it("passes AIError through untouched", () => {
    const original = new ProviderRateLimitError("slow");

    expect(wrapBedrockError(original)).toBe(original);
  });

  it("maps AccessDeniedException / 401 / 403 to ProviderAuthError", () => {
    expect(wrapBedrockError(awsError({ name: "AccessDeniedException", httpStatusCode: 403 }))).toBeInstanceOf(
      ProviderAuthError,
    );
    expect(wrapBedrockError(awsError({ name: "X", httpStatusCode: 401 }))).toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("maps ServiceQuotaExceededException to QuotaExceededError", () => {
    expect(
      wrapBedrockError(awsError({ name: "ServiceQuotaExceededException", httpStatusCode: 400 })),
    ).toBeInstanceOf(QuotaExceededError);
  });

  it("maps ThrottlingException / 429 to ProviderRateLimitError", () => {
    expect(
      wrapBedrockError(awsError({ name: "ThrottlingException", httpStatusCode: 429 })),
    ).toBeInstanceOf(ProviderRateLimitError);
    expect(wrapBedrockError(awsError({ name: "Other", httpStatusCode: 429 }))).toBeInstanceOf(
      ProviderRateLimitError,
    );
  });

  it("splits ValidationException: context-overflow vs generic", () => {
    expect(
      wrapBedrockError(
        awsError({
          name: "ValidationException",
          httpStatusCode: 400,
          message: "input is too long for requested model",
        }),
      ),
    ).toBeInstanceOf(ContextLengthExceededError);

    expect(
      wrapBedrockError(
        awsError({ name: "ValidationException", httpStatusCode: 400, message: "bad param" }),
      ),
    ).toBeInstanceOf(InvalidRequestError);
  });

  it("maps ResourceNotFound / Conflict / generic 4xx to InvalidRequestError", () => {
    expect(
      wrapBedrockError(awsError({ name: "ResourceNotFoundException", httpStatusCode: 404 })),
    ).toBeInstanceOf(InvalidRequestError);
    expect(wrapBedrockError(awsError({ name: "ConflictException", httpStatusCode: 409 }))).toBeInstanceOf(
      InvalidRequestError,
    );
    expect(wrapBedrockError(awsError({ name: "Weird", httpStatusCode: 422 }))).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("maps ModelTimeoutException / ETIMEDOUT to ProviderTimeoutError", () => {
    expect(wrapBedrockError(awsError({ name: "ModelTimeoutException" }))).toBeInstanceOf(
      ProviderTimeoutError,
    );
    expect(wrapBedrockError({ name: "X", code: "ETIMEDOUT", message: "socket" })).toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("maps every transport timeout name and ECONNABORTED to ProviderTimeoutError", () => {
    for (const name of ["TimeoutError", "RequestTimeout", "RequestTimeoutException"]) {
      expect(wrapBedrockError(awsError({ name }))).toBeInstanceOf(ProviderTimeoutError);
    }

    expect(
      wrapBedrockError({ name: "X", code: "ECONNABORTED", message: "aborted" }),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("treats a timeout name as a timeout even when an HTTP status is present", () => {
    // name-based timeout dispatch runs before the status-based 4xx branch.
    expect(
      wrapBedrockError(awsError({ name: "ModelTimeoutException", httpStatusCode: 408 })),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("maps a bare 403 with no recognized name to ProviderAuthError", () => {
    expect(wrapBedrockError(awsError({ name: "SomethingElse", httpStatusCode: 403 }))).toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("prioritizes ServiceQuotaExceededException over its 4xx status", () => {
    // Quota dispatch is keyed on the name and runs before the generic 4xx
    // → InvalidRequestError fallback, so the status never demotes it.
    const wrapped = wrapBedrockError(
      awsError({ name: "ServiceQuotaExceededException", httpStatusCode: 402 }),
    );

    expect(wrapped).toBeInstanceOf(QuotaExceededError);
    expect(wrapped.code).toBe("PROVIDER_QUOTA_EXCEEDED");
  });

  it("reads httpStatusCode from a flattened `status` field (no $metadata)", () => {
    // Proxies / retries sometimes drop $metadata and leave a bare status.
    const wrapped = wrapBedrockError({ name: "Whatever", status: 429, message: "slow" });

    expect(wrapped).toBeInstanceOf(ProviderRateLimitError);
    expect(wrapped.context).toMatchObject({ status: 429 });
  });

  it("falls back to ProviderError for an unknown name with no status", () => {
    const wrapped = wrapBedrockError(awsError({ name: "MysteryException" }));

    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped.code).toBe("PROVIDER_ERROR");
  });

  it("falls back to ProviderError for a totally shapeless object", () => {
    const wrapped = wrapBedrockError({});

    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped.message).toBe("[object Object]");
    expect(wrapped.context).toEqual({});
  });

  it("matches the context-overflow phrasings case-insensitively", () => {
    for (const phrase of [
      "Input is TOO LONG",
      "exceeds the context window",
      "maximum context reached",
      "exceeds the maximum number of tokens",
    ]) {
      expect(
        wrapBedrockError(awsError({ name: "ValidationException", message: phrase })),
      ).toBeInstanceOf(ContextLengthExceededError);
    }
  });

  it("maps server-side faults (5xx, ModelError, ServiceUnavailable) to ProviderError", () => {
    expect(wrapBedrockError(awsError({ name: "InternalServerException", httpStatusCode: 500 }))).toBeInstanceOf(
      ProviderError,
    );
    expect(
      wrapBedrockError(awsError({ name: "ServiceUnavailableException", httpStatusCode: 503 })),
    ).toBeInstanceOf(ProviderError);
    expect(wrapBedrockError(awsError({ name: "ModelErrorException", httpStatusCode: 424 }))).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("preserves cause and attaches status / name / requestId to context", () => {
    const raw = awsError({
      name: "ThrottlingException",
      httpStatusCode: 429,
      requestId: "req_9",
    });

    const wrapped = wrapBedrockError(raw);

    expect((wrapped as unknown as { cause: unknown }).cause).toBe(raw);
    expect(wrapped.context).toMatchObject({
      status: 429,
      code: "ThrottlingException",
      requestId: "req_9",
    });
  });

  it("wraps non-object, string, and plain Error values into ProviderError", () => {
    expect(wrapBedrockError("boom").message).toBe("boom");
    expect(wrapBedrockError(7).message).toBe("7");
    expect(wrapBedrockError(new Error("plain"))).toBeInstanceOf(ProviderError);
  });

  it("wraps null and undefined into ProviderError with a stringified message", () => {
    expect(wrapBedrockError(null)).toBeInstanceOf(ProviderError);
    expect(wrapBedrockError(null).message).toBe("null");
    expect(wrapBedrockError(undefined).message).toBe("undefined");
  });

  it("preserves a plain Error's message and surfaces its name as context.code", () => {
    // A bare `new Error()` has name === "Error", which toShape reads as the
    // Smithy exception name and buildContext lands on context.code.
    const original = new Error("network down");
    const wrapped = wrapBedrockError(original);

    expect(wrapped.message).toBe("network down");
    expect((wrapped as unknown as { cause: unknown }).cause).toBe(original);
    expect(wrapped.context).toEqual({ code: "Error" });
  });

  it("does not leak the raw transport `code` field into context", () => {
    // context.code carries the Smithy exception NAME, never the raw
    // network code (ETIMEDOUT etc.).
    const wrapped = wrapBedrockError({
      name: "ModelTimeoutException",
      code: "ETIMEDOUT",
      message: "socket hang up",
      $metadata: { httpStatusCode: 408, requestId: "req_42" },
    });

    expect(wrapped.context).toEqual({
      status: 408,
      code: "ModelTimeoutException",
      requestId: "req_42",
    });
  });

  it("omits absent diagnostic fields from context", () => {
    // Only the name is present → only context.code lands.
    const wrapped = wrapBedrockError(awsError({ name: "ValidationException", message: "nope" }));

    expect(wrapped.context).toEqual({ code: "ValidationException" });
  });

  it("every wrapped error is an AIError", () => {
    const samples = [
      awsError({ name: "AccessDeniedException", httpStatusCode: 403 }),
      awsError({ name: "ThrottlingException", httpStatusCode: 429 }),
      awsError({ name: "ValidationException", httpStatusCode: 400 }),
      awsError({ name: "InternalServerException", httpStatusCode: 500 }),
      awsError({ name: "ModelTimeoutException" }),
      "plain string",
      new Error("plain error"),
    ];

    for (const sample of samples) {
      expect(wrapBedrockError(sample)).toBeInstanceOf(AIError);
    }
  });
});
