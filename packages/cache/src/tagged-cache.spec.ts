import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { TaggedCache } from "./tagged-cache";

describe("TaggedCache", () => {
  let driver: MemoryCacheDriver;

  beforeEach(() => {
    driver = new MemoryCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(false);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it("stores values and tracks tag relationships", async () => {
    const tagged = new TaggedCache(["users"], driver);
    await tagged.set("user:1", { name: "John" });
    await tagged.set("user:2", { name: "Jane" });

    await expect(tagged.get("user:1")).resolves.toEqual({ name: "John" });
    await expect(tagged.get("user:2")).resolves.toEqual({ name: "Jane" });
  });

  it("invalidate clears every tagged key", async () => {
    const tagged = new TaggedCache(["products"], driver);
    await tagged.set("p1", 1);
    await tagged.set("p2", 2);

    await tagged.invalidate();

    await expect(tagged.get("p1")).resolves.toBeNull();
    await expect(tagged.get("p2")).resolves.toBeNull();
  });

  it("flush is an alias for invalidate", async () => {
    const tagged = new TaggedCache(["x"], driver);
    await tagged.set("k", 1);
    await tagged.flush();
    await expect(tagged.get("k")).resolves.toBeNull();
  });

  it("remove drops the key and cleans the tag map", async () => {
    const tagged = new TaggedCache(["users"], driver);
    await tagged.set("u1", 1);
    await tagged.set("u2", 2);

    await tagged.remove("u1");

    await expect(tagged.get("u1")).resolves.toBeNull();
    await expect(tagged.get("u2")).resolves.toBe(2);
  });

  it("has returns the driver result", async () => {
    const tagged = new TaggedCache(["a"], driver);
    await tagged.set("k", "v");
    await expect(tagged.has("k")).resolves.toBe(true);
    await expect(tagged.has("nope")).resolves.toBe(false);
  });

  it("remember caches the callback result", async () => {
    const tagged = new TaggedCache(["users"], driver);
    let calls = 0;

    const first = await tagged.remember("u1", 60, async () => {
      calls++;
      return "computed";
    });

    const second = await tagged.remember("u1", 60, async () => {
      calls++;
      return "other";
    });

    expect(first).toBe("computed");
    expect(second).toBe("computed");
    expect(calls).toBe(1);
  });

  it("pull returns then removes the value", async () => {
    const tagged = new TaggedCache(["users"], driver);
    await tagged.set("k", "v");
    await expect(tagged.pull("k")).resolves.toBe("v");
    await expect(tagged.get("k")).resolves.toBeNull();
  });

  it("pull on a missing key returns null", async () => {
    const tagged = new TaggedCache(["users"], driver);
    await expect(tagged.pull("missing")).resolves.toBeNull();
  });

  it("forever stores without expiration", async () => {
    const tagged = new TaggedCache(["users"], driver);
    await tagged.forever("k", "v");
    await expect(tagged.get("k")).resolves.toBe("v");
  });

  it("increment treats missing key as zero", async () => {
    const tagged = new TaggedCache(["counters"], driver);
    await expect(tagged.increment("c")).resolves.toBe(1);
    await expect(tagged.increment("c", 4)).resolves.toBe(5);
  });

  it("decrement subtracts by the supplied amount", async () => {
    const tagged = new TaggedCache(["counters"], driver);
    await tagged.set("c", 10);
    await expect(tagged.decrement("c", 3)).resolves.toBe(7);
  });

  it("increment rejects non-numeric values", async () => {
    const tagged = new TaggedCache(["counters"], driver);
    await tagged.set("c", "abc");
    await expect(tagged.increment("c")).rejects.toThrow(/Cannot increment/);
  });

  it("invalidate only affects keys under the current tags", async () => {
    const users = new TaggedCache(["users"], driver);
    const orders = new TaggedCache(["orders"], driver);

    await users.set("u1", 1);
    await orders.set("o1", 2);

    await users.invalidate();

    await expect(users.get("u1")).resolves.toBeNull();
    await expect(orders.get("o1")).resolves.toBe(2);
  });

  it("invalidate is a no-op when the tag index was never written", async () => {
    const tagged = new TaggedCache(["never-used"], driver);
    // No prior set under this tag — exercises the empty tag-index fallback.
    await expect(tagged.invalidate()).resolves.toBeUndefined();
  });

  it("remove tolerates a key whose tag index does not exist", async () => {
    const tagged = new TaggedCache(["ghosts"], driver);
    // Removing an untagged/never-written key hits the `|| []` fallback in the
    // tag-relationship cleanup loop without throwing.
    await expect(tagged.remove("phantom")).resolves.toBeUndefined();
  });

  it("set with multiple tags indexes the key under each tag", async () => {
    const tagged = new TaggedCache(["a", "b"], driver);
    await tagged.set("k", "v");

    const aIndex = await driver.tagMembers("cache:tags:a");
    const bIndex = await driver.tagMembers("cache:tags:b");
    expect(aIndex).toContain("k");
    expect(bIndex).toContain("k");
  });
});

describe("TaggedCache on a large tag index", () => {
  let driver: MemoryCacheDriver;

  beforeEach(() => {
    driver = new MemoryCacheDriver();
    driver.setOptions({});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await driver.disconnect();
  });

  it("checks a sample of members by existence on a tagged write, never reading values or the full index", async () => {
    const members = Array.from({ length: 10_000 }, (_, index) => `page.${index}`);

    await driver.tagAdd("cache:tags:pages", members);

    const get = vi.spyOn(driver, "get");
    const has = vi.spyOn(driver, "has");
    const tagMembers = vi.spyOn(driver, "tagMembers");
    const tagSample = vi.spyOn(driver, "tagSample");
    const exists = vi.spyOn(driver, "exists");

    await driver.tags(["pages"]).set("page.new", "<html>");

    expect(get).not.toHaveBeenCalled();
    expect(has).not.toHaveBeenCalled();
    expect(tagMembers).not.toHaveBeenCalled();
    expect(tagSample).toHaveBeenCalledTimes(1);
    expect(exists.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("still drops members whose entry is gone", async () => {
    const tagged = new TaggedCache(["users"], driver);

    await tagged.set("user.1", 1);
    await driver.remove("user.1");
    await tagged.set("user.2", 2);

    await expect(driver.tagMembers("cache:tags:users")).resolves.toEqual(["user.2"]);
  });

  it("does not count pruning checks as cache hits or misses", async () => {
    const tagged = new TaggedCache(["users"], driver);
    const misses = vi.fn();

    await tagged.set("user.1", 1);
    await driver.remove("user.1");

    driver.on("miss", misses);
    await tagged.set("user.2", 2);

    expect(misses).not.toHaveBeenCalled();
  });

  it("invalidates through the driver's batched removal", async () => {
    const tagged = new TaggedCache(["users"], driver);

    for (let index = 0; index < 50; index++) {
      await tagged.set(`user.${index}`, index);
    }

    const removeMany = vi.spyOn(driver, "removeMany");
    const removed = vi.fn();

    driver.on("removed", removed);
    await tagged.invalidate();

    expect(removeMany).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(50);
    await expect(driver.get("user.7")).resolves.toBeNull();
  });

  it("falls back to has() and remove() for a driver without the primitives", async () => {
    const plain = {
      store: new Map<string, unknown>(),
      async set(key: string, value: unknown) {
        this.store.set(key, value);
      },
      async get(key: string) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      async has(key: string) {
        return this.store.has(key);
      },
      async remove(key: string) {
        this.store.delete(key);
      },
    };
    const tagged = new TaggedCache(["t"], plain as never);

    await tagged.set("a", 1);
    await tagged.set("b", 2);
    await tagged.invalidate();

    expect(plain.store.has("a")).toBe(false);
    expect(plain.store.has("b")).toBe(false);
  });
});
