import { hashPair, probe } from "./hash";
import { bloomGeometry } from "./sizing";
import type { BloomOptions, CacheStructuresBackend, NativeStructures } from "./types";

export type StructureContext = {
  backend(): CacheStructuresBackend;
  /** Seconds, or undefined for no expiry. */
  ttl: number | undefined;
};

export async function nativeOf(backend: CacheStructuresBackend): Promise<NativeStructures | null> {
  return backend.native ? backend.native() : null;
}

/**
 * Bloom filter: answers "definitely not added" or "probably added".
 * Items can be added but not removed or listed.
 */
export class BloomFilter {
  protected readonly bits: number;
  protected readonly hashes: number;
  protected readonly errorRate: number;
  protected readonly capacity: number;

  public constructor(
    protected readonly key: string,
    options: BloomOptions,
    protected readonly context: StructureContext,
  ) {
    this.errorRate = options.errorRate ?? 0.01;
    this.capacity = options.expectedItems;

    const geometry = bloomGeometry(options.expectedItems, this.errorRate);

    this.bits = geometry.bits;
    this.hashes = geometry.hashes;
  }

  protected positions(item: string): number[] {
    const hashes = hashPair(item);

    return Array.from({ length: this.hashes }, (_, index) => probe(hashes, index, this.bits));
  }

  /**
   * Add an item. Resolves to `true` when the item was not (probably) present
   * before and `false` when it probably was.
   */
  public async add(item: string | number): Promise<boolean> {
    const value = String(item);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.bloomAdd(this.key, value, {
        capacity: this.capacity,
        errorRate: this.errorRate,
        ttl: this.context.ttl,
      });
    }

    const previous = await backend.bitSet(this.key, this.positions(value), {
      ttl: this.context.ttl,
    });

    return previous.some((bit) => !bit);
  }

  /**
   * `false` means the item was definitely never added; `true` means it
   * probably was (a small, configured share of `true` answers are wrong).
   */
  public async mightContain(item: string | number): Promise<boolean> {
    const value = String(item);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.bloomExists(this.key, value);
    }

    const bits = await backend.bitGet(this.key, this.positions(value));

    return bits.every(Boolean);
  }
}
