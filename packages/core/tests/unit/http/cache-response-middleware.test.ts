import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the response-cache middleware.
 *
 * Two fixes under test:
 *  1. HIT path must use `response.replay(...)` (preserving status + content-type)
 *     instead of `response.baseResponse.send(...)`, which re-entered the
 *     already-sent reply, tripped the double-send guard, and dropped metadata.
 *  2. The fire-and-forget `cacheDriver.set` inside `onSent` must `.catch` so a
 *     rejected write (e.g. Redis down) doesn't become an unhandledRejection.
 *
 * `@warlock.js/cache` and `@warlock.js/logger` are mocked so the middleware
 * runs without a live cache backend.
 */
const cacheStore = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock("@warlock.js/cache", () => ({
  cache: {
    get: (...args: unknown[]) => cacheStore.get(...args),
    set: (...args: unknown[]) => cacheStore.set(...args),
  },
}));

const logError = vi.fn();

vi.mock("@warlock.js/logger", () => ({
  log: { error: (...args: unknown[]) => logError(...args) },
}));

type SentCallback = (response: unknown) => void;

function makeRequest(path: string) {
  return {
    path,
    getLocaleCode: () => "en",
  } as never;
}

function makeResponse(seed: {
  path: string;
  isOk?: boolean;
  statusCode?: number;
  contentType?: unknown;
  parsedBody?: unknown;
}) {
  const sentCallbacks: SentCallback[] = [];

  const response = {
    isOk: seed.isOk ?? true,
    statusCode: seed.statusCode ?? 200,
    contentType: seed.contentType,
    parsedBody: seed.parsedBody,
    request: { path: seed.path },
    replay: vi.fn(() => Promise.resolve("REPLAYED")),
    baseResponse: { send: vi.fn(() => "BASE_SEND") },
    onSent: (callback: SentCallback) => {
      sentCallbacks.push(callback);
    },
    fireSent: () => {
      for (const callback of sentCallbacks) {
        callback(response);
      }
    },
  };

  return response;
}

describe("cacheMiddleware", () => {
  let cacheMiddleware: typeof import("../../../src/http/middleware/cache-response-middleware").cacheMiddleware;

  beforeEach(async () => {
    vi.resetModules();
    cacheStore.get.mockReset();
    cacheStore.set.mockReset();
    logError.mockReset();
    cacheStore.set.mockResolvedValue(undefined);
    ({ cacheMiddleware } = await import(
      "../../../src/http/middleware/cache-response-middleware"
    ));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replays a cache HIT through response.replay (no baseResponse.send, no double-send log)", async () => {
    cacheStore.get.mockResolvedValue({
      status: 201,
      data: { id: 1 },
      contentType: "application/vnd.api+json",
    });

    const middleware = cacheMiddleware({ cacheKey: "key", withLocale: false });
    const response = makeResponse({ path: "/items" });

    const result = await middleware(makeRequest("/items"), response as never);

    expect(response.replay).toHaveBeenCalledTimes(1);
    expect(response.replay).toHaveBeenCalledWith({
      status: 201,
      body: { id: 1 },
      contentType: "application/vnd.api+json",
    });
    // Must NOT re-enter the already-sent reply.
    expect(response.baseResponse.send).not.toHaveBeenCalled();
    // Double-send guard must not have logged anything.
    expect(logError).not.toHaveBeenCalled();
    expect(result).toBe("REPLAYED");
  });

  it("defaults a missing cached status to 200 on replay", async () => {
    cacheStore.get.mockResolvedValue({ data: { ok: true } });

    const middleware = cacheMiddleware({ cacheKey: "key", withLocale: false });
    const response = makeResponse({ path: "/items" });

    await middleware(makeRequest("/items"), response as never);

    expect(response.replay).toHaveBeenCalledWith({
      status: 200,
      body: { ok: true },
      contentType: undefined,
    });
  });

  it("on a MISS, caches status + content-type + body via onSent", async () => {
    cacheStore.get.mockResolvedValue(null);

    const middleware = cacheMiddleware({ cacheKey: "key", withLocale: false });
    const response = makeResponse({
      path: "/items",
      isOk: true,
      statusCode: 200,
      contentType: "application/json",
      parsedBody: { id: 7, user: { secret: true } },
    });

    await middleware(makeRequest("/items"), response as never);

    response.fireSent();

    expect(cacheStore.set).toHaveBeenCalledTimes(1);
    const [key, payload] = cacheStore.set.mock.calls[0];
    expect(key).toBe("key");
    expect(payload).toMatchObject({
      status: 200,
      contentType: "application/json",
    });
    // `user` is omitted by default.
    expect(payload.data).toEqual({ id: 7 });
  });

  it("catches a rejected cacheDriver.set inside onSent (no unhandledRejection)", async () => {
    cacheStore.get.mockResolvedValue(null);
    cacheStore.set.mockRejectedValue(new Error("redis down"));

    const middleware = cacheMiddleware({ cacheKey: "key", withLocale: false });
    const response = makeResponse({
      path: "/items",
      contentType: "application/json",
      parsedBody: { id: 1 },
    });

    await middleware(makeRequest("/items"), response as never);

    response.fireSent();

    // Let the rejected promise settle so the .catch runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "cache-middleware",
      "set",
      expect.any(Error),
    );
  });

  it("does not cache a non-2xx response", async () => {
    cacheStore.get.mockResolvedValue(null);

    const middleware = cacheMiddleware({ cacheKey: "key", withLocale: false });
    const response = makeResponse({
      path: "/items",
      isOk: false,
      statusCode: 500,
      parsedBody: { error: "boom" },
    });

    await middleware(makeRequest("/items"), response as never);

    response.fireSent();

    expect(cacheStore.set).not.toHaveBeenCalled();
  });
});
