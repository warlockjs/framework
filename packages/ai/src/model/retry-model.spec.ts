import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelStreamChunk } from "../contracts/model.contract";
import type { RetryEvent } from "../contracts/retry-policy.contract";
import { ProviderAuthError } from "../errors/provider-auth-error";
import { ProviderError } from "../errors/provider-error";
import { ProviderRateLimitError } from "../errors/provider-rate-limit-error";
import { ProviderTimeoutError } from "../errors/provider-timeout-error";
import { MockModel } from "../mock/mock-model";
import { retryModel } from "./retry-model";

const messages: Message[] = [{ role: "user", content: "hi" }];

const fail = (error: Error) => ({ content: "", error });

/** A provider error whose cause carries a network code, like a wrapped fetch failure. */
function networkError(code: string): ProviderError {
  return new ProviderError("network", { cause: Object.assign(new Error(code), { code }) });
}

async function collect(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of stream) chunks.push(chunk);

  return chunks;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retryModel", () => {
  it("retries a transient failure and returns the later response", async () => {
    const mock = new MockModel("m", [fail(new ProviderError("boom")), { content: "ok" }]);
    const events: RetryEvent[] = [];
    const model = retryModel(mock, { backoff: "none", onRetry: (event) => events.push(event) });

    const response = await model.complete(messages);

    expect(response.content).toBe("ok");
    expect(mock.callCount).toBe(2);
    expect(events).toEqual([
      { attempt: 2, delayMs: 0, cause: expect.any(ProviderError), budget: "general" },
    ]);
  });

  it("stops after `attempts` and rethrows the last error", async () => {
    const mock = new MockModel("m", [fail(new ProviderError("boom"))]);
    const model = retryModel(mock, { attempts: 2, backoff: "none" });

    await expect(model.complete(messages)).rejects.toThrow("boom");
    expect(mock.callCount).toBe(2);
  });

  it("does not retry non-transient errors by default", async () => {
    const mock = new MockModel("m", [fail(new ProviderAuthError("bad key"))]);

    await expect(retryModel(mock, { backoff: "none" }).complete(messages)).rejects.toThrow(
      "bad key",
    );
    expect(mock.callCount).toBe(1);
  });

  it("accepts a code allow-list and a predicate for retryOn", async () => {
    const auth = new MockModel("m", [fail(new ProviderAuthError("x")), { content: "ok" }]);

    await retryModel(auth, { backoff: "none", retryOn: ["PROVIDER_AUTH"] }).complete(messages);
    expect(auth.callCount).toBe(2);

    const predicate = new MockModel("m", [fail(new ProviderError("x"))]);
    const retryOn = vi.fn(() => false);

    await expect(retryModel(predicate, { retryOn }).complete(messages)).rejects.toThrow("x");
    expect(retryOn).toHaveBeenCalledWith(expect.any(ProviderError), 1);
    expect(predicate.callCount).toBe(1);
  });

  it("waits at least retry-after (20 s) even when the backoff is 2 s", async () => {
    vi.useFakeTimers();

    const rate = new ProviderRateLimitError("slow down", { retryAfter: 20_000 });
    const mock = new MockModel("m", [fail(rate), { content: "ok" }]);
    const events: RetryEvent[] = [];
    const model = retryModel(mock, { baseMs: 2000, onRetry: (event) => events.push(event) });

    let done = false;
    const call = model.complete(messages).then(() => (done = true));

    await vi.advanceTimersByTimeAsync(19_999);
    expect(done).toBe(false);
    expect(mock.callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await call;
    expect(mock.callCount).toBe(2);
    expect(events[0]!.delayMs).toBe(20_000);
  });

  it("caps retry-after with honorRetryAfter.maxMs and ignores it when false", async () => {
    const rate = new ProviderRateLimitError("slow", { retryAfter: 60_000 });
    const capped: RetryEvent[] = [];
    const ignored: RetryEvent[] = [];

    await retryModel(new MockModel("m", [fail(rate), { content: "ok" }]), {
      baseMs: 1,
      honorRetryAfter: { maxMs: 4 },
      onRetry: (event) => capped.push(event),
    }).complete(messages);

    await retryModel(new MockModel("m", [fail(rate), { content: "ok" }]), {
      baseMs: 1,
      honorRetryAfter: false,
      onRetry: (event) => ignored.push(event),
    }).complete(messages);

    expect(capped[0]!.delayMs).toBe(4);
    expect(ignored[0]!.delayMs).toBe(1);
  });

  it("applies baseMs, maxDelayMs and jitter to the backoff", async () => {
    const mock = new MockModel("m", [
      fail(new ProviderError("a")),
      fail(new ProviderError("b")),
      fail(new ProviderError("c")),
      { content: "ok" },
    ]);
    const delays: number[] = [];

    await retryModel(mock, {
      attempts: 4,
      baseMs: 2,
      maxDelayMs: 5,
      onRetry: (event) => delays.push(event.delayMs),
    }).complete(messages);

    expect(delays).toEqual([2, 4, 5]);

    const jittered = new MockModel("m", [fail(new ProviderError("a")), { content: "ok" }]);
    const seen: number[] = [];

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await retryModel(jittered, {
      baseMs: 10,
      jitter: 1.2,
      onRetry: (event) => seen.push(event.delayMs),
    }).complete(messages);

    expect(seen).toEqual([11]);
  });

  it("spends only the offline budget on DNS failures and continues past the general cap", async () => {
    const mock = new MockModel("m", [
      fail(networkError("ENOTFOUND")),
      fail(networkError("EAI_AGAIN")),
      fail(networkError("ENETUNREACH")),
      fail(networkError("EHOSTUNREACH")),
      fail(networkError("ENETDOWN")),
      { content: "ok" },
    ]);
    const events: RetryEvent[] = [];
    const model = retryModel(mock, {
      attempts: 2,
      baseMs: 1,
      offline: { budgetMs: 1000, maxDelayMs: 2 },
      onRetry: (event) => events.push(event),
    });

    await expect(model.complete(messages)).resolves.toMatchObject({ content: "ok" });
    expect(mock.callCount).toBe(6);
    expect(events.map((event) => event.budget)).toEqual(Array(5).fill("offline"));
  });

  it("stops retrying offline once the budget is spent", async () => {
    const mock = new MockModel("m", [fail(networkError("ENOTFOUND"))]);
    const model = retryModel(mock, { baseMs: 1, offline: { budgetMs: 3, maxDelayMs: 1 } });

    await expect(model.complete(messages)).rejects.toThrow("network");
    expect(mock.callCount).toBe(4);
  });

  it("does not treat ECONNREFUSED as offline, and offline is off by default", async () => {
    const refused = new MockModel("m", [fail(networkError("ECONNREFUSED"))]);
    const events: RetryEvent[] = [];

    await expect(
      retryModel(refused, {
        attempts: 2,
        backoff: "none",
        offline: { budgetMs: 1000, maxDelayMs: 1 },
        onRetry: (event) => events.push(event),
      }).complete(messages),
    ).rejects.toThrow("network");
    expect(refused.callCount).toBe(2);
    expect(events.map((event) => event.budget)).toEqual(["general"]);

    const dns = new MockModel("m", [fail(networkError("ENOTFOUND"))]);

    await expect(
      retryModel(dns, { attempts: 2, backoff: "none" }).complete(messages),
    ).rejects.toThrow("network");
    expect(dns.callCount).toBe(2);
  });

  it("stops after maxTimeouts timeouts", async () => {
    const mock = new MockModel("m", [fail(new ProviderTimeoutError("slow"))]);

    await expect(
      retryModel(mock, { attempts: 10, backoff: "none", maxTimeouts: 3 }).complete(messages),
    ).rejects.toThrow("slow");
    expect(mock.callCount).toBe(3);
  });

  it("lets an x-should-retry header override the decision", async () => {
    const yes = new ProviderAuthError("a", { context: { headers: { "x-should-retry": "true" } } });
    const no = new ProviderError("b", { context: { headers: { "x-should-retry": "false" } } });
    const retried = new MockModel("m", [fail(yes), { content: "ok" }]);
    const refused = new MockModel("m", [fail(no)]);

    await retryModel(retried, { backoff: "none" }).complete(messages);
    await expect(retryModel(refused, { backoff: "none" }).complete(messages)).rejects.toThrow("b");

    expect(retried.callCount).toBe(2);
    expect(refused.callCount).toBe(1);
  });

  it("ignores a throwing onRetry hook", async () => {
    const mock = new MockModel("m", [fail(new ProviderError("a")), { content: "ok" }]);
    const model = retryModel(mock, {
      backoff: "none",
      onRetry: () => {
        throw new Error("hook");
      },
    });

    await expect(model.complete(messages)).resolves.toMatchObject({ content: "ok" });
  });

  it("does not retry once the signal is aborted", async () => {
    const controller = new AbortController();
    const mock = new MockModel("m", [fail(new ProviderError("a")), { content: "ok" }]);
    const model = retryModel(mock, { baseMs: 10_000, onRetry: () => controller.abort() });

    await expect(model.complete(messages, { signal: controller.signal })).rejects.toBeDefined();
    expect(mock.callCount).toBe(1);
  });

  it("retries stream() only before any content chunk", async () => {
    const mock = new MockModel("m", [fail(new ProviderError("a")), { content: "hello" }]);
    const chunks = await collect(retryModel(mock, { backoff: "none" }).stream(messages));

    expect(chunks.some((chunk) => chunk.type === "delta")).toBe(true);
    expect(mock.callCount).toBe(2);
  });

  it("keeps the wrapped model's identity", () => {
    const mock = new MockModel("m", [{ content: "x" }], { vision: true });
    const model = retryModel(mock);

    expect(model.name).toBe("m");
    expect(model.provider).toBe("mock");
    expect(model.capabilities).toEqual({ vision: true });
  });
});
