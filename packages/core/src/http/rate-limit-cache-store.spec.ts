import rateLimit from "@fastify/rate-limit";
import config from "@mongez/config";
import { cache, MemoryCacheDriver, NullCacheDriver } from "@warlock.js/cache";
import Fastify from "fastify";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitMiddleware } from "./middleware/rate-limit.middleware";
import {
  CacheRateLimitStore,
  incrementSharedRateLimit,
  readSharedRateLimit,
  resetSharedRateLimitErrorLog,
  UnsupportedRateLimitDriverError,
} from "./rate-limit-cache-store";
import type { Request } from "./request";
import type { Response } from "./response";

/**
 * rate-limit counts kept in `@warlock.js/cache`. Two store or
 * middleware instances over one cache driver stand in for two processes over
 * one shared driver (Redis, a database).
 */

let driver: MemoryCacheDriver;

beforeEach(async () => {
  driver = new MemoryCacheDriver();
  driver.setOptions({});
  driver.setLoggingState(false);
  await cache.use(driver);
});

afterEach(async () => {
  await driver.disconnect();
  config.set("http", {});
  vi.restoreAllMocks();
  resetSharedRateLimitErrorLog();
});

function incr(store: CacheRateLimitStore, key: string, timeWindow = 60_000) {
  return new Promise<{ current: number; ttl: number }>((resolve, reject) => {
    store.incr(
      key,
      (error, result) => (error || !result ? reject(error) : resolve(result)),
      timeWindow,
    );
  });
}

describe("incrementSharedRateLimit", () => {
  it("passes the TTL to the atomic bump when a seed disappears before increment", async () => {
    const increment = vi.spyOn(driver, "increment");
    const set = driver.set.bind(driver);
    vi.spyOn(driver, "set").mockImplementation(async (key, value, options) => {
      const result = await set(key, value, options);
      await driver.remove(key);
      return result;
    });
    const now = Date.now();
    expect((await incrementSharedRateLimit("race", "source", 60_000, now)).current).toBe(1);
    expect(increment).toHaveBeenCalledWith(expect.any(String), 1, { ttl: 120 });
    const key = increment.mock.calls[0]![0];
    const entry = await (
      driver as unknown as { getEntry(key: unknown): Promise<{ expiresAt?: number } | null> }
    ).getEntry(key);
    expect(entry?.expiresAt).toBeGreaterThan(now + 119_000);
  });
  it("counts within a window and starts over in the next one", async () => {
    const start = 1_000 * 60_000;

    expect((await incrementSharedRateLimit("t", "1.2.3.4", 60_000, start)).current).toBe(1);
    expect((await incrementSharedRateLimit("t", "1.2.3.4", 60_000, start + 1)).current).toBe(2);

    const next = await incrementSharedRateLimit("t", "1.2.3.4", 60_000, start + 60_000);

    expect(next.current).toBe(1);
    expect(next.resetAt).toBe(start + 120_000);
  });

  it("keeps groups and namespaces apart", async () => {
    const now = 5 * 60_000;

    await incrementSharedRateLimit("a", "one", 60_000, now);
    await incrementSharedRateLimit("a", "one", 60_000, now);

    expect((await incrementSharedRateLimit("a", "two", 60_000, now)).current).toBe(1);
    expect((await incrementSharedRateLimit("b", "one", 60_000, now)).current).toBe(1);
    expect((await readSharedRateLimit("a", "one", 60_000, now)).current).toBe(2);
  });

  it("never puts the raw group key in a cache key", async () => {
    const set = vi.spyOn(cache, "set");

    await incrementSharedRateLimit("route./login", "member@example.com", 60_000);

    const keys = set.mock.calls.map((call) => String(call[0]));

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.includes("member@example.com"))).toBe(false);
    // the route path is flattened so the file driver cannot turn it into directories
    expect(keys.some((key) => key.includes("/"))).toBe(false);
  });
});

describe("CacheRateLimitStore", () => {
  it("shares counts between two instances over one cache driver", async () => {
    const processA = new CacheRateLimitStore();
    const processB = new CacheRateLimitStore();

    await incr(processA, "1.2.3.4");
    await incr(processB, "1.2.3.4");
    const third = await incr(processA, "1.2.3.4");

    expect(third.current).toBe(3);
    expect(third.ttl).toBeGreaterThan(0);
    expect(third.ttl).toBeLessThanOrEqual(60_000);
  });

  it("gives each route its own namespace through child(), from the plugin's routeInfo", async () => {
    const global = new CacheRateLimitStore();
    // the shape @fastify/rate-limit passes: route options under `routeInfo`
    const login = global.child({ routeInfo: { method: "POST", url: "/login" } } as any);
    const search = global.child({ routeInfo: { method: "GET", url: "/search" } } as any);

    await incr(global, "1.2.3.4");
    await incr(search as CacheRateLimitStore, "1.2.3.4");
    await incr(search as CacheRateLimitStore, "1.2.3.4");

    expect((await incr(login as CacheRateLimitStore, "1.2.3.4")).current).toBe(1);
  });

  it("does not merge routes whose paths flatten to the same text", async () => {
    const global = new CacheRateLimitStore();
    const byParam = global.child({ routeInfo: { method: "GET", url: "/users/:id" } } as any);
    const literal = global.child({ routeInfo: { method: "GET", url: "/users/id" } } as any);

    await incr(byParam as CacheRateLimitStore, "1.2.3.4");

    expect((await incr(literal as CacheRateLimitStore, "1.2.3.4")).current).toBe(1);
  });

  it("keeps per-route limits apart when registered through the real plugin", async () => {
    const app = Fastify();

    await app.register(rateLimit, {
      store: CacheRateLimitStore,
      skipOnError: true,
      max: 100,
      timeWindow: 60_000,
    });

    app.get("/search", { config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async () => "ok");
    app.post("/login", { config: { rateLimit: { max: 1, timeWindow: 60_000 } } }, async () => "ok");

    await app.ready();

    try {
      for (let index = 0; index < 5; index++) {
        expect((await app.inject({ method: "GET", url: "/search" })).statusCode).toBe(200);
      }

      // five searches must not count toward the login limit
      expect((await app.inject({ method: "POST", url: "/login" })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/login" })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("refuses the null driver, which would never trip the limit", async () => {
    const nullDriver = new NullCacheDriver();
    nullDriver.setOptions({});
    nullDriver.setLoggingState(false);
    await cache.use(nullDriver);
    vi.spyOn(log, "error").mockImplementation(() => log);

    await expect(incr(new CacheRateLimitStore(), "1.2.3.4")).rejects.toBeInstanceOf(
      UnsupportedRateLimitDriverError,
    );
    await expect(incrementSharedRateLimit("t", "1.2.3.4", 60_000)).rejects.toThrow(
      /"null" cache driver/,
    );
  });

  it("refuses the file driver", async () => {
    const previous = cache.currentDriver;
    cache.currentDriver = { name: "file" } as any;

    try {
      await expect(incrementSharedRateLimit("t", "1.2.3.4", 60_000)).rejects.toThrow(
        /"file" cache driver/,
      );
    } finally {
      cache.currentDriver = previous;
    }
  });

  it("logs a failing store at most once a minute", async () => {
    vi.spyOn(cache, "increment").mockRejectedValue(new Error("redis down"));
    const error = vi.spyOn(log, "error").mockImplementation(() => log);
    const store = new CacheRateLimitStore();

    await expect(incr(store, "1.2.3.4")).rejects.toThrow("redis down");
    await expect(incr(store, "1.2.3.4")).rejects.toThrow("redis down");
    await expect(incr(store, "5.6.7.8")).rejects.toThrow("redis down");

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("reports a driver failure through the callback", async () => {
    vi.spyOn(cache, "increment").mockRejectedValue(new Error("redis down"));

    await expect(incr(new CacheRateLimitStore(), "1.2.3.4")).rejects.toThrow("redis down");
  });
});

describe('rateLimitMiddleware with store: "cache"', () => {
  function run(middleware: ReturnType<typeof rateLimitMiddleware>, ip = "1.1.1.1") {
    const request = {
      route: { path: "/login" },
      locals: {},
      detectIp: () => ip,
    } as unknown as Request;
    const response = {
      header: vi.fn(),
      tooManyRequests: vi.fn(() => "429"),
    } as unknown as Response;

    return { promise: (middleware as any)({ request, response }) as Promise<unknown>, response };
  }

  it("counts two limiter instances with the same name together", async () => {
    const processA = rateLimitMiddleware({
      max: 2,
      duration: 60_000,
      store: "cache",
      name: "login",
    });
    const processB = rateLimitMiddleware({
      max: 2,
      duration: 60_000,
      store: "cache",
      name: "login",
    });

    const first = run(processA);
    await first.promise;
    const second = run(processB);
    await second.promise;
    const third = run(processA);
    await third.promise;

    expect(first.response.tooManyRequests).not.toHaveBeenCalled();
    expect(second.response.tooManyRequests).not.toHaveBeenCalled();
    expect(third.response.tooManyRequests).toHaveBeenCalled();
  });

  it('follows http.rateLimit.store when it is "cache"', async () => {
    config.set("http", { rateLimit: { store: "cache" } });
    const increment = vi.spyOn(cache, "increment");

    const limiter = rateLimitMiddleware({ max: 5, duration: 60_000 });
    await run(limiter).promise;

    expect(increment).toHaveBeenCalled();
  });

  it("stays in memory by default", async () => {
    const increment = vi.spyOn(cache, "increment");

    const limiter = rateLimitMiddleware({ max: 5, duration: 60_000 });
    await run(limiter).promise;

    expect(increment).not.toHaveBeenCalled();
  });

  it("fails open when the cache is down", async () => {
    vi.spyOn(cache, "increment").mockRejectedValue(new Error("redis down"));
    vi.spyOn(log, "error").mockImplementation(() => log);

    const limiter = rateLimitMiddleware({ max: 1, duration: 60_000, store: "cache", name: "down" });
    const result = run(limiter);

    await expect(result.promise).resolves.toBeUndefined();
    expect(result.response.tooManyRequests).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });
});
