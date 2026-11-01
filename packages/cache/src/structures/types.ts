import type { CacheTtl } from "../types";

/**
 * Options shared by every structure.
 */
export type StructureOptions = {
  /**
   * Expiry of the whole structure, set when it is first written and never
   * pushed back by later writes. A number is seconds; a string is a duration
   * such as `"40d"`. Omit to keep the structure until it is removed.
   */
  ttl?: CacheTtl;
};

export type BloomOptions = StructureOptions & {
  /** How many distinct items you expect to add. Sizes the filter. */
  expectedItems: number;
  /** Target false-positive rate between 0 and 1. Default `0.01`. */
  errorRate?: number;
};

export type CuckooOptions = StructureOptions & {
  /** How many distinct items you expect to hold at once. Sizes the filter. */
  expectedItems: number;
  /** Target false-positive rate between 0 and 1. Default `0.01`. */
  errorRate?: number;
};

export type UniqueCounterOptions = StructureOptions;

export type FrequencyOptions = StructureOptions & {
  /** Counters per row. Wider means less over-counting. Default `2000`. */
  width?: number;
  /** Number of rows (independent hashes). Default `5`. */
  depth?: number;
  /** How many of the most frequent values to remember for `top()`. Default `10`. */
  topK?: number;
};

export type FrequencyEntry = { value: string; count: number };

/** Write options a structure hands to the backend (ttl in whole seconds). */
export type StructureWrite = { ttl?: number };

/** A member with its score, as kept by the ranked primitive. */
export type RankedEntry = { member: string; score: number };

/**
 * Native (module) operations. The Redis driver offers them when the server
 * runs RedisBloom, and the structures prefer them over the portable path.
 */
export interface NativeStructures {
  bloomAdd(
    key: string,
    item: string,
    options: { capacity: number; errorRate: number } & StructureWrite,
  ): Promise<boolean>;
  bloomExists(key: string, item: string): Promise<boolean>;
  cuckooAdd(
    key: string,
    item: string,
    options: { capacity: number } & StructureWrite,
  ): Promise<boolean>;
  cuckooRemove(key: string, item: string): Promise<boolean>;
  cuckooExists(key: string, item: string): Promise<boolean>;
  frequencyAdd(
    key: string,
    item: string,
    count: number,
    options: { width: number; depth: number; topK: number } & StructureWrite,
  ): Promise<void>;
  frequencyEstimate(key: string, item: string): Promise<number>;
  frequencyTop(key: string, count: number): Promise<RankedEntry[]>;
}

/**
 * The storage primitives behind `cache.structures`. A driver opts in by
 * implementing {@link StructuresCapable}; custom drivers that do not are
 * reported as unsupported.
 *
 * Keys are logical (the driver applies its own prefix). Every primitive that
 * writes takes a ttl in seconds that is applied only when the key is created.
 */
export interface CacheStructuresBackend {
  /** Set bits, returning each bit's previous value. */
  bitSet(key: string, offsets: number[], options?: StructureWrite): Promise<boolean[]>;
  bitGet(key: string, offsets: number[]): Promise<boolean[]>;
  /**
   * Add `delta` to every cell, returning the new values. Cells never go below
   * zero on backends that can clamp.
   */
  gridAdd(key: string, cells: number[], delta: number, options?: StructureWrite): Promise<number[]>;
  gridGet(key: string, cells: number[]): Promise<number[]>;
  /** Add to a distinct counter. Returns true when the estimate may have changed. */
  uniqueAdd(key: string, member: string, options?: StructureWrite): Promise<boolean>;
  /** Distinct count of the union of one or more counters. */
  uniqueCount(keys: string[]): Promise<number>;
  /** Set a member's score, keeping only the `capacity` highest-scored members. */
  rankedSet(
    key: string,
    member: string,
    score: number,
    capacity: number,
    options?: StructureWrite,
  ): Promise<void>;
  /** The highest-scored members, best first. */
  rankedTop(key: string, count: number): Promise<RankedEntry[]>;
  /** Native module operations, or `null` when unavailable. Resolved once per backend. */
  native?(): Promise<NativeStructures | null>;
}

/**
 * Optional capability a cache driver implements to support `cache.structures`.
 */
export interface StructuresCapable {
  structuresBackend(): CacheStructuresBackend;
}

export function isStructuresCapable(driver: unknown): driver is StructuresCapable {
  return (
    typeof driver === "object" &&
    driver !== null &&
    typeof (driver as StructuresCapable).structuresBackend === "function"
  );
}
