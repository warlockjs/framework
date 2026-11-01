import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "./cache-manager";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { MockCacheDriver } from "./drivers/mock-cache-driver";

async function makeCache() {
  const manager = new CacheManager();
  manager.setCacheConfigurations({
    default: "memory",
    logging: false,
    drivers: { memory: MemoryCacheDriver, mock: MockCacheDriver } as any,
    options: { memory: {}, mock: {} } as any,
  });
  await manager.init();

  return manager;
}

describe("cache.extend — manager and wrappers", () => {
  let cache: CacheManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    cache = await makeCache();
  });

  afterEach(async () => {
    await cache.disconnect();
    vi.useRealTimers();
  });

  it("extends a key through the manager", async () => {
    await cache.set("session.1", "alive", 10);
    vi.advanceTimersByTime(8000);

    await expect(cache.extend("session.1", "30m")).resolves.toBe(true);

    vi.advanceTimersByTime(20 * 60_000);
    await expect(cache.get("session.1")).resolves.toBe("alive");
  });

  it("returns false for a missing key", async () => {
    await expect(cache.extend("nope", 60)).resolves.toBe(false);
  });

  it("prefixes the key through a namespace", async () => {
    const scope = cache.namespace("tenant.7");

    await scope.set("session", "alive", 10);

    await expect(scope.extend("session", 3600)).resolves.toBe(true);
    await expect(cache.extend("tenant.7.session", 3600)).resolves.toBe(true);
    await expect(cache.extend("session", 3600)).resolves.toBe(false);
  });

  it("works on a tagged handle and keeps the tags", async () => {
    const tagged = cache.tags(["users"]);

    await tagged.set("user.1", "ann", 10);
    await expect(tagged.extend("user.1", 600)).resolves.toBe(true);

    vi.advanceTimersByTime(60_000);
    await expect(tagged.get("user.1")).resolves.toBe("ann");

    await tagged.invalidate();
    await expect(tagged.get("user.1")).resolves.toBeNull();
  });

  it("works on a tagged namespace", async () => {
    const tagged = cache.namespace("feed.1").tags(["unread"]);

    await tagged.set("messages", "hi", 10);
    await expect(tagged.extend("messages", 600)).resolves.toBe(true);

    vi.advanceTimersByTime(60_000);
    await expect(cache.get("feed.1.messages")).resolves.toBe("hi");
  });
});
