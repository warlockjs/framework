import { cache, RedisCacheDriver } from "@warlock.js/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheRateLimitStore, incrementSharedRateLimit } from "./rate-limit-cache-store";

const enabled = process.env.WARLOCK_REDIS_INTEGRATION === "1";
const host = process.env.QUEUE_REDIS_HOST ?? "127.0.0.1";
const port = Number(process.env.QUEUE_REDIS_PORT ?? 6390);
const prefix = `integration.rate-limit.${randomUUID()}`;
const previousDriver = cache.currentDriver;
const observer = createClient({
  socket: { host, port, connectTimeout: 1000, reconnectStrategy: false },
});
observer.on("error", () => {});
const drivers = [new RedisCacheDriver(), new RedisCacheDriver()];

if (!enabled)
  console.info(
    "Redis rate-limit integration skipped; set WARLOCK_REDIS_INTEGRATION=1 to run against Redis.",
  );

describe.skipIf(!enabled)("real Redis cache-backed rate limits", () => {
  beforeAll(async () => {
    try {
      await observer.connect();
    } catch (error) {
      throw new Error(`Redis integration requires a reachable server at ${host}:${port}.`, {
        cause: error,
      });
    }
    for (const driver of drivers) {
      driver.setOptions({
        host,
        port,
        globalPrefix: prefix,
        ttl: 0,
        clientOptions: { socket: { connectTimeout: 1000, reconnectStrategy: false } },
      });
      driver.setLoggingState(false);
      await driver.connect();
    }
  });
  beforeEach(async () => {
    await cache.use(drivers[0]!);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (observer.isOpen) {
      const keys = await observer.keys(`${prefix}.*`);
      if (keys.length) await observer.del(keys);
    }
  });
  afterAll(async () => {
    cache.currentDriver = previousDriver;
    await Promise.all(drivers.map((driver) => driver.disconnect()));
    if (observer.isOpen) await observer.quit();
  });

  it("shares store counts through two Redis clients and keeps fixed window expiry", async () => {
    function bump(store: CacheRateLimitStore) {
      return new Promise<{ current: number; ttl: number }>((resolve, reject) =>
        store.incr(
          "source",
          (error, result) => (error || !result ? reject(error) : resolve(result)),
          30_000,
        ),
      );
    }
    const first = new CacheRateLimitStore(undefined, "shared");
    const second = new CacheRateLimitStore(undefined, "shared");
    expect((await bump(first)).current).toBe(1);
    await cache.use(drivers[1]!);
    expect((await bump(second)).current).toBe(2);
    const keys = await observer.keys(`${prefix}.*`);
    expect(keys).toHaveLength(1);
    const key = keys[0]!;
    await observer.pExpire(key, 5000);
    const before = await observer.pTTL(key);
    const counts = await Promise.all(
      Array.from({ length: 20 }, (_, index) => bump(index % 2 ? first : second)),
    );
    expect(new Set(counts.map((result) => result.current)).size).toBe(20);
    expect(Math.max(...counts.map((result) => result.current))).toBe(22);
    expect(await observer.pTTL(key)).toBeLessThanOrEqual(before);
    expect(await observer.pTTL(key)).toBeGreaterThan(0);
  });

  it("recreates an actually expired seed with its window TTL and resets at aligned boundaries", async () => {
    const driver = drivers[0]!;
    const increment = driver.increment.bind(driver);
    vi.spyOn(driver, "increment").mockImplementationOnce(async (key, amount, options) => {
      const physical = driver.parseKey(key);
      await observer.pExpire(physical, 1);
      await expect.poll(() => observer.exists(physical), { interval: 5 }).toBe(0);
      return increment(key, amount, options);
    });
    const now = 60_000;
    expect((await incrementSharedRateLimit("expiry", "source", 1000, now)).current).toBe(1);
    const keys = await observer.keys(`${prefix}.*`);
    expect(keys).toHaveLength(1);
    expect(await observer.pTTL(keys[0]!)).toBeGreaterThan(1000);
    expect((await incrementSharedRateLimit("expiry", "source", 1000, now + 1000)).current).toBe(1);
    expect(await observer.keys(`${prefix}.*`)).toHaveLength(2);
  });
});
