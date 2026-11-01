import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache, CacheManager, idempotent } from "./cache-manager";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { CacheConcurrencyError, CacheConfigurationError } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("idempotent()", () => {
  beforeEach(async () => {
    cache.setCacheConfigurations({
      default: "memory",
      logging: false,
      drivers: { memory: MemoryCacheDriver } as any,
      options: { memory: {} } as any,
    });
    await cache.init();
  });

  afterEach(async () => {
    await cache.flush();
    await cache.disconnect();
  });

  it("shares one run between concurrent calls with the same key", async () => {
    const gate = deferred<string>();
    const fn = vi.fn(() => gate.promise);

    const calls = [1, 2, 3].map(() => idempotent("charge.1", fn, { ttl: "1h" }));
    gate.resolve("paid");

    await expect(Promise.all(calls)).resolves.toEqual(["paid", "paid", "paid"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns the stored result for repeat calls within ttl", async () => {
    const fn = vi.fn(async () => ({ id: 7 }));

    const first = await cache.idempotent("charge.2", fn, { ttl: 60 });
    const second = await cache.idempotent("charge.2", fn, { ttl: 60 });

    expect(first).toEqual({ id: 7 });
    expect(second).toEqual({ id: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again after ttl passes", async () => {
    vi.useFakeTimers();

    try {
      const fn = vi.fn(async () => "x");

      await cache.idempotent("charge.3", fn, { ttl: 10 });
      vi.advanceTimersByTime(11_000);
      await cache.idempotent("charge.3", fn, { ttl: 10 });

      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps different keys apart", async () => {
    const fn = vi.fn(async () => "x");

    await cache.idempotent("a", fn, { ttl: 60 });
    await cache.idempotent("b", fn, { ttl: 60 });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("accepts object keys", async () => {
    const fn = vi.fn(async () => "x");

    await cache.idempotent({ order: 1 }, fn, { ttl: 60 });
    await cache.idempotent({ order: 1 }, fn, { ttl: 60 });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stores falsy and undefined results", async () => {
    for (const [key, value] of [
      ["zero", 0],
      ["no", false],
      ["empty", ""],
      ["none", null],
      ["undef", undefined],
    ] as const) {
      const fn = vi.fn(async () => value);

      expect(await cache.idempotent(key, fn, { ttl: 60 })).toBe(value);
      expect(await cache.idempotent(key, fn, { ttl: 60 })).toBe(value);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("does not store a failure: every sharer gets the error and the next call reruns", async () => {
    const gate = deferred<string>();
    const failing = vi.fn(() => gate.promise);

    const calls = [
      cache.idempotent("charge.4", failing, { ttl: 60 }),
      cache.idempotent("charge.4", failing, { ttl: 60 }),
    ];
    const settled = Promise.allSettled(calls);
    gate.reject(new Error("gateway down"));

    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(failing).toHaveBeenCalledTimes(1);

    const retry = vi.fn(async () => "ok");
    await expect(cache.idempotent("charge.4", retry, { ttl: 60 })).resolves.toBe("ok");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  describe("ttl: 0", () => {
    it("shares in-flight runs", async () => {
      const gate = deferred<string>();
      const fn = vi.fn(() => gate.promise);

      const calls = [cache.idempotent("k", fn, { ttl: 0 }), cache.idempotent("k", fn, { ttl: 0 })];
      gate.resolve("v");

      await expect(Promise.all(calls)).resolves.toEqual(["v", "v"]);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("runs again once the first run finished and never touches the store", async () => {
      const setSpy = vi.spyOn(cache.currentDriver!, "set");
      const getSpy = vi.spyOn(cache.currentDriver!, "get");
      const fn = vi.fn(async () => "v");

      await cache.idempotent("k", fn, { ttl: 0 });
      await cache.idempotent("k", fn, { ttl: 0 });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(setSpy).not.toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  it("stores the result in the cache store under the idempotent. namespace", async () => {
    await cache.idempotent("charge.5", async () => "paid", { ttl: 60 });

    await expect(cache.get("idempotent.charge.5")).resolves.toEqual({
      idempotent: true,
      result: "paid",
    });
  });

  it("rejects an invalid ttl", async () => {
    await expect(cache.idempotent("k", async () => 1, { ttl: -1 })).rejects.toThrow(
      CacheConfigurationError,
    );
  });

  it("honours the driver option", async () => {
    cache.setCacheConfigurations({
      default: "memory",
      logging: false,
      drivers: { memory: MemoryCacheDriver, alt: MemoryCacheDriver } as any,
      options: { memory: {}, alt: {} } as any,
    });
    await cache.init();

    await cache.idempotent("k", async () => "v", { ttl: 60, driver: "alt" });

    await expect(cache.get("idempotent.k")).resolves.toBeNull();
    const alt = await cache.load("alt");
    await expect(alt.get("idempotent.k")).resolves.toMatchObject({ result: "v" });
  });

  describe("distributed", () => {
    it("runs once across two managers sharing one store", async () => {
      // two "servers": separate in-flight maps, one shared driver instance
      const shared = new MemoryCacheDriver();
      shared.setOptions({});
      shared.setLoggingState(false);

      const serverA = new CacheManager();
      const serverB = new CacheManager();

      for (const server of [serverA, serverB]) {
        server.currentDriver = shared;
        server.loadedDrivers.memory = shared;
      }

      const gate = deferred<string>();
      const fn = vi.fn(() => gate.promise);
      const options = { ttl: 60, distributed: true, lockTtl: 5 } as const;

      const first = serverA.idempotent("pay.1", fn, options);
      const second = serverB.idempotent("pay.1", fn, options);

      await new Promise((resolve) => setTimeout(resolve, 60));
      gate.resolve("paid");

      await expect(Promise.all([first, second])).resolves.toEqual(["paid", "paid"]);
      expect(fn).toHaveBeenCalledTimes(1);

      await shared.disconnect();
    });

    it("lets a waiter take over when the lock holder fails", async () => {
      const shared = new MemoryCacheDriver();
      shared.setOptions({});
      shared.setLoggingState(false);

      const serverA = new CacheManager();
      const serverB = new CacheManager();

      for (const server of [serverA, serverB]) {
        server.currentDriver = shared;
        server.loadedDrivers.memory = shared;
      }

      const gate = deferred<string>();
      const failing = vi.fn(() => gate.promise);
      const working = vi.fn(async () => "recovered");
      const options = { ttl: 60, distributed: true, lockTtl: 5 } as const;

      const first = serverA.idempotent("pay.2", failing, options);
      const second = serverB.idempotent("pay.2", working, options);

      await new Promise((resolve) => setTimeout(resolve, 60));
      gate.reject(new Error("boom"));

      await expect(first).rejects.toThrow("boom");
      await expect(second).resolves.toBe("recovered");

      await shared.disconnect();
    });

    it("gives up with CacheConcurrencyError when the lock is never released in time", async () => {
      await cache.set("idempotent.lock.stuck", "someone-else", 60);

      await expect(
        cache.idempotent("stuck", async () => "v", { ttl: 60, distributed: true, lockTtl: 1 }),
      ).rejects.toThrow(CacheConcurrencyError);
    });
  });
});
