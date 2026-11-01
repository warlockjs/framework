import { nativeOf, type StructureContext } from "./bloom-filter";
import { hashPair, probe } from "./hash";
import { assertPositiveInteger } from "./sizing";
import type { FrequencyEntry, FrequencyOptions } from "./types";

/**
 * Count-Min sketch with a Top-K list: how often a value was seen, and which
 * values are seen most. Estimates never fall below the true count; they can
 * only be too high.
 */
export class FrequencyTracker {
  protected readonly width: number;
  protected readonly depth: number;
  protected readonly topK: number;

  public constructor(
    protected readonly key: string,
    options: FrequencyOptions,
    protected readonly context: StructureContext,
  ) {
    this.width = options.width ?? 2000;
    this.depth = options.depth ?? 5;
    this.topK = options.topK ?? 10;

    assertPositiveInteger("width", this.width);
    assertPositiveInteger("depth", this.depth);
    assertPositiveInteger("topK", this.topK);
  }

  protected cellsOf(item: string): number[] {
    const hashes = hashPair(item);

    return Array.from(
      { length: this.depth },
      (_, row) => row * this.width + probe(hashes, row, this.width),
    );
  }

  /**
   * Count `count` more occurrences of a value (default one).
   */
  public async add(value: string | number, count = 1): Promise<void> {
    assertPositiveInteger("count", count);

    const item = String(value);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      await native.frequencyAdd(this.key, item, count, {
        width: this.width,
        depth: this.depth,
        topK: this.topK,
        ttl: this.context.ttl,
      });

      return;
    }

    const counters = await backend.gridAdd(this.key, this.cellsOf(item), count, {
      ttl: this.context.ttl,
    });

    await backend.rankedSet(`${this.key}.top`, item, Math.min(...counters), this.topK, {
      ttl: this.context.ttl,
    });
  }

  /**
   * Estimated number of times a value was counted. Never lower than the true
   * count; may be higher.
   */
  public async estimate(value: string | number): Promise<number> {
    const item = String(value);
    const backend = this.context.backend();
    const native = await nativeOf(backend);

    if (native) {
      return native.frequencyEstimate(this.key, item);
    }

    const counters = await backend.gridGet(this.key, this.cellsOf(item));

    return Math.min(...counters);
  }

  /**
   * The most frequent values seen, highest count first. Holds at most `topK`
   * values; `count` defaults to all of them.
   */
  public async top(count = this.topK): Promise<FrequencyEntry[]> {
    const backend = this.context.backend();
    const native = await nativeOf(backend);
    const limit = Math.min(count, this.topK);
    const entries = native
      ? await native.frequencyTop(this.key, limit)
      : await backend.rankedTop(`${this.key}.top`, limit);

    return entries.map((entry) => ({ value: entry.member, count: entry.score }));
  }
}
