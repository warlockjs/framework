import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheDriver } from "../types";
import { CacheConfigurationError, CacheError } from "../types";
import { FileCacheDriver } from "./file-cache-driver";

describe("FileCacheDriver", () => {
  let driver: FileCacheDriver;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "warlock-cache-"));
    driver = new FileCacheDriver();
    driver.setOptions({ directory: () => directory });
    driver.setLoggingState(false);
    await driver.connect();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("create is exclusive under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => driver.set("lock.k", i, { onConflict: "create" })),
    );

    expect(results.filter((r) => r.wasSet).length).toBe(1);
  });

  it("keeps a corrupt file in place and returns null", async () => {
    await driver.set("bad", "v");
    const file = resolve(directory, "bad", "cache.json");
    writeFileSync(file, "{not json");

    await expect(driver.get("bad")).resolves.toBeNull();
    expect(existsSync(file)).toBe(true);
  });

  it("throws on an empty key", async () => {
    await expect(driver.remove("{}")).rejects.toThrow(CacheConfigurationError);
    expect(existsSync(directory)).toBe(true);
  });

  it("does not let an expired entry block create", async () => {
    await driver.set("exp", "old", 1);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);

    try {
      const result = await driver.set("exp", "new", { onConflict: "create" });
      expect(result.wasSet).toBe(true);
      await expect(driver.get("exp")).resolves.toBe("new");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("throws when no directory option is provided", () => {
    const fresh = new FileCacheDriver();
    expect(() => fresh.setOptions({} as never)).toThrow(CacheConfigurationError);
  });

  it("throws when directory getter is read without a function resolver", () => {
    const fresh = new FileCacheDriver();
    fresh.setOptions({ directory: "/tmp/static" });
    expect(() => fresh.directory).toThrow(CacheConfigurationError);
  });

  it("returns a default file name when none configured", () => {
    expect(driver.fileName).toBe("cache.json");
  });

  it("allows a custom fileName function", () => {
    driver.setOptions({ directory: () => directory, fileName: () => "custom.json" });
    expect(driver.fileName).toBe("custom.json");
  });

  it("stores and retrieves values", async () => {
    await driver.set("user.profile", { name: "John" });
    await expect(driver.get("user.profile")).resolves.toEqual({ name: "John" });
  });

  it("returns null for missing keys and emits miss", async () => {
    const handler = vi.fn();
    driver.on("miss", handler);
    await expect(driver.get("missing")).resolves.toBeNull();
    expect(handler).toHaveBeenCalled();
  });

  it("expires entries past their TTL", async () => {
    await driver.set("temp", "v", 1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);

    await expect(driver.get("temp")).resolves.toBeNull();
    vi.restoreAllMocks();
  });

  it("removes a key", async () => {
    await driver.set("k", "v");
    await driver.remove("k");
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("remove tolerates missing directories", async () => {
    await expect(driver.remove("never-existed")).resolves.toBeUndefined();
  });

  it("flushes all cached files", async () => {
    await driver.set("a", 1);
    await driver.set("b", 2);
    await driver.flush();

    await expect(driver.get("a")).resolves.toBeNull();
  });

  it("flushes only the namespace when a globalPrefix is set", async () => {
    driver.setOptions({ directory: () => directory, globalPrefix: "tenant" });
    await driver.connect();
    await driver.set("a", 1);
    await driver.flush();
    await expect(driver.get("a")).resolves.toBeNull();
  });

  it("removeNamespace does not throw when directory is absent", async () => {
    await expect(driver.removeNamespace("unknown")).resolves.toBe(driver);
  });

  describe("removeNamespace clears dotted keys", () => {
    // Dotted keys (`ns.a`) are stored as *sibling* directories, not nested
    // ones — a directory literally named `ns` rarely exists on its own.
    it("removes every key logically under the namespace, not just a same-named directory", async () => {
      await driver.set("user.profile", { name: "John" });
      await driver.set("user.totals", { posts: 1 });
      await driver.set("other", "x");

      await driver.removeNamespace("user");

      await expect(driver.get("user.profile")).resolves.toBeNull();
      await expect(driver.get("user.totals")).resolves.toBeNull();
      await expect(driver.get("other")).resolves.toBe("x");
    });

    it("also removes a key exactly matching the namespace itself", async () => {
      await driver.set("user", "root-value");
      await driver.set("user.profile", { name: "John" });

      await driver.removeNamespace("user");

      await expect(driver.get("user")).resolves.toBeNull();
      await expect(driver.get("user.profile")).resolves.toBeNull();
    });

    it("does not remove keys that merely share a prefix without the dot boundary", async () => {
      await driver.set("user.profile", { name: "John" });
      await driver.set("userland", "unrelated");

      await driver.removeNamespace("user");

      await expect(driver.get("user.profile")).resolves.toBeNull();
      await expect(driver.get("userland")).resolves.toBe("unrelated");
    });

    it("honors globalPrefix, scoping removal to the tenant instead of the whole cache root", async () => {
      driver.setOptions({ directory: () => directory, globalPrefix: "tenantA" });
      await driver.connect();
      await driver.set("user.profile", { name: "John" });

      driver.setOptions({ directory: () => directory, globalPrefix: "tenantB" });
      await driver.connect();
      await driver.set("user.profile", { name: "Jane" });

      await driver.removeNamespace("user");

      await expect(driver.get("user.profile")).resolves.toBeNull();

      driver.setOptions({ directory: () => directory, globalPrefix: "tenantA" });
      await expect(driver.get("user.profile")).resolves.toEqual({ name: "John" });
    });
  });

  it("update and merge throw CacheUnsupportedError", async () => {
    // The file driver intentionally narrows update/merge to a no-arg
    // `(): Promise<never>` signature; call through the CacheDriver contract
    // to assert the runtime throw with the documented argument shape.
    const asContract = driver as unknown as CacheDriver<unknown, unknown>;
    await expect(asContract.update("k", () => null)).rejects.toThrow(/not supported/);
    await expect(asContract.merge("k", { a: 1 })).rejects.toThrow(/not supported/);
  });

  it("emits set, hit, removed events", async () => {
    const events: string[] = [];
    driver.on("set", () => {
      events.push("set");
    });
    driver.on("hit", () => {
      events.push("hit");
    });
    driver.on("removed", () => {
      events.push("removed");
    });

    await driver.set("k", "v");
    await driver.get("k");
    await driver.remove("k");

    expect(events).toEqual(["set", "hit", "removed"]);
  });

  it("allows a custom fileName resolver", async () => {
    driver.setOptions({ directory: () => directory, fileName: () => "store.json" });
    await driver.set("k", "v");
    await expect(driver.get("k")).resolves.toBe("v");
  });

  describe("onConflict policies", () => {
    it("create writes a fresh key and reports wasSet=true", async () => {
      const result = (await driver.set("k", 1, { onConflict: "create" })) as {
        wasSet: boolean;
        existing: unknown;
      };
      expect(result.wasSet).toBe(true);
      await expect(driver.get("k")).resolves.toBe(1);
    });

    it("create on a held key reports wasSet=false + existing", async () => {
      await driver.set("k", 1);
      const result = (await driver.set("k", 2, { onConflict: "create" })) as {
        wasSet: boolean;
        existing: unknown;
      };
      expect(result.wasSet).toBe(false);
      expect(result.existing).toBe(1);
      await expect(driver.get("k")).resolves.toBe(1);
    });

    it("update on a missing key reports wasSet=false", async () => {
      const result = (await driver.set("k", 1, { onConflict: "update" })) as {
        wasSet: boolean;
      };
      expect(result.wasSet).toBe(false);
      await expect(driver.get("k")).resolves.toBeNull();
    });

    it("update on an existing key reports wasSet=true and overwrites", async () => {
      await driver.set("k", 1);
      const result = (await driver.set("k", 2, { onConflict: "update" })) as {
        wasSet: boolean;
      };
      expect(result.wasSet).toBe(true);
      await expect(driver.get("k")).resolves.toBe(2);
    });
  });

  describe("tags", () => {
    it("stores a tag relationship for an inline-tagged write", async () => {
      await driver.set("post.1", { id: 1 }, { tags: ["posts"] });
      const tagged = (await driver.get("cache.tags.posts")) as string[];
      expect(tagged).toContain("post.1");
    });
  });

  describe("path traversal containment", () => {
    it("set with a ../-bearing key never writes outside the cache directory", async () => {
      await driver.set("../../escape-target", { pwned: true });

      // The raw key would have resolved two levels above the cache root.
      expect(existsSync(resolve(directory, "../../escape-target"))).toBe(false);
      expect(existsSync(resolve(directory, "../escape-target"))).toBe(false);

      // The entry is still a working cache entry, just contained.
      await expect(driver.get("../../escape-target")).resolves.toEqual({ pwned: true });
    });

    it("set with a backslash traversal key never writes outside the cache directory", async () => {
      await driver.set("..\\..\\escape-target-win", "v");

      expect(existsSync(resolve(directory, "..", "..", "escape-target-win"))).toBe(false);
      expect(existsSync(resolve(directory, "..", "escape-target-win"))).toBe(false);
      await expect(driver.get("..\\..\\escape-target-win")).resolves.toBe("v");
    });

    it("get with a ../-bearing key cannot read files outside the cache directory", async () => {
      const outsideName = `warlock-secret-${Date.now()}`;
      const outsideDir = join(directory, "..", outsideName);
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, "cache.json"), JSON.stringify({ data: "top-secret" }));

      try {
        await expect(driver.get(`../${outsideName}`)).resolves.toBeNull();
        // The miss-cleanup inside get() must not have deleted the outside file.
        expect(existsSync(join(outsideDir, "cache.json"))).toBe(true);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("remove with a ../-bearing key cannot delete directories outside the cache directory", async () => {
      const victimName = `warlock-victim-${Date.now()}`;
      const victimDir = join(directory, "..", victimName);
      mkdirSync(victimDir, { recursive: true });
      writeFileSync(join(victimDir, "keep.txt"), "important");

      try {
        await driver.remove(`../${victimName}`);
        expect(existsSync(join(victimDir, "keep.txt"))).toBe(true);
      } finally {
        rmSync(victimDir, { recursive: true, force: true });
      }
    });

    it("removeNamespace with a ../-bearing namespace cannot delete outside directories", async () => {
      const victimName = `warlock-ns-victim-${Date.now()}`;
      const victimDir = join(directory, "..", victimName);
      mkdirSync(victimDir, { recursive: true });

      try {
        await driver.removeNamespace(`../${victimName}`);
        expect(existsSync(victimDir)).toBe(true);
      } finally {
        rmSync(victimDir, { recursive: true, force: true });
      }
    });

    it("keys containing separators or % stay distinct after encoding", async () => {
      await driver.set("a/b", 1);
      await driver.set("a%2Fb", 2);
      await driver.set("50%off", 3);

      await expect(driver.get("a/b")).resolves.toBe(1);
      await expect(driver.get("a%2Fb")).resolves.toBe(2);
      await expect(driver.get("50%off")).resolves.toBe(3);
    });

    it("the containment guard throws CacheError for escaping segments", () => {
      class ExposedFileCacheDriver extends FileCacheDriver {
        public containedPathFor(segment: string) {
          return this.containedPath(segment);
        }
      }

      const exposed = new ExposedFileCacheDriver();
      exposed.setOptions({ directory: () => directory });

      expect(() => exposed.containedPathFor("../outside")).toThrow(CacheError);
      expect(() => exposed.containedPathFor("..")).toThrow(CacheError);
      expect(() => exposed.containedPathFor(resolve(directory, "..", "abs"))).toThrow(CacheError);

      // Contained names — including ones merely starting with dots — pass.
      expect(exposed.containedPathFor("user.profile")).toBe(resolve(directory, "user.profile"));
      expect(exposed.containedPathFor("..oddname")).toBe(resolve(directory, "..oddname"));
    });
  });

  describe("get() error path", () => {
    it("treats a corrupt cache file as a miss and removes it", async () => {
      await driver.set("broken", { ok: true });

      // Corrupt the on-disk JSON so the read throws.
      const filePath = join(directory, "broken", "cache.json");
      writeFileSync(filePath, "{ not: valid json");

      const handler = vi.fn();
      driver.on("miss", handler);

      await expect(driver.get("broken")).resolves.toBeNull();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("swr (file driver supports getEntry/staleAt)", () => {
    it("returns the cached value within freshTtl without calling the fetcher again", async () => {
      const fetcher = vi.fn(async () => "fresh");

      const first = await driver.swr("k", { freshTtl: 60, staleTtl: 600 }, fetcher);
      const second = await driver.swr("k", { freshTtl: 60, staleTtl: 600 }, fetcher);

      expect(first).toBe("fresh");
      expect(second).toBe("fresh");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("serves the stale value and refreshes in the background past freshTtl", async () => {
      let value = "v1";
      const fetcher = vi.fn(async () => value);

      await driver.swr("k", { freshTtl: 1, staleTtl: 600 }, fetcher);

      let resolveBackgroundWrite!: () => void;
      const backgroundWrite = new Promise<void>((resolve) => {
        resolveBackgroundWrite = resolve;
      });
      const onSet = () => {
        driver.off("set", onSet);
        resolveBackgroundWrite();
      };
      driver.on("set", onSet);

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1500);

      try {
        value = "v2";

        const stale = await driver.swr("k", { freshTtl: 1, staleTtl: 600 }, fetcher);
        expect(stale).toBe("v1");

        // The file driver emits `set` after its background write completes.
        await backgroundWrite;
      } finally {
        nowSpy.mockRestore();
        driver.off("set", onSet);
      }

      const refreshed = await driver.swr("k", { freshTtl: 1, staleTtl: 600 }, fetcher);
      expect(refreshed).toBe("v2");
    });
  });
});

describe("FileCacheDriver — extend", () => {
  let driver: FileCacheDriver;
  let directory: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    directory = mkdtempSync(join(tmpdir(), "warlock-cache-"));
    driver = new FileCacheDriver();
    driver.setOptions({ directory: () => directory });
    await driver.connect();
    driver.setLoggingState(false);
  });

  afterEach(async () => {
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("resets the expiry to ttl from now instead of adding to the time left", async () => {
    await driver.set("k", "v", 10);
    vi.advanceTimersByTime(6000);

    await expect(driver.extend("k", 10)).resolves.toBe(true);

    vi.advanceTimersByTime(9000); // 15s after the write: would be gone without extend
    await expect(driver.get("k")).resolves.toBe("v");

    vi.advanceTimersByTime(2000); // 11s after extend: past the new deadline, so it is not 10 + 4
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("accepts duration strings", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", "1m")).resolves.toBe(true);

    vi.advanceTimersByTime(59_000);
    await expect(driver.get("k")).resolves.toBe("v");

    vi.advanceTimersByTime(2000);
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("returns false and creates nothing for a missing key", async () => {
    await expect(driver.extend("missing", 60)).resolves.toBe(false);
    await expect(driver.get("missing")).resolves.toBeNull();
  });

  it("returns false for an expired key", async () => {
    await driver.set("k", "v", 1);
    vi.advanceTimersByTime(2000);

    await expect(driver.extend("k", 60)).resolves.toBe(false);
    await expect(driver.get("k")).resolves.toBeNull();
  });

  it("removes the expiry when ttl is Infinity", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", Infinity)).resolves.toBe(true);

    vi.advanceTimersByTime(3_600_000);
    await expect(driver.get("k")).resolves.toBe("v");
  });

  it("keeps the stored value", async () => {
    await driver.set("k", { nested: [1, 2, 3] }, 5);
    await driver.extend("k", 60);

    await expect(driver.get("k")).resolves.toEqual({ nested: [1, 2, 3] });
  });

  it("rejects a negative ttl", async () => {
    await driver.set("k", "v", 5);

    await expect(driver.extend("k", -1)).rejects.toThrow();
  });
});

describe("FileCacheDriver exclusive writes on an expired entry", () => {
  let driver: FileCacheDriver;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "warlock-cache-"));
    driver = new FileCacheDriver();
    driver.setOptions({ directory: () => directory });
    await driver.connect();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  function writeExpiredEntry(key: string) {
    mkdirSync(resolve(directory, key), { recursive: true });
    writeFileSync(
      resolve(directory, key, "cache.json"),
      JSON.stringify({ data: "previous-holder", ttl: 1, expiresAt: Date.now() - 1000 }),
    );
  }

  it("lets exactly one of many concurrent creates win, round after round", async () => {
    for (let round = 0; round < 20; round++) {
      const key = `lock.round-${round}`;

      writeExpiredEntry(key);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          driver.set(key, `holder-${index}`, { onConflict: "create", ttl: 60 }),
        ),
      );

      expect(results.filter((result) => result.wasSet)).toHaveLength(1);

      // The winner's value is what is stored.
      const winner = results.findIndex((result) => result.wasSet);

      await expect(driver.get(key)).resolves.toBe(`holder-${winner}`);
    }
  });

  it("never leaves claimed or temporary files behind", async () => {
    writeExpiredEntry("lock.clean");

    await Promise.all(
      Array.from({ length: 5 }, () => driver.set("lock.clean", "x", { onConflict: "create" })),
    );

    const { readdirSync } = await import("node:fs");

    expect(readdirSync(resolve(directory, "lock.clean"))).toEqual(["cache.json"]);
  });

  it("releases a lock only when it still holds the caller's value", async () => {
    const outcome = await driver.lock("job", 60, async () => {
      // Another holder took over (the lock expired and was re-acquired).
      writeFileSync(
        resolve(directory, "job", "cache.json"),
        JSON.stringify({ data: "successor", ttl: 60, expiresAt: Date.now() + 60_000 }),
      );

      return "done";
    });

    expect(outcome).toEqual({ acquired: true, value: "done" });
    await expect(driver.get("job")).resolves.toBe("successor");
  });

  it("releases quietly when the key was removed while the lock was held", async () => {
    const error = vi.spyOn(driver as unknown as { logError: () => void }, "logError");

    await driver.lock("job", 60, async () => {
      await driver.remove("job");
    });

    expect(error).not.toHaveBeenCalled();
  });

  it("releases its own lock", async () => {
    await driver.lock("job", 60, async () => "done");

    await expect(driver.get("job")).resolves.toBeNull();
    expect(existsSync(resolve(directory, "job"))).toBe(false);
  });
});

describe("FileCacheDriver expired entries with a globalPrefix", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "warlock-cache-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  it("removes the expired entry's directory on read", async () => {
    const driver = new FileCacheDriver();

    driver.setOptions({ directory: () => directory, globalPrefix: "store" });
    await driver.connect();

    await driver.set("user.1", { id: 1 }, 1);

    expect(existsSync(resolve(directory, "store.user.1"))).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5000);

    await expect(driver.get("user.1")).resolves.toBeNull();

    expect(existsSync(resolve(directory, "store.user.1"))).toBe(false);
    expect(existsSync(resolve(directory, "store.store.user.1"))).toBe(false);
  });
});
