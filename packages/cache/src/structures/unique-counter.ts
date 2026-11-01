import type { StructureContext } from "./bloom-filter";

/**
 * Approximate count of distinct values (HyperLogLog): about 12 KB per counter,
 * standard error 0.81%. Cannot tell whether one specific value was counted.
 */
export class UniqueCounter {
  public constructor(
    protected readonly key: string,
    protected readonly context: StructureContext,
  ) {}

  /**
   * Count a value. Adding the same value again changes nothing.
   */
  public async add(...values: Array<string | number>): Promise<void> {
    const backend = this.context.backend();

    for (const value of values) {
      await backend.uniqueAdd(this.key, String(value), { ttl: this.context.ttl });
    }
  }

  /**
   * Approximate number of distinct values counted so far.
   */
  public count(): Promise<number> {
    return this.context.backend().uniqueCount([this.key]);
  }
}

/**
 * The union of several unique counters, counted without changing any of them.
 */
export class UniqueCounterGroup {
  public constructor(
    protected readonly keys: string[],
    protected readonly context: StructureContext,
  ) {}

  /**
   * Approximate number of distinct values across every counter in the group.
   */
  public count(): Promise<number> {
    return this.context.backend().uniqueCount(this.keys);
  }
}
