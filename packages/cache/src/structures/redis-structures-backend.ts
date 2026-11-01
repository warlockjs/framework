import type {
  CacheStructuresBackend,
  NativeStructures,
  RankedEntry,
  StructureWrite,
} from "./types";

/** The one client method this backend needs; both redis v4 and v5 clients have it. */
type CommandClient = {
  sendCommand(args: string[]): Promise<unknown>;
};

/**
 * Redis implementation of the structure primitives.
 *
 * Portable path (any Redis): bitmaps (`SETBIT` / `GETBIT`), hashes
 * (`HINCRBY`), native HyperLogLog (`PFADD` / `PFCOUNT`) and sorted sets.
 * When the server runs RedisBloom, {@link native} exposes `BF.*`, `CF.*`,
 * `CMS.*` and `TOPK.*` operations, detected once with `MODULE LIST`.
 */
export class RedisStructuresBackend implements CacheStructuresBackend {
  protected nativeProbe?: Promise<NativeStructures | null>;

  public constructor(
    protected readonly getClient: () => CommandClient,
    protected readonly parseKey: (key: string) => string,
  ) {}

  protected send(args: Array<string | number>): Promise<unknown> {
    return this.getClient().sendCommand(args.map(String));
  }

  /**
   * Give a key without an expiry its ttl. A key that already expires keeps its
   * deadline, so later writes never push the window back.
   */
  protected async applyTtl(key: string, options?: StructureWrite) {
    if (!options?.ttl || !Number.isFinite(options.ttl)) {
      return;
    }

    if (Number(await this.send(["TTL", key])) === -1) {
      await this.send(["EXPIRE", key, Math.ceil(options.ttl)]);
    }
  }

  public async bitSet(key: string, offsets: number[], options?: StructureWrite) {
    const parsed = this.parseKey(key);
    const previous = await Promise.all(
      offsets.map((offset) => this.send(["SETBIT", parsed, offset, 1])),
    );

    await this.applyTtl(parsed, options);

    return previous.map((value) => Number(value) === 1);
  }

  public async bitGet(key: string, offsets: number[]) {
    const parsed = this.parseKey(key);
    const bits = await Promise.all(offsets.map((offset) => this.send(["GETBIT", parsed, offset])));

    return bits.map((value) => Number(value) === 1);
  }

  public async gridAdd(key: string, cells: number[], delta: number, options?: StructureWrite) {
    const parsed = this.parseKey(key);
    const values = await Promise.all(
      cells.map((cell) => this.send(["HINCRBY", parsed, cell, delta])),
    );

    await this.applyTtl(parsed, options);

    return values.map((value) => Math.max(0, Number(value)));
  }

  public async gridGet(key: string, cells: number[]) {
    if (cells.length === 0) {
      return [];
    }

    const values = (await this.send(["HMGET", this.parseKey(key), ...cells])) as Array<
      string | null
    >;

    return values.map((value) => Math.max(0, Number(value ?? 0)));
  }

  public async uniqueAdd(key: string, member: string, options?: StructureWrite) {
    const parsed = this.parseKey(key);
    const changed = await this.send(["PFADD", parsed, member]);

    await this.applyTtl(parsed, options);

    return Number(changed) === 1;
  }

  public async uniqueCount(keys: string[]) {
    if (keys.length === 0) {
      return 0;
    }

    return Number(await this.send(["PFCOUNT", ...keys.map((key) => this.parseKey(key))]));
  }

  public async rankedSet(
    key: string,
    member: string,
    score: number,
    capacity: number,
    options?: StructureWrite,
  ) {
    const parsed = this.parseKey(key);

    await this.send(["ZADD", parsed, score, member]);
    await this.send(["ZREMRANGEBYRANK", parsed, 0, -(capacity + 1)]);
    await this.applyTtl(parsed, options);
  }

  public async rankedTop(key: string, count: number): Promise<RankedEntry[]> {
    const flat = (await this.send([
      "ZREVRANGE",
      this.parseKey(key),
      0,
      count - 1,
      "WITHSCORES",
    ])) as Array<string | number>;

    return pairs(flat).map(([member, score]) => ({ member: String(member), score: Number(score) }));
  }

  public native(): Promise<NativeStructures | null> {
    this.nativeProbe ??= this.detectModule().then((present) =>
      present ? this.createNative() : null,
    );

    return this.nativeProbe;
  }

  protected async detectModule(): Promise<boolean> {
    try {
      return containsModule(await this.send(["MODULE", "LIST"]));
    } catch {
      // MODULE LIST can be disabled by ACLs or on managed Redis: use the portable path.
      return false;
    }
  }

  /** Run `command`; when the key is missing, `init` creates it and `command` runs again. */
  protected async withInit<T>(command: () => Promise<T>, init: () => Promise<unknown>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      if (!/not exist|no such key|not found/i.test(String((error as Error)?.message))) {
        throw error;
      }

      try {
        await init();
      } catch (initError) {
        if (!/exist/i.test(String((initError as Error)?.message))) {
          throw initError;
        }
      }

      return command();
    }
  }

  protected createNative(): NativeStructures {
    const first = (reply: unknown) => (Array.isArray(reply) ? reply[0] : reply);

    return {
      bloomAdd: async (key, item, { capacity, errorRate, ttl }) => {
        const parsed = this.parseKey(key);
        const reply = await this.send([
          "BF.INSERT",
          parsed,
          "CAPACITY",
          capacity,
          "ERROR",
          errorRate,
          "ITEMS",
          item,
        ]);

        await this.applyTtl(parsed, { ttl });

        return Number(first(reply)) === 1;
      },
      bloomExists: async (key, item) =>
        Number(await this.send(["BF.EXISTS", this.parseKey(key), item])) === 1,
      cuckooAdd: async (key, item, { capacity, ttl }) => {
        const parsed = this.parseKey(key);
        const reply = await this.send(["CF.INSERT", parsed, "CAPACITY", capacity, "ITEMS", item]);

        await this.applyTtl(parsed, { ttl });

        return Number(first(reply)) === 1;
      },
      cuckooRemove: async (key, item) =>
        Number(await this.send(["CF.DEL", this.parseKey(key), item])) === 1,
      cuckooExists: async (key, item) =>
        Number(await this.send(["CF.EXISTS", this.parseKey(key), item])) === 1,
      frequencyAdd: async (key, item, count, { width, depth, topK, ttl }) => {
        const cms = `${this.parseKey(key)}.cms`;
        const top = `${this.parseKey(key)}.topk`;

        await this.withInit(
          () => this.send(["CMS.INCRBY", cms, item, count]),
          () => this.send(["CMS.INITBYDIM", cms, width, depth]),
        );
        await this.withInit(
          () => this.send(["TOPK.INCRBY", top, item, count]),
          () => this.send(["TOPK.RESERVE", top, topK, width, depth, "0.9"]),
        );
        await this.applyTtl(cms, { ttl });
        await this.applyTtl(top, { ttl });
      },
      frequencyEstimate: async (key, item) => {
        try {
          return Number(first(await this.send(["CMS.QUERY", `${this.parseKey(key)}.cms`, item])));
        } catch (error) {
          if (/not exist|no such key|not found/i.test(String((error as Error)?.message))) {
            return 0;
          }

          throw error;
        }
      },
      frequencyTop: async (key, count) => {
        try {
          const flat = (await this.send([
            "TOPK.LIST",
            `${this.parseKey(key)}.topk`,
            "WITHCOUNT",
          ])) as Array<string | number>;

          return pairs(flat)
            .map(([member, score]) => ({ member: String(member), score: Number(score) }))
            .slice(0, count);
        } catch (error) {
          if (/not exist|no such key|not found/i.test(String((error as Error)?.message))) {
            return [];
          }

          throw error;
        }
      },
    };
  }
}

function pairs<T>(flat: T[]): Array<[T, T]> {
  const result: Array<[T, T]> = [];

  for (let index = 0; index + 1 < flat.length; index += 2) {
    result.push([flat[index]!, flat[index + 1]!]);
  }

  return result;
}

/** True when a `MODULE LIST` reply (any client shape) names the RedisBloom module. */
export function containsModule(reply: unknown): boolean {
  if (typeof reply === "string") {
    const name = reply.toLowerCase();

    return name === "bf" || name === "redisbloom";
  }

  if (Array.isArray(reply)) {
    return reply.some(containsModule);
  }

  if (reply && typeof reply === "object") {
    return Object.values(reply).some(containsModule);
  }

  return false;
}
