import { cache, RedisCacheDriver } from "@warlock.js/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loginThrottleMiddleware, throttleIdentifierHash } from "./login-throttle.middleware";
import { makeCtx } from "./test-support/make-ctx";

vi.mock("@warlock.js/core", () => ({ t: (key: string) => key }));

const enabled = process.env.WARLOCK_REDIS_INTEGRATION === "1";
const host = process.env.QUEUE_REDIS_HOST ?? "127.0.0.1";
const port = Number(process.env.QUEUE_REDIS_PORT ?? 6390);
const prefix = `integration.login.${randomUUID()}`;
const email = `member-${randomUUID()}@example.invalid`;
const previousDriver = cache.currentDriver;
const observer = createClient({
  socket: { host, port, connectTimeout: 1000, reconnectStrategy: false },
});
observer.on("error", () => {});
const drivers = [new RedisCacheDriver(), new RedisCacheDriver()];

type SentCallback = (response: TestResponse) => unknown;
type TestResponse = {
  isOk: boolean;
  onSent(callback: SentCallback): void;
  tooManyRequests: ReturnType<typeof vi.fn>;
  fireSent(): Promise<void>;
};
function response(isOk: boolean): TestResponse {
  const callbacks: SentCallback[] = [];
  const result: TestResponse = {
    isOk,
    onSent: (callback) => {
      callbacks.push(callback);
    },
    tooManyRequests: vi.fn(),
    async fireSent() {
      for (const callback of callbacks) await callback(result);
    },
  };
  return result;
}
const request = {
  input: (key: string) => (key === "email" ? email : undefined),
  detectIp: () => "127.0.0.1",
};

if (!enabled)
  console.info(
    "Redis login-throttle integration skipped; set WARLOCK_REDIS_INTEGRATION=1 to run against Redis.",
  );

describe.skipIf(!enabled)("real Redis login throttles", () => {
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

  it("shares failed attempts and lockouts between clients and resets after successful login", async () => {
    const throttle = loginThrottleMiddleware({
      by: ["email"],
      max: 3,
      window: "30s",
      lockoutDuration: "1s",
    });
    for (let index = 0; index < 3; index++) {
      await cache.use(drivers[index % 2]!);
      const failed = response(false);
      await throttle(makeCtx({ request, response: failed }));
      expect(failed.tooManyRequests).not.toHaveBeenCalled();
      await failed.fireSent();
    }
    const hash = throttleIdentifierHash("email", email);
    const counter = drivers[0]!.parseKey(`auth.throttle.count.email.${hash}`);
    const lock = drivers[0]!.parseKey(`auth.throttle.lock.email.${hash}`);
    expect(await observer.get(counter)).toBe("3");
    expect(await observer.pTTL(lock)).toBeGreaterThan(0);
    const blocked = response(false);
    await throttle(makeCtx({ request, response: blocked }));
    expect(blocked.tooManyRequests).toHaveBeenCalledOnce();
    await observer.pExpire(lock, 1);
    await expect.poll(() => observer.exists(lock), { interval: 5 }).toBe(0);
    const success = response(true);
    await throttle(makeCtx({ request, response: success }));
    expect(success.tooManyRequests).not.toHaveBeenCalled();
    await success.fireSent();
    expect(await observer.exists([counter, lock])).toBe(0);
  });

  it("keeps concurrent failure counts exact and does not extend the counting window", async () => {
    const throttle = loginThrottleMiddleware({ by: ["email"], max: 100, window: "30s" });
    const fail = async () => {
      const failed = response(false);
      await throttle(makeCtx({ request, response: failed }));
      await failed.fireSent();
    };
    await fail();
    const counter = drivers[0]!.parseKey(
      `auth.throttle.count.email.${throttleIdentifierHash("email", email)}`,
    );
    await observer.pExpire(counter, 5000);
    const before = await observer.pTTL(counter);
    await cache.use(drivers[1]!);
    await Promise.all(Array.from({ length: 20 }, fail));
    expect(await observer.get(counter)).toBe("21");
    expect(await observer.pTTL(counter)).toBeLessThanOrEqual(before);
    expect(await observer.pTTL(counter)).toBeGreaterThan(0);
  });

  it("recreates an expired seed with the configured window TTL on the actual atomic bump", async () => {
    const driver = drivers[0]!;
    const increment = driver.increment.bind(driver);
    vi.spyOn(driver, "increment").mockImplementationOnce(async (key, amount, options) => {
      const physical = driver.parseKey(key);
      await observer.pExpire(physical, 1);
      await expect.poll(() => observer.exists(physical), { interval: 5 }).toBe(0);
      return increment(key, amount, options);
    });
    const throttle = loginThrottleMiddleware({ by: ["email"], max: 100, window: "30s" });
    const failed = response(false);
    await throttle(makeCtx({ request, response: failed }));
    await failed.fireSent();
    const counter = driver.parseKey(
      `auth.throttle.count.email.${throttleIdentifierHash("email", email)}`,
    );
    expect(await observer.get(counter)).toBe("1");
    expect(await observer.pTTL(counter)).toBeGreaterThan(29_000);
  });
});
