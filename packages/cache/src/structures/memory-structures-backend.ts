import { HyperLogLog } from "./hyperloglog";
import type {
  CacheStructuresBackend,
  RankedEntry,
  StructureWrite,
} from "./types";

type Slot =
  | { type: "bits"; value: Uint8Array; expiresAt?: number }
  | { type: "grid"; value: Map<number, number>; expiresAt?: number }
  | { type: "unique"; value: HyperLogLog; expiresAt?: number }
  | { type: "ranked"; value: Map<string, number>; expiresAt?: number };

/**
 * In-process implementation of the structure primitives, shared by the memory
 * family of drivers. State lives next to the driver's entries and follows its
 * `flush()` and `removeNamespace()`.
 */
export class MemoryStructuresBackend implements CacheStructuresBackend {
  protected slots = new Map<string, Slot>();

  /**
   * @param parseKey the owning driver's key parser (applies the cache prefix)
   */
  public constructor(protected readonly parseKey: (key: string) => string) {}

  /** Drop every structure. */
  public clear() {
    this.slots.clear();
  }

  /** Drop every structure whose parsed key starts with `prefix`. */
  public clearPrefix(prefix: string) {
    for (const key of [...this.slots.keys()]) {
      if (key.startsWith(prefix)) {
        this.slots.delete(key);
      }
    }
  }

  public async bitSet(key: string, offsets: number[], options?: StructureWrite) {
    const slot = this.slot(key, "bits", () => new Uint8Array(0), options);
    const maxOffset = offsets.reduce((max, offset) => Math.max(max, offset), 0);
    const needed = (maxOffset >> 3) + 1;

    if (slot.value.length < needed) {
      const grown = new Uint8Array(Math.max(needed, slot.value.length * 2));

      grown.set(slot.value);
      slot.value = grown;
    }

    return offsets.map((offset) => {
      const mask = 1 << (offset & 7);
      const byte = slot.value[offset >> 3] ?? 0;
      const previous = (byte & mask) !== 0;

      slot.value[offset >> 3] = byte | mask;

      return previous;
    });
  }

  public async bitGet(key: string, offsets: number[]) {
    const slot = this.find(key, "bits");

    return offsets.map((offset) => {
      const byte = slot?.value[offset >> 3];

      return byte !== undefined && (byte & (1 << (offset & 7))) !== 0;
    });
  }

  public async gridAdd(key: string, cells: number[], delta: number, options?: StructureWrite) {
    const slot = this.slot(key, "grid", () => new Map<number, number>(), options);

    return cells.map((cell) => {
      const next = Math.max(0, (slot.value.get(cell) ?? 0) + delta);

      if (next === 0) {
        slot.value.delete(cell);
      } else {
        slot.value.set(cell, next);
      }

      return next;
    });
  }

  public async gridGet(key: string, cells: number[]) {
    const slot = this.find(key, "grid");

    return cells.map((cell) => slot?.value.get(cell) ?? 0);
  }

  public async uniqueAdd(key: string, member: string, options?: StructureWrite) {
    return this.slot(key, "unique", () => new HyperLogLog(), options).value.add(member);
  }

  public async uniqueCount(keys: string[]) {
    const merged = new HyperLogLog();

    for (const key of keys) {
      const slot = this.find(key, "unique");

      if (slot) {
        merged.merge(slot.value);
      }
    }

    return merged.count();
  }

  public async rankedSet(
    key: string,
    member: string,
    score: number,
    capacity: number,
    options?: StructureWrite,
  ) {
    const slot = this.slot(key, "ranked", () => new Map<string, number>(), options);

    slot.value.set(member, score);

    if (slot.value.size > capacity) {
      let lowest: string | undefined;

      for (const [candidate, candidateScore] of slot.value) {
        if (lowest === undefined || candidateScore < slot.value.get(lowest)!) {
          lowest = candidate;
        }
      }

      slot.value.delete(lowest!);
    }
  }

  public async rankedTop(key: string, count: number): Promise<RankedEntry[]> {
    const slot = this.find(key, "ranked");

    if (!slot) {
      return [];
    }

    return [...slot.value]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score || (a.member < b.member ? -1 : 1))
      .slice(0, count);
  }

  protected find<T extends Slot["type"]>(
    key: string,
    type: T,
  ): Extract<Slot, { type: T }> | undefined {
    const parsed = this.parseKey(key);
    const slot = this.slots.get(parsed);

    if (!slot) {
      return undefined;
    }

    if (slot.expiresAt !== undefined && slot.expiresAt <= Date.now()) {
      this.slots.delete(parsed);

      return undefined;
    }

    return slot.type === type ? (slot as Extract<Slot, { type: T }>) : undefined;
  }

  protected slot<T extends Slot["type"]>(
    key: string,
    type: T,
    create: () => Extract<Slot, { type: T }>["value"],
    options?: StructureWrite,
  ): Extract<Slot, { type: T }> {
    const existing = this.find(key, type);

    if (existing) {
      return existing;
    }

    const slot = { type, value: create() } as Slot;

    if (options?.ttl && Number.isFinite(options.ttl)) {
      slot.expiresAt = Date.now() + options.ttl * 1000;
    }

    this.slots.set(this.parseKey(key), slot);

    return slot as Extract<Slot, { type: T }>;
  }
}
