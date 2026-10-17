import { type CacheDriver, type CacheKey, MemoryCacheDriver, cache } from "@warlock.js/cache";
import { isDeepStrictEqual } from "node:util";
import { FakeAssertionError } from "./fake-assertion-error";

let fakeDriver: MemoryCacheDriver | undefined;
let previousDriver: CacheDriver<unknown, unknown> | undefined;
let installed = false;

function driver(): MemoryCacheDriver {
  if (!fakeDriver) {
    throw new FakeAssertionError(
      "cacheFake is not installed. It installs by default in the test environment; check `tests.fakes` in src/config/tests.ts, or call cacheFake.install().",
    );
  }

  return fakeDriver;
}

/**
 * Swaps the cache's current driver for a fresh in-memory one.
 *
 * Installed by default in the test environment, so tests never need Redis
 * and never see another test's keys. Everything goes through the real cache
 * manager and the real memory driver: TTLs, tags, namespaces and locks behave
 * as they do in production.
 *
 * @example
 * await getDashboardStats(); // caches under "stats.dashboard"
 *
 * await cacheFake.assertHas("stats.dashboard");
 */
export const cacheFake = {
  /** Start a fresh in-memory store (idempotent: a second call empties it). */
  async install(): Promise<void> {
    if (!installed) {
      previousDriver = cache.currentDriver;
      installed = true;
    }

    await fakeDriver?.disconnect();

    const next = new MemoryCacheDriver();

    next.setOptions({});
    await next.connect();

    fakeDriver = next;
    await cache.use(next);
  },

  /** Put the previous driver back and drop the in-memory store. */
  async restore(): Promise<void> {
    if (!installed) return;

    const fake = fakeDriver;

    fakeDriver = undefined;
    installed = false;

    if (previousDriver) await cache.use(previousDriver);
    else cache.currentDriver = undefined;

    previousDriver = undefined;

    await fake?.disconnect();
  },

  isInstalled(): boolean {
    return installed;
  },

  /** The in-memory driver standing in for the configured one. */
  driver(): MemoryCacheDriver {
    return driver();
  },

  /** Empty the store. */
  async clear(): Promise<void> {
    await driver().flush();
  },

  /** Assert `key` is cached. */
  async assertHas(key: CacheKey): Promise<void> {
    if (!(await driver().has(key))) {
      throw new FakeAssertionError(
        `Expected cache key ${JSON.stringify(key)} to be set. Cached keys: ${JSON.stringify(Object.keys(driver().data))}.`,
      );
    }
  },

  /** Assert `key` is not cached. */
  async assertMissing(key: CacheKey): Promise<void> {
    if (await driver().has(key)) {
      throw new FakeAssertionError(
        `Expected cache key ${JSON.stringify(key)} not to be set, but it holds ${JSON.stringify(await driver().get(key))}.`,
      );
    }
  },

  /** Assert `key` holds a value deeply equal to `value`. */
  async assertStored(key: CacheKey, value: unknown): Promise<void> {
    const stored: unknown = await driver().get(key);

    if (!isDeepStrictEqual(stored, value)) {
      throw new FakeAssertionError(
        `Expected cache key ${JSON.stringify(key)} to hold ${JSON.stringify(value)}, but it holds ${JSON.stringify(stored)}.`,
      );
    }
  },
};
