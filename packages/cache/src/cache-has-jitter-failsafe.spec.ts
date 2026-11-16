import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "./cache-manager";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { applyTtlJitter } from "./utils";

async function makeCache() {
  const manager = new CacheManager();
  manager.setCacheConfigurations({
    default: "memory" as any,
    logging: false,
    drivers: { memory: MemoryCacheDriver } as any,
    options: { memory: {} } as any,
  });
  await manager.init();

  return manager;
}

describe("has() uses exists()", () => {
  let cache: CacheManager;

  beforeEach(async () => {
    cache = await makeCache();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  it("emits hit and miss events without the value", async () => {
    const events: Array<{ type: string; value?: unknown }> = [];
    cache.on("hit", (data) => void events.push({ type: "hit", value: data.value }));
    cache.on("miss", (data) => void events.push({ type: "miss", value: data.value }));

    await cache.set("present", { big: "value" });

    await expect(cache.has("present")).resolves.toBe(true);
    await expect(cache.has("absent")).resolves.toBe(false);

    expect(events).toEqual([
      { type: "hit", value: undefined },
      { type: "miss", value: undefined },
    ]);
  });
});

describe("ttlJitter", () => {
  it("keeps the TTL inside the percentage and at least 1 second", () => {
    for (let index = 0; index < 200; index++) {
      const ttl = applyTtlJitter(100, 10);
      expect(ttl).toBeGreaterThanOrEqual(90);
      expect(ttl).toBeLessThanOrEqual(110);
    }

    expect(applyTtlJitter(1, 100)).toBeGreaterThanOrEqual(1);
  });

  it("leaves infinite, zero and absolute TTLs alone", () => {
    expect(applyTtlJitter(Infinity, 10)).toBe(Infinity);
    expect(applyTtlJitter(0, 10)).toBe(0);
    expect(applyTtlJitter(100, 10, Date.now() + 1000)).toBe(100);
    expect(applyTtlJitter(100, undefined)).toBe(100);
    expect(applyTtlJitter(100, 0)).toBe(100);
  });

  it("is applied to set()", async () => {
    const cache = await makeCache();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const driver = cache.currentDriver as MemoryCacheDriver;
    const entry = vi.spyOn(driver as any, "resolveSetOptions");

    await cache.set("k", "v", { ttl: 100, ttlJitter: 10 });

    expect(entry.mock.results[0]?.value.ttl).toBe(110);
    random.mockRestore();
    await cache.disconnect();
  });
});

describe("swr failSafe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the stale value when the refresh throws, and recovers afterwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = await makeCache();
    const options = { freshTtl: 10, staleTtl: 100, failSafe: true };

    await expect(cache.swr("k", options, async () => "v1")).resolves.toBe("v1");

    vi.setSystemTime(Date.now() + 20_000);

    const failing = vi.fn(async () => {
      throw new Error("upstream down");
    });
    await expect(cache.swr("k", options, failing)).resolves.toBe("v1");
    expect(failing).toHaveBeenCalledTimes(1);

    await expect(cache.swr("k", options, async () => "v2")).resolves.toBe("v2");
    await expect(cache.get("k")).resolves.toBe("v2");

    await cache.disconnect();
  });

  it("without failSafe the stale value is returned while the refresh runs in the background", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = await makeCache();
    const options = { freshTtl: 10, staleTtl: 100 };

    await cache.swr("k", options, async () => "v1");
    vi.setSystemTime(Date.now() + 20_000);

    await expect(cache.swr("k", options, async () => "v2")).resolves.toBe("v1");
    await vi.waitFor(async () => expect(await cache.get("k")).toBe("v2"));

    await cache.disconnect();
  });
});
