import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the idempotency middleware's MISS-path caching.
 *
 * Fix under test: the fire-and-forget `cacheDriver.set` inside `onSent` must
 * `.catch` so a rejected write (e.g. Redis down) doesn't become an
 * unhandledRejection. Also asserts the HIT replay path still routes through
 * `response.replay` with the cached status + content-type.
 *
 * `@mongez/config`, `@warlock.js/cache`, `@warlock.js/logger`, and the `t`
 * translator are mocked so the middleware runs without app boot.
 */
const configStore: Record<string, unknown> = {};

vi.mock("@mongez/config", () => ({
  default: {
    get: (key: string, fallback?: unknown) =>
      key in configStore ? configStore[key] : fallback,
  },
}));

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

vi.mock("../../../src/http/middleware/inject-request-context", () => ({
  t: (keyword: string) => keyword,
}));

type SentCallback = (response: unknown) => void;

function makeRequest(seed: {
  method?: string;
  idempotencyKey?: string;
  body?: unknown;
  ip?: string;
}) {
  const headers: Record<string, string> = {};

  if (seed.idempotencyKey) {
    headers["idempotency-key"] = seed.idempotencyKey;
  }

  return {
    method: seed.method ?? "POST",
    body: seed.body ?? { amount: 100 },
    header: (name: string) => headers[name.toLowerCase()],
    detectIp: () => seed.ip ?? "127.0.0.1",
    user: undefined,
    decodedAccessToken: undefined,
  } as never;
}

function makeResponse(seed: {
  statusCode?: number;
  contentType?: unknown;
  parsedBody?: unknown;
}) {
  const sentCallbacks: SentCallback[] = [];

  const response = {
    statusCode: seed.statusCode ?? 200,
    contentType: seed.contentType,
    parsedBody: seed.parsedBody,
    header: vi.fn(() => response),
    replay: vi.fn(() => Promise.resolve("REPLAYED")),
    badRequest: vi.fn(() => "BAD_REQUEST"),
    unprocessableEntity: vi.fn(() => "UNPROCESSABLE"),
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

describe("idempotencyMiddleware", () => {
  let idempotencyMiddleware: typeof import("../../../src/http/middleware/idempotency.middleware").idempotencyMiddleware;

  beforeEach(async () => {
    vi.resetModules();
    for (const key of Object.keys(configStore)) {
      delete configStore[key];
    }
    cacheStore.get.mockReset();
    cacheStore.set.mockReset();
    logError.mockReset();
    cacheStore.set.mockResolvedValue(undefined);
    ({ idempotencyMiddleware } = await import(
      "../../../src/http/middleware/idempotency.middleware"
    ));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("catches a rejected cacheDriver.set inside onSent (no unhandledRejection)", async () => {
    cacheStore.get.mockResolvedValue(null);
    cacheStore.set.mockRejectedValue(new Error("redis down"));

    const middleware = idempotencyMiddleware();
    const request = makeRequest({ idempotencyKey: "01J9XZQ-ABC" });
    const response = makeResponse({ statusCode: 201, contentType: "application/json" });

    await middleware(request, response as never);

    response.fireSent();

    await new Promise((resolve) => setImmediate(resolve));

    expect(cacheStore.set).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "idempotency-middleware",
      "set",
      expect.any(Error),
    );
  });

  it("replays a HIT (same body) through response.replay with cached metadata", async () => {
    cacheStore.get.mockImplementation(async () => ({
      status: 201,
      body: { id: 1 },
      // hash of the default request body { amount: 100 }
      bodyHash: (await import("../../../src/http/middleware/utils/idempotency-key")).hashBody({
        amount: 100,
      }),
      contentType: "application/json",
    }));

    const middleware = idempotencyMiddleware();
    const request = makeRequest({ idempotencyKey: "01J9XZQ-ABC" });
    const response = makeResponse({});

    const result = await middleware(request, response as never);

    expect(response.replay).toHaveBeenCalledWith({
      status: 201,
      body: { id: 1 },
      contentType: "application/json",
    });
    expect(result).toBe("REPLAYED");
  });

  it("does not cache a 5xx response on the MISS path", async () => {
    cacheStore.get.mockResolvedValue(null);

    const middleware = idempotencyMiddleware();
    const request = makeRequest({ idempotencyKey: "01J9XZQ-ABC" });
    const response = makeResponse({ statusCode: 503 });

    await middleware(request, response as never);

    response.fireSent();

    expect(cacheStore.set).not.toHaveBeenCalled();
  });
});
