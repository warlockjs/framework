import { describe, expect, it } from "vitest";
import {
  ContentFilterError,
  ContextLengthExceededError,
  EmbeddingVectorCountMismatchError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  QuotaExceededError,
} from "./index";

describe("ProviderError status / billed / retryable", () => {
  it("reads status from options or from context.status", () => {
    expect(new ProviderError("x", { status: 502 }).status).toBe(502);
    expect(new ProviderError("x", { context: { status: 401 } }).status).toBe(401);
    expect(new ProviderError("x", { context: { status: "401" } }).status).toBeUndefined();
    expect(new ProviderError("x").status).toBeUndefined();
  });

  it("marks unauthenticated, unfunded and forbidden calls as not billed", () => {
    for (const status of [401, 402, 403]) {
      expect(new ProviderError("x", { status }).billed).toBe(false);
    }
  });

  it("fails closed for every status no provider documents as free", () => {
    for (const status of [400, 404, 413, 429, 500, 503]) {
      expect(new ProviderError("x", { status }).billed).toBe("unknown");
    }

    expect(new ProviderOverloadedError("x", { status: 529 }).billed).toBe("unknown");
    expect(new ProviderTimeoutError("x").billed).toBe("unknown");
    expect(new ProviderOverloadedError("mid-stream").billed).toBe("unknown");
  });

  it("lets an adapter state the billing fact explicitly", () => {
    expect(new ProviderError("x", { status: 500, billed: true }).billed).toBe(true);
    expect(
      new EmbeddingVectorCountMismatchError({
        provider: "p",
        expectedCount: 2,
        receivedCount: 1,
        record: "r",
      }).billed,
    ).toBe(true);
  });

  it("derives retryable from the class, then the status", () => {
    expect(new ProviderRateLimitError("x").retryable).toBe(true);
    expect(new ProviderTimeoutError("x").retryable).toBe(true);
    expect(new ProviderOverloadedError("x").retryable).toBe(true);
    expect(new ProviderAuthError("x", { status: 401 }).retryable).toBe(false);
    expect(new QuotaExceededError("x", { status: 402 }).retryable).toBe(false);
    expect(new InvalidRequestError("x", { status: 400 }).retryable).toBe(false);
    expect(new ContextLengthExceededError("x").retryable).toBe(false);
    expect(new ContentFilterError("x").retryable).toBe(false);
    expect(new ProviderError("x", { status: 503 }).retryable).toBe(true);
    expect(new ProviderError("x", { status: 400 }).retryable).toBe(false);
    expect(new ProviderError("x").retryable).toBe(false);
    expect(new ProviderError("x", { status: 503, retryable: false }).retryable).toBe(false);
  });

  it("gives overloads their own code and keeps the retry hint", () => {
    const error = new ProviderOverloadedError("busy", { status: 529, retryAfter: 2_000 });

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("PROVIDER_OVERLOADED");
    expect(error.category).toBe("provider");
    expect(error.name).toBe("ProviderOverloadedError");
    expect(error.retryAfter).toBe(2_000);
  });
});
