import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileCacheDriver,
  LRUMemoryCacheDriver,
  MemoryCacheDriver,
  MemoryExtendedCacheDriver,
  MockCacheDriver,
  NullCacheDriver,
} from "./drivers";
import type { CacheDriver } from "./types";

type Case = { name: string; make: (options?: Record<string, unknown>) => CacheDriver<any, any> };

const cases: Case[] = [
  { name: "memory", make: (o) => new MemoryCacheDriver().setOptions(o ?? {}) as never },
  {
    name: "memoryExtended",
    make: (o) => new MemoryExtendedCacheDriver().setOptions(o ?? {}) as never,
  },
  { name: "lru", make: (o) => new LRUMemoryCacheDriver().setOptions(o ?? {}) as never },
  { name: "mock", make: (o) => new MockCacheDriver().setOptions(o ?? {}) as never },
];

describe.each(cases)("listKeys — $name", ({ make }) => {
  const drivers: CacheDriver<any, any>[] = [];

  const create = (options?: Record<string, unknown>) => {
    const driver = make(options);
    driver.setLoggingState(false);
    drivers.push(driver);

    return driver;
  };

  afterEach(async () => {
    for (const driver of drivers.splice(0)) {
      await driver.disconnect();
    }
  });

  it("lists the namespace key and its children, not siblings", async () => {
    const driver = create();

    await driver.set("kb.acme", 1);
    await driver.set("kb.acme.a.0", 2);
    await driver.set("kb.acme.private.a.0", 3);
    await driver.set("kb.acme2.a.0", 4);
    await driver.set("other.a", 5);

    expect((await driver.listKeys!("kb.acme")).sort()).toEqual([
      "kb.acme",
      "kb.acme.a.0",
      "kb.acme.private.a.0",
    ]);
    expect(await driver.listKeys!("missing")).toEqual([]);
  });

  it("lists everything for an empty namespace", async () => {
    const driver = create();

    await driver.set("a", 1);
    await driver.set("b.c", 2);

    expect((await driver.listKeys!("")).sort()).toEqual(["a", "b.c"]);
  });

  it("skips an expired entry", async () => {
    const driver = create();

    await driver.set("ns.live", 1);
    await driver.set("ns.gone", 2, 1);

    await vi.waitFor(async () => expect(await driver.listKeys!("ns")).toEqual(["ns.live"]), {
      timeout: 4000,
      interval: 100,
    });
  });

  it("returns keys that go straight back into get() and remove() under a globalPrefix", async () => {
    const driver = create({ globalPrefix: "app" });

    await driver.set("ns.a", "value");

    const keys = await driver.listKeys!("ns");

    expect(keys).toEqual(["ns.a"]);
    expect(await driver.get(keys[0]!)).toBe("value");

    await driver.remove(keys[0]!);

    expect(await driver.listKeys!("ns")).toEqual([]);
  });
});

describe("listKeys — null driver", () => {
  it("lists nothing", async () => {
    const driver = new NullCacheDriver();
    driver.setOptions({});

    expect(await driver.listKeys("ns")).toEqual([]);
  });
});

describe("listKeys — file driver", () => {
  it("lists the keys under a namespace from the entry directories", async () => {
    const driver = new FileCacheDriver();
    driver.setOptions({ directory: () => path.resolve(__dirname, "..", ".cache-list-keys-test") });
    driver.setLoggingState(false);
    await driver.connect();

    try {
      await driver.set("kb.a.0", 1);
      await driver.set("kb.b.0", 2);
      await driver.set("other.a", 3);

      expect((await driver.listKeys("kb")).sort()).toEqual(["kb.a.0", "kb.b.0"]);
    } finally {
      await driver.flush();
      await driver.disconnect();
    }
  }, 30000);
});
