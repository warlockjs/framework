import {
  AIError,
  ContextLengthExceededError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { wrapOllamaError } from "./wrap-ollama-error";

/** Duck-typed Ollama `ResponseError`: name + status_code + message. */
function responseError(status: number, message = "failed"): unknown {
  return { name: "ResponseError", status_code: status, message };
}

describe("wrapOllamaError", () => {
  it("passes AIError through untouched", () => {
    const original = new ProviderRateLimitError("slow");

    expect(wrapOllamaError(original)).toBe(original);
  });

  it("maps connection-refused (daemon down) to ProviderError", () => {
    expect(
      wrapOllamaError({ name: "TypeError", message: "fetch failed", cause: { code: "ECONNREFUSED" } }),
    ).toBeInstanceOf(ProviderError);
    expect(wrapOllamaError({ message: "request to http://127.0.0.1:11434 ECONNREFUSED" })).toBeInstanceOf(
      ProviderError,
    );
  });

  it("maps timeouts to ProviderTimeoutError", () => {
    expect(wrapOllamaError({ name: "AbortError", message: "aborted" })).toBeInstanceOf(
      ProviderTimeoutError,
    );
    expect(wrapOllamaError({ message: "x", cause: { code: "ETIMEDOUT" } })).toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("maps every timeout signal variant to ProviderTimeoutError", () => {
    expect(wrapOllamaError({ name: "TimeoutError", message: "deadline" })).toBeInstanceOf(
      ProviderTimeoutError,
    );
    expect(wrapOllamaError({ message: "x", cause: { code: "ECONNABORTED" } })).toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("prefers timeout over connection-refused when both could match", () => {
    // AbortError name short-circuits before the connection-refused probe.
    expect(
      wrapOllamaError({ name: "AbortError", message: "fetch failed" }),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("maps 401 / 403 to ProviderAuthError", () => {
    expect(wrapOllamaError(responseError(401))).toBeInstanceOf(ProviderAuthError);
    expect(wrapOllamaError(responseError(403))).toBeInstanceOf(ProviderAuthError);
  });

  it("maps 429 to ProviderRateLimitError", () => {
    expect(wrapOllamaError(responseError(429))).toBeInstanceOf(ProviderRateLimitError);
  });

  it("splits 4xx: context-length vs generic", () => {
    expect(
      wrapOllamaError(responseError(400, "input exceeds the context length of this model")),
    ).toBeInstanceOf(ContextLengthExceededError);
    expect(wrapOllamaError(responseError(404, "model 'foo' not found"))).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("maps a generic 400 (no context phrasing) to InvalidRequestError", () => {
    expect(wrapOllamaError(responseError(400, "bad payload"))).toBeInstanceOf(InvalidRequestError);
  });

  it("matches every context-length phrasing the wrapper recognizes", () => {
    const phrasings = [
      "request exceeds the context length",
      "prompt is too long",
      "input exceeds limit",
      "over the maximum context size",
    ];

    for (const phrase of phrasings) {
      expect(wrapOllamaError(responseError(400, phrase))).toBeInstanceOf(
        ContextLengthExceededError,
      );
    }
  });

  it("treats 422 as a generic invalid request", () => {
    expect(wrapOllamaError(responseError(422, "unprocessable"))).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("maps 5xx to plain ProviderError", () => {
    expect(wrapOllamaError(responseError(500))).toBeInstanceOf(ProviderError);
    expect(wrapOllamaError(responseError(500))).not.toBeInstanceOf(InvalidRequestError);
  });

  it("preserves cause and attaches status + code to context", () => {
    const raw = responseError(429, "slow down");
    const wrapped = wrapOllamaError(raw);

    expect((wrapped as unknown as { cause: unknown }).cause).toBe(raw);
    expect(wrapped.context).toMatchObject({ status: 429 });
  });

  it("attaches the socket code (from cause) to context for connection errors", () => {
    const wrapped = wrapOllamaError({
      name: "TypeError",
      message: "fetch failed",
      cause: { code: "ECONNREFUSED" },
    });

    expect(wrapped.context).toEqual({ code: "ECONNREFUSED" });
  });

  it("reads a top-level code directly off the error", () => {
    const wrapped = wrapOllamaError({ message: "x", code: "ETIMEDOUT" });

    expect(wrapped).toBeInstanceOf(ProviderTimeoutError);
    expect(wrapped.context).toEqual({ code: "ETIMEDOUT" });
  });

  it("leaves context empty when neither status nor code is present", () => {
    const wrapped = wrapOllamaError(new Error("plain"));

    expect(wrapped.context).toEqual({});
  });

  it("carries both status and code when both are present", () => {
    const wrapped = wrapOllamaError({
      name: "ResponseError",
      status_code: 429,
      code: "RATE_LIMITED",
      message: "slow",
    });

    expect(wrapped.context).toEqual({ status: 429, code: "RATE_LIMITED" });
  });

  it("wraps non-object / string / plain Error into ProviderError", () => {
    expect(wrapOllamaError("boom").message).toBe("boom");
    expect(wrapOllamaError(9).message).toBe("9");
    expect(wrapOllamaError(new Error("plain"))).toBeInstanceOf(ProviderError);
  });

  it("string-coerces a bare object with no message and no signals", () => {
    const wrapped = wrapOllamaError({});

    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped).not.toBeInstanceOf(InvalidRequestError);
    expect(wrapped.message).toBe("[object Object]");
  });

  it("coerces null and undefined to their String() form via ProviderError", () => {
    expect(wrapOllamaError(null).message).toBe("null");
    expect(wrapOllamaError(undefined).message).toBe("undefined");
  });

  it("prefers the shape's message over the Error's own when both exist", () => {
    const wrapped = wrapOllamaError({
      message: "from shape",
      name: "ResponseError",
      status_code: 500,
    });

    expect(wrapped.message).toBe("from shape");
    expect(wrapped).toBeInstanceOf(ProviderError);
  });

  it("every wrapped error is an AIError", () => {
    const samples = [
      responseError(401),
      responseError(429),
      responseError(400, "context length exceeded"),
      responseError(404),
      responseError(500),
      { name: "AbortError" },
      { message: "fetch failed", cause: { code: "ECONNREFUSED" } },
      "plain string",
      new Error("plain error"),
    ];

    for (const sample of samples) {
      expect(wrapOllamaError(sample)).toBeInstanceOf(AIError);
    }
  });
});
