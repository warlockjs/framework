import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RedisCacheDriver } from "./redis-cache-driver";

const enabled = process.env.WARLOCK_REDIS_INTEGRATION === "1";
const host = process.env.QUEUE_REDIS_HOST ?? "127.0.0.1";
const port = Number(process.env.QUEUE_REDIS_PORT ?? 6390);
const prefix = `integration.cache.${randomUUID()}`;
const observer = createClient({
  socket: { host, port, connectTimeout: 1000, reconnectStrategy: false },
});
observer.on("error", () => {});
const drivers = [new RedisCacheDriver(), new RedisCacheDriver()];

if (!enabled)
  console.info(
    "Redis counter integration skipped; set WARLOCK_REDIS_INTEGRATION=1 to run against Redis.",
  );

describe.skipIf(!enabled)("real Redis expiring counters", () => {
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
  afterEach(async () => {
    if (observer.isOpen) {
      const keys = await observer.keys(`${prefix}.*`);
      if (keys.length) await observer.del(keys);
    }
  });
  afterAll(async () => {
    await Promise.all(drivers.map((driver) => driver.disconnect()));
    if (observer.isOpen) await observer.quit();
  });

  it("atomically counts across separate clients and preserves an established deadline", async () => {
    const first = drivers[0]!;
    const key = first.parseKey("shared");
    const values = await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        drivers[index % 2]!.increment("shared", 1, { ttl: "1m" }),
      ),
    );
    expect(new Set(values).size).toBe(80);
    expect(await observer.get(key)).toBe("80");
    await observer.pExpire(key, 5000);
    const before = await observer.pTTL(key);
    await drivers[1]!.increment("shared", 1, { ttl: "1d" });
    expect(await observer.pTTL(key)).toBeLessThanOrEqual(before);
    expect(await observer.pTTL(key)).toBeGreaterThan(0);
  });

  it("recreates expired seeds and repairs permanent counters without a driver default TTL", async () => {
    const driver = drivers[0]!;
    const key = driver.parseKey("window");
    await driver.set("window", 0, 60);
    await observer.pExpire(key, 1);
    await expect.poll(() => observer.exists(key), { interval: 5 }).toBe(0);
    expect(await driver.increment("window", 1, { ttl: "1m" })).toBe(1);
    expect(await observer.pTTL(key)).toBeGreaterThan(59_000);
    await observer.persist(key);
    expect(await observer.pTTL(key)).toBe(-1);
    expect(await drivers[1]!.increment("window", 1, { ttl: "1m" })).toBe(2);
    expect(await observer.pTTL(key)).toBeGreaterThan(59_000);
  });
});
