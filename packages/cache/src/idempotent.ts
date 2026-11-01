import { log, maskEmailsInText } from "@warlock.js/logger";
import type { CacheDriver, CacheKey, CacheTtl } from "./types";
import { CacheConcurrencyError } from "./types";
import { parseCacheKey, parseTtl } from "./utils";

/**
 * Options of `idempotent()`.
 */
export type IdempotentOptions = {
  /**
   * How long a successful result is kept and replayed. A number is seconds; a
   * string is a duration such as `"24h"`. `0` means in-flight dedupe only:
   * nothing is stored, and the next call after the run finishes runs again.
   */
  ttl: CacheTtl;
  /**
   * Cache driver name to store results in (and take the lock on). Defaults to
   * the current driver.
   */
  driver?: string;
  /**
   * Make concurrent calls on DIFFERENT servers run `fn` once, using the cache
   * lock. Without it, calls share a single run only inside one process; across
   * processes the stored result still prevents re-runs after the first one
   * finished. Needs a shared driver such as Redis or Postgres.
   */
  distributed?: boolean;
  /**
   * With `distributed`: how long the lock is held, which is also how long
   * another server waits for the result before giving up. Must exceed the
   * worst-case duration of `fn`. Default `"30s"`.
   */
  lockTtl?: CacheTtl;
};

/**
 * What is kept in the cache. The wrapper tells a stored `undefined`, `null` or
 * `false` result apart from "nothing stored".
 */
type StoredResult = { idempotent: true; result: unknown };

/** In-flight runs, per driver instance and storage key. */
export type IdempotentFlights = WeakMap<object, Map<string, Promise<unknown>>>;

const MIN_POLL_MS = 25;
const MAX_POLL_MS = 250;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readStored(
  driver: CacheDriver<any, any>,
  storeKey: string,
): Promise<StoredResult | null> {
  const value = await driver.get(storeKey);

  if (value && typeof value === "object" && (value as StoredResult).idempotent === true) {
    return value as StoredResult;
  }

  return null;
}

async function store(
  driver: CacheDriver<any, any>,
  storeKey: string,
  result: unknown,
  seconds: number,
) {
  try {
    await driver.set(storeKey, { idempotent: true, result } satisfies StoredResult, seconds);
  } catch (error) {
    // The work already happened: hand the result back instead of failing the
    // caller into a retry that would repeat it.
    log.error("cache", "idempotent", maskEmailsInText(`Could not store the result of ${storeKey}: ${String(error)}`));
  }
}

/**
 * Implementation behind `cache.idempotent()`.
 */
export function runIdempotent<T>(
  driver: CacheDriver<any, any>,
  flights: IdempotentFlights,
  key: CacheKey,
  fn: () => Promise<T>,
  options: IdempotentOptions,
): Promise<T> {
  const seconds = parseTtl(options.ttl);
  const keyString = typeof key === "string" ? key : parseCacheKey(key);
  const storeKey = `idempotent.${keyString}`;

  const driverFlights = flights.get(driver) ?? new Map<string, Promise<unknown>>();

  flights.set(driver, driverFlights);

  const existing = driverFlights.get(storeKey);

  if (existing) {
    return existing as Promise<T>;
  }

  const run = async (): Promise<T> => {
    if (seconds === 0) {
      return fn();
    }

    const stored = await readStored(driver, storeKey);

    if (stored) {
      return stored.result as T;
    }

    if (options.distributed) {
      return runDistributed(driver, keyString, storeKey, fn, seconds, options);
    }

    const result = await fn();

    await store(driver, storeKey, result, seconds);

    return result;
  };

  const promise = run().finally(() => {
    if (driverFlights.get(storeKey) === promise) {
      driverFlights.delete(storeKey);
    }
  });

  driverFlights.set(storeKey, promise);

  return promise;
}

async function runDistributed<T>(
  driver: CacheDriver<any, any>,
  keyString: string,
  storeKey: string,
  fn: () => Promise<T>,
  seconds: number,
  options: IdempotentOptions,
): Promise<T> {
  const lockKey = `idempotent.lock.${keyString}`;
  const lockSeconds = parseTtl(options.lockTtl ?? "30s");
  const deadline = Date.now() + lockSeconds * 1000;
  let pause = MIN_POLL_MS;

  while (true) {
    const outcome = await driver.lock(lockKey, lockSeconds, async () => {
      // Another server may have finished between our read and the lock.
      const stored = await readStored(driver, storeKey);

      if (stored) {
        return stored.result as T;
      }

      const result = await fn();

      await store(driver, storeKey, result, seconds);

      return result;
    });

    if (outcome.acquired) {
      return outcome.value;
    }

    // Held elsewhere: wait for its result. If that run fails it stores
    // nothing and releases the lock, and the next loop takes it over.
    await sleep(pause);
    pause = Math.min(pause * 2, MAX_POLL_MS);

    const stored = await readStored(driver, storeKey);

    if (stored) {
      return stored.result as T;
    }

    if (Date.now() >= deadline) {
      throw new CacheConcurrencyError(
        `idempotent("${keyString}") timed out after ${lockSeconds}s waiting for another run to finish.`,
      );
    }
  }
}
