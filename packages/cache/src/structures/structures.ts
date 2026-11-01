import { CacheUnsupportedError } from "../types";
import { parseTtl } from "../utils";
import { BloomFilter, type StructureContext } from "./bloom-filter";
import { CuckooFilter } from "./cuckoo-filter";
import { FrequencyTracker } from "./frequency-tracker";
import { UniqueCounter, UniqueCounterGroup } from "./unique-counter";
import {
  isStructuresCapable,
  type BloomOptions,
  type CacheStructuresBackend,
  type CuckooOptions,
  type FrequencyOptions,
  type StructureOptions,
  type UniqueCounterOptions,
} from "./types";

export type UniqueCounterFactory = {
  (key: string, options?: UniqueCounterOptions): UniqueCounter;
  /** Count distinct values across several counters without changing them. */
  merge(keys: string[]): UniqueCounterGroup;
};

/**
 * The `cache.structures` namespace.
 */
export type CacheStructures = {
  bloom(key: string, options: BloomOptions): BloomFilter;
  cuckoo(key: string, options: CuckooOptions): CuckooFilter;
  uniqueCounter: UniqueCounterFactory;
  frequency(key: string, options?: FrequencyOptions): FrequencyTracker;
};

/**
 * Resolve the backend of a driver, or throw {@link CacheUnsupportedError} when
 * the driver does not opt in.
 */
export function structuresBackendOf(driver: {
  name: string;
}): CacheStructuresBackend {
  if (!isStructuresCapable(driver)) {
    throw new CacheUnsupportedError(
      `'${driver.name}' driver does not support cache.structures. Use the 'redis' driver or a memory driver ('memory', 'memoryExtended', 'lru').`,
    );
  }

  return driver.structuresBackend();
}

function ttlSeconds(options?: StructureOptions): number | undefined {
  if (options?.ttl === undefined) {
    return undefined;
  }

  const seconds = parseTtl(options.ttl);

  return seconds > 0 && Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Build the `cache.structures` namespace. `getBackend` is called on every
 * operation, so structures always follow the manager's current driver.
 */
export function createStructures(getBackend: () => CacheStructuresBackend): CacheStructures {
  const context = (options?: StructureOptions): StructureContext => ({
    backend: getBackend,
    ttl: ttlSeconds(options),
  });

  const uniqueCounter = ((key: string, options?: UniqueCounterOptions) =>
    new UniqueCounter(`structures.unique.${key}`, context(options))) as UniqueCounterFactory;

  uniqueCounter.merge = (keys: string[]) =>
    new UniqueCounterGroup(
      keys.map((key) => `structures.unique.${key}`),
      context(),
    );

  return {
    bloom: (key, options) => new BloomFilter(`structures.bloom.${key}`, options, context(options)),
    cuckoo: (key, options) =>
      new CuckooFilter(`structures.cuckoo.${key}`, options, context(options)),
    uniqueCounter,
    frequency: (key, options = {}) =>
      new FrequencyTracker(`structures.frequency.${key}`, options, context(options)),
  };
}
