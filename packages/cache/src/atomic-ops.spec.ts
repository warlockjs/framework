import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCacheDriver } from "./drivers/file-cache-driver";
import { LRUMemoryCacheDriver } from "./drivers/lru-memory-cache-driver";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { MockCacheDriver } from "./drivers/mock-cache-driver";
import { ScopedCache } from "./scoped-cache";
import type { CacheDriver } from "./types";
import { CacheConfigurationError } from "./types";

/**
 * Wave-2 of the 2026-09-24 cache review: increment / pull / update must not
 * lose updates or hand a value out twice, and remember / swr / lock must not
 * share in-flight bookkeeping.
 */

const directories: string[] = [];

type AnyDriver = CacheDriver<any, any>;

function memory(): AnyDriver {
  const driver = new MemoryCacheDriver();
  driver.setOptions({});
  driver.setLoggingState(false);
  return driver;
}

function lru(): AnyDriver {
  const driver = new LRUMemoryCacheDriver();
  driver.setOptions({ capacity: 100 });
  driver.setLoggingState(false);
  return driver;
}

function mock(): AnyDriver {
  const driver = new MockCacheDriver();
  driver.setLoggingState(false);
  return driver;
}

async function file(): Promise<AnyDriver> {
  const directory = mkdtempSync(join(tmpdir(), "warlock-cache-atomic-"));
  directories.push(directory);
  const driver = new FileCacheDriver();
  driver.setOptions({ directory: () => directory });
  driver.setLoggingState(false);
  await driver.connect();
  return driver;
}

/** Private `getEntry` reader — the metadata-aware drivers expose `expiresAt` through it. */
async function expiresAtOf(driver: AnyDriver, key: string): Promise<number | undefined> {
  const entry = await (driver as any).getEntry(key);
  return entry?.expiresAt;
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.each([
  { name: "memory", make: async () => memory(), callers: 25 },
  { name: "lru", make: async () => lru(), callers: 25 },
  { name: "mock", make: async () => mock(), callers: 25 },
  // Disk-backed and serialized: fewer callers keep it well inside the timeout.
  { name: "file (base default, in-process serialized)", make: file, callers: 8 },
])("$name — atomic ops", ({ make, callers }) => {
  it("concurrent increments never lose an update", async () => {
    const driver = await make();

    const results = await Promise.all(
      Array.from({ length: callers }, () => driver.increment("hits")),
    );

    await expect(driver.get("hits")).resolves.toBe(callers);
    // Every caller saw a distinct running total.
    expect(new Set(results).size).toBe(callers);
  }, 20000);

  it("applies a per-call TTL when a seeded counter expired before increment", async () => {
    const driver = await make();
    await driver.set("window", 20, 1);
    // An expired seed and a missing key have the same atomic-increment path.
    await driver.remove("window");
    const started = Date.now();
    await expect(driver.increment("window", 1, { ttl: "2m" })).resolves.toBe(1);
    const expiry = await expiresAtOf(driver, "window");
    expect(expiry).toBeGreaterThanOrEqual(started + 119_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 120_000);
    await driver.increment("window", 1, { ttl: "1d" });
    expect(Math.abs((await expiresAtOf(driver, "window"))! - expiry!)).toBeLessThanOrEqual(1000);
  });

  it("forwards per-call TTL through scoped and tagged counters", async () => {
    const driver = await make();
    const scope = new ScopedCache(driver, "namespace", { ttl: "5m" });
    await scope.increment("default");
    expect(await expiresAtOf(driver, "namespace.default")).toBeGreaterThan(Date.now() + 299_000);
    await scope.tags(["counters"]).increment("explicit", 2, { ttl: "1m" });
    expect(await driver.get("namespace.explicit")).toBe(2);
    const expiry = await expiresAtOf(driver, "namespace.explicit");
    expect(expiry).toBeGreaterThan(Date.now() + 59_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("increment keeps the existing entry's expiry", async () => {
    const driver = await make();

    await driver.set("window", 1, 60);
    const before = await expiresAtOf(driver, "window");

    await driver.increment("window", 2);

    await expect(driver.get("window")).resolves.toBe(3);
    const after = await expiresAtOf(driver, "window");
    expect(before).toBeDefined();
    // Same deadline (allowing for a whole-second re-derivation on drivers
    // that rewrite with the remaining TTL).
    expect(Math.abs((after as number) - (before as number))).toBeLessThanOrEqual(1000);
  });

  it("increment still rejects a non-numeric value", async () => {
    const driver = await make();

    await driver.set("label", "x");

    await expect(driver.increment("label")).rejects.toThrow(/Cannot increment/);
  });

  it("pull hands a value out exactly once under concurrency", async () => {
    const driver = await make();

    await driver.set("token", "t-1");

    const results = await Promise.all([driver.pull("token"), driver.pull("token")]);

    expect(results.filter((value) => value === "t-1")).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    await expect(driver.get("token")).resolves.toBeNull();
  });
});

describe("remember / swr / update / lock bookkeeping (memory driver)", () => {
  it("remember caches falsy values (0, false, empty string)", async () => {
    const driver = memory();

    for (const [key, value] of [
      ["zero", 0],
      ["no", false],
      ["empty", ""],
    ] as const) {
      const callback = vi.fn(async () => value);

      await expect(driver.remember(key, 60, callback)).resolves.toBe(value);
      await expect(driver.remember(key, 60, callback)).resolves.toBe(value);
      expect(callback).toHaveBeenCalledTimes(1);
    }
  });

  it("remember never breaks a running update chain", async () => {
    const driver = memory();
    const order: string[] = [];

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const first = driver.update<number>("k", async (current) => {
      await gate;
      order.push("A-end");
      return (current ?? 0) + 1;
    });

    // A remember on the same (still missing) key registers its own in-flight
    // computation; it must not become the tail the next update chains onto.
    const remembered = driver.remember("k", 60, async () => 100);

    const second = driver.update<number>("k", async (current) => {
      order.push("B-start");
      return (current ?? 0) + 1;
    });

    await remembered;
    openGate();
    await Promise.all([first, second]);

    expect(order).toEqual(["A-end", "B-start"]);
  });

  it("swr cold misses share one fetch", async () => {
    const driver = memory();
    const fetcher = vi.fn(async () => "v");

    const results = await Promise.all([
      driver.swr("k", { freshTtl: 10, staleTtl: 60 }, fetcher),
      driver.swr("k", { freshTtl: 10, staleTtl: 60 }, fetcher),
    ]);

    expect(results).toEqual(["v", "v"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a lock release error does not replace fn's result", async () => {
    const driver = memory();

    vi.spyOn(driver as any, "deleteIfEquals").mockRejectedValue(new Error("redis blip"));

    await expect(driver.lock("job", "1m", async () => "done")).resolves.toEqual({
      acquired: true,
      value: "done",
    });
  });

  it("a lock release error does not replace fn's error", async () => {
    const driver = memory();

    vi.spyOn(driver as any, "deleteIfEquals").mockRejectedValue(new Error("redis blip"));

    await expect(
      driver.lock("job", "1m", async () => {
        throw new Error("job failed");
      }),
    ).rejects.toThrow("job failed");
  });

  it("lock refuses a ttl that never expires", async () => {
    const driver = memory();
    const work = vi.fn(async () => "x");

    await expect(driver.lock("job", Infinity, work)).rejects.toThrow(CacheConfigurationError);
    await expect(driver.lock("job", 0, work)).rejects.toThrow(CacheConfigurationError);
    expect(work).not.toHaveBeenCalled();
  });
});

describe("base increment (file driver) — one read for value and deadline", () => {
  it("starts a counter over when it expired between the read and the write", async () => {
    const driver = await file();

    await driver.set("throttle", 5, 60);
    // the entry read is already past its deadline by the time it is used
    vi.spyOn(driver as any, "getEntry").mockResolvedValueOnce({
      data: 5,
      expiresAt: Date.now() - 1,
    });

    await expect(driver.increment("throttle")).resolves.toBe(1);
  });

  it("rounds the remaining TTL down, so increments never push the deadline later", async () => {
    const driver = await file();

    await driver.set("window", 0, 60);
    // 59.5 s left: rounding up (the old behaviour) re-wrote it as 60 s,
    // stretching the window by up to a second on every increment
    vi.spyOn(driver as any, "getEntry").mockResolvedValueOnce({
      data: 0,
      expiresAt: Date.now() + 59_500,
    });
    const set = vi.spyOn(driver, "set");

    await driver.increment("window");

    expect(set).toHaveBeenCalledWith("window", 1, { ttl: 59 });
  });
});
