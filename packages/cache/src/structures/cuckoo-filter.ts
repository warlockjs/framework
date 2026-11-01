import { nativeOf, type StructureContext } from "./bloom-filter";
import { hashPair, probe } from "./hash";
import { bloomGeometry } from "./sizing";
import type { CuckooOptions } from "./types";

/**
 * Membership filter that supports removal.
 *
 * With RedisBloom this is a real cuckoo filter (`CF.*`). Everywhere else it is
 * a counting Bloom filter: the same API and error rate, with one counter per
 * cell instead of one bit, so `remove()` can undo an `add()`.
 *
 * Never remove an item that was not added: on either implementation it
 * corrupts the filter and can hide other items.
 */
export class CuckooFilter {
  protected readonly cells: number;
  protected readonly hashes: number;
  protected readonly capacity: number;

  public constructor(
    protected readonly key: string,
    options: CuckooOptions,
    protected readonly context: StructureContext,
  ) {
    const geometry = bloomGeometry(options.expectedItems, options.errorRate ?? 0.01);

    this.cells = geometry.bits;
    this.hashes = geometry.hashes;
    this.capacity = options.expectedItems;
  }

  protected positions(item: string): number[] {
    const hashes = hashPair(item);

    return Array.from({ length: this.hashes }, (_, index) => probe(hashes, index, this.cells));
  }

  /**
   * Add an item. Resolves to `true` when stored.
   */
  public async add(item: string | number): Promise<boolean> {
    const value = String(item);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.cuckooAdd(this.key, value, {
        capacity: this.capacity,
        ttl: this.context.ttl,
      });
    }

    await backend.gridAdd(this.key, this.positions(value), 1, { ttl: this.context.ttl });

    return true;
  }

  /**
   * Remove an item that was added. Resolves to `true` when something was removed.
   */
  public async remove(item: string | number): Promise<boolean> {
    const value = String(item);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.cuckooRemove(this.key, value);
    }

    const positions = this.positions(value);
    const counts = await backend.gridGet(this.key, positions);

    if (counts.some((count) => count === 0)) {
      return false;
    }

    await backend.gridAdd(this.key, positions, -1);

    return true;
  }

  /**
   * `false` means definitely not present; `true` means probably present.
   */
  public async mightContain(item: string | number): Promise<boolean> {
    const value = String(item);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.cuckooExists(this.key, value);
    }

    const counts = await backend.gridGet(this.key, this.positions(value));

    return counts.every((count) => count > 0);
  }
}
