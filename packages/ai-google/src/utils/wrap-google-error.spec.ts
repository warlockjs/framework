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
import { describe, expect, it } from "vitest";
import { wrapGoogleError } from "./wrap-google-error";

function googleError(status: number | undefined, message = "failed"): unknown {
  return { name: "ApiError", status, message };
}

describe("wrapGoogleError", () => {
  it("passes AIError through untouched", () => {
    const original = new ProviderRateLimitError("slow");

    expect(wrapGoogleError(original)).toBe(original);
  });

  it("maps 401 / 403 / PERMISSION_DENIED / bad key to ProviderAuthError", () => {
    expect(wrapGoogleError(googleError(401))).toBeInstanceOf(ProviderAuthError);
    expect(wrapGoogleError(googleError(403))).toBeInstanceOf(ProviderAuthError);
    expect(
      wrapGoogleError(googleError(400, "API key not valid. Please pass a valid API key.")),
    ).toBeInstanceOf(ProviderAuthError);
  });

  it("maps a status-less 'unauthenticated' message to ProviderAuthError", () => {
    expect(
      wrapGoogleError({ name: "X", message: "request is unauthenticated" }),
    ).toBeInstanceOf(ProviderAuthError);
  });

  it("maps 429 / RESOURCE_EXHAUSTED to ProviderRateLimitError", () => {
    expect(wrapGoogleError(googleError(429))).toBeInstanceOf(ProviderRateLimitError);
    expect(
      wrapGoogleError(googleError(undefined, "RESOURCE_EXHAUSTED: quota exceeded")),
    ).toBeInstanceOf(ProviderRateLimitError);
  });

  it("maps a status-less 'quota' message to ProviderRateLimitError", () => {
    expect(
      wrapGoogleError({ name: "X", message: "daily quota reached for this project" }),
    ).toBeInstanceOf(ProviderRateLimitError);
  });

  it("prefers auth classification over rate-limit on a 403 even with a quota phrase", () => {
    // 403 is checked before 429/quota, so this stays an auth error.
    expect(wrapGoogleError(googleError(403, "quota project blocked"))).toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("splits 400: context-length vs generic", () => {
    expect(
      wrapGoogleError(googleError(400, "The input token count exceeds the maximum")),
    ).toBeInstanceOf(ContextLengthExceededError);
    expect(wrapGoogleError(googleError(400, "Invalid value for field x"))).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("recognizes every 400 context-length phrase variant", () => {
    const phrases = [
      "token count is too high",
      "context length limit reached",
      "this exceeds the maximum supported tokens",
      "the input is too long for this model",
    ];

    for (const phrase of phrases) {
      expect(wrapGoogleError(googleError(400, phrase))).toBeInstanceOf(
        ContextLengthExceededError,
      );
    }
  });

  it("maps 404 / generic 4xx to InvalidRequestError", () => {
    expect(wrapGoogleError(googleError(404))).toBeInstanceOf(InvalidRequestError);
    expect(wrapGoogleError(googleError(422))).toBeInstanceOf(InvalidRequestError);
  });

  it("maps 504 / DEADLINE_EXCEEDED / ETIMEDOUT to ProviderTimeoutError", () => {
    expect(wrapGoogleError(googleError(504))).toBeInstanceOf(ProviderTimeoutError);
    expect(
      wrapGoogleError({ name: "X", message: "DEADLINE_EXCEEDED waiting for model" }),
    ).toBeInstanceOf(ProviderTimeoutError);
    expect(wrapGoogleError({ name: "X", code: "ETIMEDOUT", message: "socket" })).toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("maps an AbortError name to ProviderTimeoutError", () => {
    expect(
      wrapGoogleError({ name: "AbortError", message: "The operation was aborted" }),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("maps an ECONNABORTED code to ProviderTimeoutError", () => {
    expect(
      wrapGoogleError({ name: "X", code: "ECONNABORTED", message: "connection aborted" }),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("classifies timeout ahead of an accompanying 503 server status", () => {
    // isTimeout() is checked before the status ladder; the AbortError name wins.
    expect(
      wrapGoogleError({ name: "AbortError", status: 503, message: "aborted mid-flight" }),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it("maps 500 / 503 to plain ProviderError", () => {
    expect(wrapGoogleError(googleError(500))).toBeInstanceOf(ProviderError);
    expect(wrapGoogleError(googleError(503))).toBeInstanceOf(ProviderError);
    expect(wrapGoogleError(googleError(500))).not.toBeInstanceOf(InvalidRequestError);
  });

  it("classifies a real ApiError instance by status", () => {
    const wrapped = wrapGoogleError(new ApiError({ message: "boom", status: 429 }));

    expect(wrapped).toBeInstanceOf(ProviderRateLimitError);
  });

  it("preserves cause and attaches status + name to context", () => {
    const raw = googleError(429, "slow down");
    const wrapped = wrapGoogleError(raw);

    expect((wrapped as unknown as { cause: unknown }).cause).toBe(raw);
    expect(wrapped.context).toMatchObject({ status: 429, code: "ApiError" });
  });

  it("leaves context empty when neither status nor name is present", () => {
    const wrapped = wrapGoogleError({ message: "mysterious" });

    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped.context).toEqual({});
  });

  it("attaches status alone when name is absent", () => {
    const wrapped = wrapGoogleError({ status: 500, message: "server fault" });

    expect(wrapped.context).toEqual({ status: 500 });
  });

  it("reads message + status + name off a real Error object (500 → ProviderError)", () => {
    const thrown = Object.assign(new Error("from error object"), { status: 500 });
    const wrapped = wrapGoogleError(thrown);

    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped.message).toBe("from error object");
    // A native Error carries name "Error", surfaced on context.code by buildContext.
    expect(wrapped.context).toEqual({ status: 500, code: "Error" });
  });

  it("wraps non-object / string / plain Error into ProviderError", () => {
    expect(wrapGoogleError("boom").message).toBe("boom");
    expect(wrapGoogleError(5).message).toBe("5");
    expect(wrapGoogleError(new Error("plain"))).toBeInstanceOf(ProviderError);
  });

  it("every wrapped error is an AIError", () => {
    const samples = [
      googleError(401),
      googleError(429),
      googleError(400, "token count exceeds the maximum"),
      googleError(400),
      googleError(500),
      googleError(504),
      "plain string",
      new Error("plain error"),
    ];

    for (const sample of samples) {
      expect(wrapGoogleError(sample)).toBeInstanceOf(AIError);
    }
  });
});
