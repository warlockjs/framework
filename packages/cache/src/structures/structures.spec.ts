import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cache-manager";
import { FileCacheDriver } from "../drivers/file-cache-driver";
import { LRUMemoryCacheDriver } from "../drivers/lru-memory-cache-driver";
import { MemoryCacheDriver } from "../drivers/memory-cache-driver";
import { MemoryExtendedCacheDriver } from "../drivers/memory-extended-cache-driver";
import { MockCacheDriver } from "../drivers/mock-cache-driver";
import { NullCacheDriver } from "../drivers/null-cache-driver";
import { PgCacheDriver } from "../drivers/pg-cache-driver";
import { CacheConfigurationError, CacheUnsupportedError } from "../types";
import { hashPair, murmur3, probe } from "./hash";
import { HLL_REGISTERS, HyperLogLog } from "./hyperloglog";
import { structuresBackendOf } from "./structures";
import { bloomGeometry } from "./sizing";

async function makeCache(driver: any = MemoryCacheDriver, name = "memory", options: any = {}) {
  const manager = new CacheManager();
  manager.setCacheConfigurations({
    default: name as any,
    logging: false,
    drivers: { [name]: driver } as any,
    options: { [name]: options } as any,
  });
  await manager.init();

  return manager;
}

const items = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

describe("structure math", () => {
  it("hashes deterministically and matches known MurmurHash3 vectors", () => {
    expect(murmur3("", 0)).toBe(0);
    expect(murmur3("", 1)).toBe(0x514e28b7);
    expect(murmur3("hello", 0)).toBe(0x248bfa47);
    expect(hashPair("hasan")).toEqual(hashPair("hasan"));
    expect(hashPair("hasan")).not.toEqual(hashPair("hasaN"));
    expect(hashPair("x")[1] % 2).toBe(1);
  });

  it("keeps probes inside the range and spreads them", () => {
    const hashes = hashPair("item");
    const positions = Array.from({ length: 10 }, (_, index) => probe(hashes, index, 97));

    expect(positions.every((position) => position >= 0 && position < 97)).toBe(true);
    expect(new Set(positions).size).toBeGreaterThan(7);
  });

  it("sizes a Bloom filter like the documented figures", () => {
    const one = bloomGeometry(1_000_000, 0.01);
    const tenth = bloomGeometry(1_000_000, 0.001);

    expect(one.hashes).toBe(7);
    expect(one.bits / 8 / 1_000_000).toBeCloseTo(1.2, 1);
    expect(tenth.hashes).toBe(10);
    expect(tenth.bits / 8 / 1_000_000).toBeCloseTo(1.8, 1);
  });

  it("rejects an invalid geometry", () => {
    expect(() => bloomGeometry(0, 0.01)).toThrow(CacheConfigurationError);
    expect(() => bloomGeometry(100, 1.5)).toThrow(CacheConfigurationError);
  });

  it("estimates distinct counts within the HyperLogLog error bound", () => {
    for (const size of [10, 1_000, 50_000]) {
      const counter = new HyperLogLog();

      for (const item of items("user", size)) {
        counter.add(item);
        counter.add(item); // duplicates change nothing
      }

      const error = Math.abs(counter.count() - size) / size;

      expect(error).toBeLessThan(size <= 1_000 ? 0.04 : 0.03);
    }
  });

  it("merges counters into the union", () => {
    const a = new HyperLogLog();
    const b = new HyperLogLog();

    items("a", 5_000).forEach((item) => a.add(item));
    [...items("a", 2_500), ...items("b", 5_000)].forEach((item) => b.add(item));

    const merged = new HyperLogLog(new Uint8Array(a.registers)).merge(b);

    expect(Math.abs(merged.count() - 10_000) / 10_000).toBeLessThan(0.03);
    expect(a.registers).toHaveLength(HLL_REGISTERS);
  });
});

describe("cache.structures on the memory driver", () => {
  let cache: CacheManager;

  beforeEach(async () => {
    cache = await makeCache();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe("bloom", () => {
    it("never forgets an added item and stays near the configured false-positive rate", async () => {
      const filter = cache.structures.bloom("names", { expectedItems: 20_000, errorRate: 0.01 });
      const added = items("name", 20_000);

      for (const item of added) {
        await filter.add(item);
      }

      for (const item of added) {
        expect(await filter.mightContain(item)).toBe(true);
      }

      let falsePositives = 0;
      const probes = items("other", 20_000);

      for (const item of probes) {
        if (await filter.mightContain(item)) {
          falsePositives++;
        }
      }

      expect(falsePositives / probes.length).toBeLessThan(0.02);
    });

    it("reports whether an add was new", async () => {
      const filter = cache.structures.bloom("names", { expectedItems: 1000 });

      expect(await filter.add("hasan")).toBe(true);
      expect(await filter.add("hasan")).toBe(false);
    });

    it("accepts numbers and strings alike", async () => {
      const filter = cache.structures.bloom("ids", { expectedItems: 1000 });

      await filter.add(42);

      expect(await filter.mightContain("42")).toBe(true);
    });

    it("keeps separate keys apart", async () => {
      await cache.structures.bloom("a", { expectedItems: 100 }).add("x");

      expect(await cache.structures.bloom("b", { expectedItems: 100 }).mightContain("x")).toBe(false);
    });

    it("expires with its ttl, counted from the first write", async () => {
      vi.useFakeTimers();

      try {
        const filter = cache.structures.bloom("temp", { expectedItems: 100, ttl: "10s" });

        await filter.add("x");
        vi.advanceTimersByTime(6000);
        await filter.add("y"); // does not push the deadline back
        vi.advanceTimersByTime(5000);

        expect(await filter.mightContain("x")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects invalid sizing", () => {
      expect(() => cache.structures.bloom("x", { expectedItems: 0 })).toThrow(
        CacheConfigurationError,
      );
    });
  });

  describe("cuckoo", () => {
    it("adds, checks and removes", async () => {
      const banned = cache.structures.cuckoo("banned", { expectedItems: 1000 });

      await banned.add("u1");
      await banned.add("u2");

      expect(await banned.mightContain("u1")).toBe(true);
      expect(await banned.remove("u1")).toBe(true);
      expect(await banned.mightContain("u1")).toBe(false);
      expect(await banned.mightContain("u2")).toBe(true);
    });

    it("counts duplicate adds so one removal does not hide the item", async () => {
      const filter = cache.structures.cuckoo("dupes", { expectedItems: 1000 });

      await filter.add("x");
      await filter.add("x");
      await filter.remove("x");

      expect(await filter.mightContain("x")).toBe(true);
    });

    it("refuses to remove an item that was never added", async () => {
      const filter = cache.structures.cuckoo("clean", { expectedItems: 1000 });

      await filter.add("kept");

      expect(await filter.remove("never-added")).toBe(false);
      expect(await filter.mightContain("kept")).toBe(true);
    });
  });

  describe("uniqueCounter", () => {
    it("counts distinct values", async () => {
      const dau = cache.structures.uniqueCounter("dau");

      for (const id of items("user", 3000)) {
        await dau.add(id);
        await dau.add(id);
      }

      expect(Math.abs((await dau.count()) - 3000) / 3000).toBeLessThan(0.04);
    });

    it("counts nothing for an unknown key", async () => {
      expect(await cache.structures.uniqueCounter("empty").count()).toBe(0);
    });

    it("merges counters without changing them", async () => {
      const monday = cache.structures.uniqueCounter("dau.mon");
      const tuesday = cache.structures.uniqueCounter("dau.tue");

      for (const id of items("u", 2000)) await monday.add(id);
      for (const id of items("u", 3000)) await tuesday.add(id); // 2000 overlap

      const week = await cache.structures.uniqueCounter.merge(["dau.mon", "dau.tue"]).count();

      expect(Math.abs(week - 3000) / 3000).toBeLessThan(0.04);
      expect(Math.abs((await monday.count()) - 2000) / 2000).toBeLessThan(0.04);
    });

    it("accepts several values at once", async () => {
      const counter = cache.structures.uniqueCounter("many");

      await counter.add("a", "b", 3);

      expect(await counter.count()).toBe(3);
    });
  });

  describe("frequency", () => {
    it("never estimates below the true count", async () => {
      const tracker = cache.structures.frequency("terms", { width: 200, depth: 4 });
      const truth = new Map<string, number>();

      for (let index = 0; index < 1500; index++) {
        const term = `term-${(index * 7919) % 400}`;
        const count = (index % 5) + 1;

        truth.set(term, (truth.get(term) ?? 0) + count);
        await tracker.add(term, count);
      }

      for (const [term, count] of truth) {
        expect(await tracker.estimate(term)).toBeGreaterThanOrEqual(count);
      }
    });

    it("keeps the over-count small with the default dimensions", async () => {
      const tracker = cache.structures.frequency("terms");
      const total = 3000;

      for (let index = 0; index < total; index++) {
        await tracker.add(`term-${index % 600}`);
      }

      // each of the 600 terms was seen 5 times
      const estimate = await tracker.estimate("term-1");

      expect(estimate).toBeGreaterThanOrEqual(5);
      expect(estimate - 5).toBeLessThanOrEqual(total * 0.01);
    });

    it("estimates 0 for a value never seen", async () => {
      expect(await cache.structures.frequency("empty").estimate("x")).toBe(0);
    });

    it("lists the most frequent values, highest first", async () => {
      const tracker = cache.structures.frequency("terms", { topK: 3 });
      const plan: Record<string, number> = { laptop: 50, phone: 30, tablet: 20, cable: 5, mouse: 2 };

      for (const [term, count] of Object.entries(plan)) {
        for (let index = 0; index < count; index++) {
          await tracker.add(term);
        }
      }

      expect(await tracker.top(10)).toEqual([
        { value: "laptop", count: 50 },
        { value: "phone", count: 30 },
        { value: "tablet", count: 20 },
      ]);
      expect(await tracker.top(2)).toHaveLength(2);
    });

    it("lets a late riser into the top list", async () => {
      const tracker = cache.structures.frequency("terms", { topK: 2 });

      await tracker.add("a", 5);
      await tracker.add("b", 4);
      await tracker.add("c", 1);
      await tracker.add("c", 9);

      expect((await tracker.top()).map((entry) => entry.value)).toEqual(["c", "a"]);
    });

    it("rejects invalid dimensions and counts", async () => {
      expect(() => cache.structures.frequency("x", { width: 0 })).toThrow(CacheConfigurationError);
      await expect(cache.structures.frequency("x").add("a", 0)).rejects.toThrow(
        CacheConfigurationError,
      );
    });
  });

  describe("prefix and lifecycle", () => {
    it("honours the driver's global prefix and keeps structure keys out of plain keys", async () => {
      const prefixed = await makeCache(MemoryCacheDriver, "memory", { globalPrefix: "app" });

      await prefixed.structures.bloom("names", { expectedItems: 100 }).add("x");

      const driver = prefixed.currentDriver as MemoryCacheDriver;
      const slots = (driver as any).structureStore.slots as Map<string, unknown>;

      expect([...slots.keys()]).toEqual(["app.structures.bloom.names"]);
      await expect(prefixed.get("names")).resolves.toBeNull();
      await prefixed.disconnect();
    });

    it("is cleared by flush()", async () => {
      const filter = cache.structures.bloom("names", { expectedItems: 100 });

      await filter.add("x");
      await cache.flush();

      expect(await filter.mightContain("x")).toBe(false);
    });

    it("is cleared by removing the namespace that holds it", async () => {
      const prefixed = await makeCache(MemoryCacheDriver, "memory", { globalPrefix: "app" });

      await prefixed.structures.uniqueCounter("dau").add("x");
      await prefixed.currentDriver!.removeNamespace("structures");

      expect(await prefixed.structures.uniqueCounter("dau").count()).toBe(0);
      await prefixed.disconnect();
    });
  });
});

describe("cache.structures on the other memory drivers", () => {
  it.each([
    ["memoryExtended", MemoryExtendedCacheDriver],
    ["lru", LRUMemoryCacheDriver],
  ])("supports %s", async (name, driver) => {
    const cache = await makeCache(driver, name);

    await cache.structures.bloom("b", { expectedItems: 100 }).add("x");
    await cache.structures.uniqueCounter("u").add("x");
    await cache.structures.frequency("f").add("x", 3);

    expect(await cache.structures.bloom("b", { expectedItems: 100 }).mightContain("x")).toBe(true);
    expect(await cache.structures.uniqueCounter("u").count()).toBe(1);
    expect(await cache.structures.frequency("f").estimate("x")).toBe(3);

    await cache.flush();
    expect(await cache.structures.uniqueCounter("u").count()).toBe(0);
    await cache.disconnect();
  });
});

describe("cache.structures on unsupported drivers", () => {
  it.each([
    ["null", () => new NullCacheDriver()],
    ["mock", () => new MockCacheDriver()],
    ["file", () => new FileCacheDriver()],
    ["pg", () => new PgCacheDriver()],
  ])("throws CacheUnsupportedError naming the %s driver", (name, create) => {
    expect(() => structuresBackendOf(create())).toThrow(CacheUnsupportedError);
    expect(() => structuresBackendOf(create())).toThrow(`'${name}' driver`);
  });

  it("throws on first use through the manager", async () => {
    const cache = await makeCache(NullCacheDriver, "null");
    const filter = cache.structures.bloom("names", { expectedItems: 100 });

    await expect(filter.add("x")).rejects.toThrow(CacheUnsupportedError);
    await expect(cache.structures.uniqueCounter("u").count()).rejects.toThrow(
      CacheUnsupportedError,
    );

    await cache.disconnect();
  });

  it("does not require custom drivers to change", () => {
    expect(() => structuresBackendOf({ name: "custom" })).toThrow(CacheUnsupportedError);
  });
});
