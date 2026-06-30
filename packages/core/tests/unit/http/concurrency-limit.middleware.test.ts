import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the concurrency-limit middleware's slot-release lifecycle.
 *
 * The bug: the slot was released ONLY via `response.onSent`, which fires from
 * `Response.send()` / `stream().end()` / `sse().end()` — NOT from bare-reply
 * paths (noContent, redirect, sendFile, download, sendBuffer, raw send). Those
 * paths leaked the slot, permanently 429-ing the route after `max` requests.
 *
 * The fix also binds the raw socket `finish` / `close` events so the slot frees
 * regardless of response path. These tests simulate a bare-reply response by
 * driving the raw `finish`/`close` events directly without ever firing `onSent`.
 *
 * `t` is mocked so the middleware doesn't pull in the full request-context
 * module graph.
 */
vi.mock("../../../src/http/middleware/inject-request-context", () => ({
  t: (keyword: string) => keyword,
}));

type SentCallback = (response: unknown) => void;

type FakeResponse = {
  raw: EventEmitter;
  baseResponse: { raw: EventEmitter };
  onSent: (callback: SentCallback) => void;
  header: ReturnType<typeof vi.fn>;
  tooManyRequests: ReturnType<typeof vi.fn>;
  /** Manually invoke the registered onSent callbacks (Response.send path). */
  fireSent: () => void;
};

function makeResponse(): FakeResponse {
  const raw = new EventEmitter();
  const sentCallbacks: SentCallback[] = [];

  const response: FakeResponse = {
    raw,
    baseResponse: { raw },
    onSent: (callback) => {
      sentCallbacks.push(callback);
    },
    header: vi.fn(),
    tooManyRequests: vi.fn(() => "TOO_MANY_REQUESTS"),
    fireSent: () => {
      for (const callback of sentCallbacks) {
        callback(response);
      }
    },
  };

  return response;
}

function makeRequest(routePath: string) {
  return { route: { path: routePath } } as never;
}

describe("concurrencyLimitMiddleware", () => {
  let concurrencyLimitMiddleware: typeof import("../../../src/http/middleware/concurrency-limit.middleware").concurrencyLimitMiddleware;

  beforeEach(async () => {
    // Fresh module so the process-local `counters` map starts empty per test.
    vi.resetModules();
    ({ concurrencyLimitMiddleware } = await import(
      "../../../src/http/middleware/concurrency-limit.middleware"
    ));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests up to the cap, then 429s the next one", () => {
    const middleware = concurrencyLimitMiddleware(2);

    const first = makeResponse();
    const second = makeResponse();
    const third = makeResponse();

    middleware(makeRequest("/reports"), first as never);
    middleware(makeRequest("/reports"), second as never);

    expect(first.tooManyRequests).not.toHaveBeenCalled();
    expect(second.tooManyRequests).not.toHaveBeenCalled();

    middleware(makeRequest("/reports"), third as never);

    expect(third.tooManyRequests).toHaveBeenCalledTimes(1);
  });

  it("releases the slot on the raw 'finish' event (bare-reply path, no onSent)", () => {
    const middleware = concurrencyLimitMiddleware(1);

    const first = makeResponse();
    middleware(makeRequest("/reports"), first as never);

    // Simulate a noContent/redirect/sendFile response: the raw socket finishes
    // but `onSent` never fires.
    first.raw.emit("finish");

    // The slot must now be free — a new request should NOT be throttled.
    const second = makeResponse();
    middleware(makeRequest("/reports"), second as never);

    expect(second.tooManyRequests).not.toHaveBeenCalled();
  });

  it("releases the slot on the raw 'close' event (client disconnect)", () => {
    const middleware = concurrencyLimitMiddleware(1);

    const first = makeResponse();
    middleware(makeRequest("/reports"), first as never);

    first.raw.emit("close");

    const second = makeResponse();
    middleware(makeRequest("/reports"), second as never);

    expect(second.tooManyRequests).not.toHaveBeenCalled();
  });

  it("releases the slot only once even when onSent and finish both fire", () => {
    const middleware = concurrencyLimitMiddleware(2);

    const first = makeResponse();
    middleware(makeRequest("/reports"), first as never);

    // Both the onSent path and the raw finish path fire (the normal send case).
    first.fireSent();
    first.raw.emit("finish");
    first.raw.emit("close");

    // Idempotent release: the counter dropped by exactly one, so two fresh
    // requests still fit under the cap of 2.
    const second = makeResponse();
    const third = makeResponse();

    middleware(makeRequest("/reports"), second as never);
    middleware(makeRequest("/reports"), third as never);

    expect(second.tooManyRequests).not.toHaveBeenCalled();
    expect(third.tooManyRequests).not.toHaveBeenCalled();
  });
});
