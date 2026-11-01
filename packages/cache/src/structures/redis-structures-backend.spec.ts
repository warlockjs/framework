import { beforeEach, describe, expect, it } from "vitest";
import { containsModule, RedisStructuresBackend } from "./redis-structures-backend";
import { createStructures } from "./structures";

/**
 * A small command interpreter that stands in for a Redis server. It models the
 * portable commands always, and the RedisBloom commands only when `module` is
 * set, the way a server without the module answers "unknown command".
 */
class FakeServer {
  public log: string[][] = [];
  public module = false;
  public moduleListFails = false;
  public bits = new Map<string, Set<number>>();
  public hashes = new Map<string, Map<string, number>>();
  public hlls = new Map<string, Set<string>>();
  public zsets = new Map<string, Map<string, number>>();
  public ttls = new Map<string, number>();
  public bloom = new Map<string, Set<string>>();
  public cuckoo = new Map<string, Map<string, number>>();
  public cms = new Map<string, Map<string, number>>();
  public topk = new Map<string, Map<string, number>>();

  public get commands() {
    return this.log.map((args) => args[0]);
  }

  public count(command: string) {
    return this.commands.filter((name) => name === command).length;
  }

  public async sendCommand(args: string[]): Promise<unknown> {
    this.log.push(args);

    const [command, key = "", ...rest] = args;
    const name = command!.toUpperCase();

    if (name === "MODULE") {
      if (this.moduleListFails) throw new Error("ERR unknown command 'MODULE'");

      return this.module ? [["name", "bf", "ver", 20812, "path", "/x", "args", []]] : [];
    }

    if (/^(BF|CF|CMS|TOPK)\./.test(name) && !this.module) {
      throw new Error(`ERR unknown command '${name}'`);
    }

    switch (name) {
      case "SETBIT": {
        const bits = this.bits.get(key) ?? new Set<number>();
        const offset = Number(rest[0]);
        const previous = bits.has(offset) ? 1 : 0;

        bits.add(offset);
        this.bits.set(key, bits);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return previous;
      }
      case "GETBIT":
        return this.bits.get(key)?.has(Number(rest[0])) ? 1 : 0;
      case "HINCRBY": {
        const hash = this.hashes.get(key) ?? new Map<string, number>();
        const next = (hash.get(rest[0]!) ?? 0) + Number(rest[1]);

        hash.set(rest[0]!, next);
        this.hashes.set(key, hash);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return next;
      }
      case "HMGET":
        return rest.map((field) => {
          const value = this.hashes.get(key)?.get(field);

          return value === undefined ? null : String(value);
        });
      case "PFADD": {
        const set = this.hlls.get(key) ?? new Set<string>();
        const before = set.size;

        set.add(rest[0]!);
        this.hlls.set(key, set);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return set.size > before ? 1 : 0;
      }
      case "PFCOUNT": {
        const union = new Set<string>();

        for (const name of [key, ...rest]) {
          this.hlls.get(name)?.forEach((member) => union.add(member));
        }

        return union.size;
      }
      case "ZADD": {
        const zset = this.zsets.get(key) ?? new Map<string, number>();

        zset.set(rest[1]!, Number(rest[0]));
        this.zsets.set(key, zset);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return 1;
      }
      case "ZREMRANGEBYRANK": {
        const zset = this.zsets.get(key)!;
        const ascending = [...zset].sort((a, b) => a[1] - b[1]);
        const stop = Number(rest[1]);
        const end = stop < 0 ? ascending.length + stop : stop;

        ascending.slice(Number(rest[0]), end + 1).forEach(([member]) => zset.delete(member));

        return 1;
      }
      case "ZREVRANGE": {
        const descending = [...(this.zsets.get(key) ?? [])].sort((a, b) => b[1] - a[1]);

        return descending
          .slice(Number(rest[0]), Number(rest[1]) + 1)
          .flatMap(([m, s]) => [m, String(s)]);
      }
      case "TTL":
        return this.ttls.get(key) ?? -2;
      case "EXPIRE":
        this.ttls.set(key, Number(rest[0]));

        return 1;
      case "BF.INSERT": {
        const item = rest[rest.indexOf("ITEMS") + 1]!;
        const filter = this.bloom.get(key) ?? new Set<string>();
        const isNew = !filter.has(item);

        filter.add(item);
        this.bloom.set(key, filter);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return [isNew ? 1 : 0];
      }
      case "BF.EXISTS":
        return this.bloom.get(key)?.has(rest[0]!) ? 1 : 0;
      case "CF.INSERT": {
        const item = rest[rest.indexOf("ITEMS") + 1]!;
        const filter = this.cuckoo.get(key) ?? new Map<string, number>();

        filter.set(item, (filter.get(item) ?? 0) + 1);
        this.cuckoo.set(key, filter);
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return [1];
      }
      case "CF.DEL": {
        const filter = this.cuckoo.get(key);
        const count = filter?.get(rest[0]!) ?? 0;

        if (count === 0) return 0;
        if (count === 1) {
          filter!.delete(rest[0]!);
        } else {
          filter!.set(rest[0]!, count - 1);
        }

        return 1;
      }
      case "CF.EXISTS":
        return this.cuckoo.get(key)?.has(rest[0]!) ? 1 : 0;
      case "CMS.INITBYDIM":
        if (this.cms.has(key)) throw new Error("CMS: key already exists");
        this.cms.set(key, new Map());

        return "OK";
      case "CMS.INCRBY": {
        const sketch = this.cms.get(key);

        if (!sketch) throw new Error("CMS: key does not exist");
        sketch.set(rest[0]!, (sketch.get(rest[0]!) ?? 0) + Number(rest[1]));
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return [sketch.get(rest[0]!)];
      }
      case "CMS.QUERY": {
        const sketch = this.cms.get(key);

        if (!sketch) throw new Error("CMS: key does not exist");

        return [sketch.get(rest[0]!) ?? 0];
      }
      case "TOPK.RESERVE":
        if (this.topk.has(key)) throw new Error("TOPK: key already exists");
        this.topk.set(key, new Map());

        return "OK";
      case "TOPK.INCRBY": {
        const list = this.topk.get(key);

        if (!list) throw new Error("TOPK: key does not exist");
        list.set(rest[0]!, (list.get(rest[0]!) ?? 0) + Number(rest[1]));
        if (!this.ttls.has(key)) {
          this.ttls.set(key, -1);
        }

        return [null];
      }
      case "TOPK.LIST": {
        const list = this.topk.get(key);

        if (!list) throw new Error("TOPK: key does not exist");

        return [...list].sort((a, b) => b[1] - a[1]).flatMap(([item, count]) => [item, count]);
      }
    }

    throw new Error(`FakeServer: unhandled command ${name}`);
  }
}

describe("RedisStructuresBackend", () => {
  let server: FakeServer;
  let backend: RedisStructuresBackend;

  const structures = () => createStructures(() => backend);

  beforeEach(() => {
    server = new FakeServer();
    backend = new RedisStructuresBackend(
      () => server,
      (key) => `app.${key}`,
    );
  });

  describe("without RedisBloom (portable path)", () => {
    it("runs a Bloom filter on bitmaps and never sends a module command", async () => {
      const filter = structures().bloom("names", { expectedItems: 1000 });

      expect(await filter.add("hasan")).toBe(true);
      expect(await filter.add("hasan")).toBe(false);
      expect(await filter.mightContain("hasan")).toBe(true);
      expect(await filter.mightContain("someone")).toBe(false);

      expect(server.count("SETBIT")).toBe(14); // 7 hashes, two adds
      expect(server.count("GETBIT")).toBeGreaterThan(0);
      expect(server.commands.some((name) => /^(BF|CF|CMS|TOPK)\./.test(name!))).toBe(false);
      expect([...server.bits.keys()]).toEqual(["app.structures.bloom.names"]);
    });

    it("probes MODULE LIST once and remembers the answer", async () => {
      const filter = structures().bloom("names", { expectedItems: 100 });

      await filter.add("a");
      await filter.mightContain("a");
      await filter.add("b");

      expect(server.count("MODULE")).toBe(1);
    });

    it("falls back when MODULE LIST is refused", async () => {
      server.moduleListFails = true;
      server.module = true;

      const filter = structures().bloom("names", { expectedItems: 100 });

      await filter.add("a");

      expect(server.count("SETBIT")).toBeGreaterThan(0);
      expect(server.count("BF.INSERT")).toBe(0);
    });

    it("implements the cuckoo filter as a counting filter in a hash", async () => {
      const filter = structures().cuckoo("banned", { expectedItems: 1000 });

      await filter.add("u1");
      await filter.add("u2");
      expect(await filter.mightContain("u1")).toBe(true);

      expect(await filter.remove("u1")).toBe(true);
      expect(await filter.mightContain("u1")).toBe(false);
      expect(await filter.mightContain("u2")).toBe(true);
      expect(await filter.remove("never-added")).toBe(false);

      expect(server.count("HINCRBY")).toBeGreaterThan(0);
      expect(server.hashes.has("app.structures.cuckoo.banned")).toBe(true);
    });

    it("counts distinct values with PFADD and PFCOUNT, and merges with a multi-key PFCOUNT", async () => {
      const unique = structures().uniqueCounter;

      await unique("dau.mon").add("a", "b");
      await unique("dau.tue").add("b", "c");

      expect(await unique("dau.mon").count()).toBe(2);
      expect(await unique.merge(["dau.mon", "dau.tue"]).count()).toBe(3);

      const merges = server.log.filter((args) => args[0] === "PFCOUNT");
      const merge = merges[merges.length - 1]!;
      expect(merge).toEqual([
        "PFCOUNT",
        "app.structures.unique.dau.mon",
        "app.structures.unique.dau.tue",
      ]);
    });

    it("tracks frequencies in a hash grid and the top list in a sorted set", async () => {
      const tracker = structures().frequency("terms", { width: 100, depth: 3, topK: 2 });

      await tracker.add("laptop", 5);
      await tracker.add("phone", 3);
      await tracker.add("cable", 1);
      await tracker.add("laptop", 2);

      expect(await tracker.estimate("laptop")).toBeGreaterThanOrEqual(7);
      expect(await tracker.estimate("unseen")).toBeLessThan(3);
      expect(await tracker.top()).toEqual([
        { value: "laptop", count: 7 },
        { value: "phone", count: 3 },
      ]);
      expect([...server.zsets.get("app.structures.frequency.terms.top")!.keys()].sort()).toEqual([
        "laptop",
        "phone",
      ]);
    });

    it("sets the ttl once, when the key is created, and never pushes it back", async () => {
      const filter = structures().bloom("temp", { expectedItems: 100, ttl: "1h" });

      await filter.add("a");
      expect(server.ttls.get("app.structures.bloom.temp")).toBe(3600);

      server.ttls.set("app.structures.bloom.temp", 120); // time has passed
      await filter.add("b");

      expect(server.ttls.get("app.structures.bloom.temp")).toBe(120);
    });

    it("sets no expiry without a ttl", async () => {
      await structures().uniqueCounter("forever").add("a");

      expect(server.count("EXPIRE")).toBe(0);
    });
  });

  describe("with RedisBloom (module path)", () => {
    beforeEach(() => {
      server.module = true;
    });

    it("uses BF.* and sizes the filter on creation", async () => {
      const filter = structures().bloom("names", { expectedItems: 5000, errorRate: 0.001 });

      expect(await filter.add("hasan")).toBe(true);
      expect(await filter.add("hasan")).toBe(false);
      expect(await filter.mightContain("hasan")).toBe(true);
      expect(await filter.mightContain("other")).toBe(false);

      const insert = server.log.find((args) => args[0] === "BF.INSERT")!;
      expect(insert).toEqual([
        "BF.INSERT",
        "app.structures.bloom.names",
        "CAPACITY",
        "5000",
        "ERROR",
        "0.001",
        "ITEMS",
        "hasan",
      ]);
      expect(server.count("SETBIT")).toBe(0);
    });

    it("uses CF.* for a real cuckoo filter with removal", async () => {
      const filter = structures().cuckoo("banned", { expectedItems: 1000 });

      await filter.add("u1");
      expect(await filter.mightContain("u1")).toBe(true);
      expect(await filter.remove("u1")).toBe(true);
      expect(await filter.mightContain("u1")).toBe(false);

      expect(server.count("CF.INSERT")).toBe(1);
      expect(server.count("HINCRBY")).toBe(0);
    });

    it("creates the Count-Min sketch and Top-K lazily, then reuses them", async () => {
      const tracker = structures().frequency("terms", { width: 500, depth: 4, topK: 5, ttl: "1h" });

      await tracker.add("laptop", 3);
      await tracker.add("laptop");
      await tracker.add("phone", 2);

      expect(server.count("CMS.INITBYDIM")).toBe(1);
      expect(server.count("TOPK.RESERVE")).toBe(1);
      expect(server.log.find((args) => args[0] === "CMS.INITBYDIM")).toEqual([
        "CMS.INITBYDIM",
        "app.structures.frequency.terms.cms",
        "500",
        "4",
      ]);
      expect(await tracker.estimate("laptop")).toBe(4);
      expect(await tracker.top(1)).toEqual([{ value: "laptop", count: 4 }]);
      expect(server.ttls.get("app.structures.frequency.terms.cms")).toBe(3600);
      expect(server.ttls.get("app.structures.frequency.terms.topk")).toBe(3600);
    });

    it("answers an unknown frequency key with 0 and an empty list", async () => {
      const tracker = structures().frequency("none");

      expect(await tracker.estimate("x")).toBe(0);
      expect(await tracker.top()).toEqual([]);
    });

    it("still counts distinct values with the native HyperLogLog", async () => {
      const counter = structures().uniqueCounter("dau");

      await counter.add("a", "b");

      expect(await counter.count()).toBe(2);
      expect(server.count("PFADD")).toBe(2);
    });

    it("surfaces errors that are not a missing key", async () => {
      server.sendCommand = async (args) => {
        if (args[0] === "MODULE") return [["name", "bf"]];

        throw new Error("OOM command not allowed when used memory > 'maxmemory'");
      };

      await expect(structures().frequency("terms").add("x")).rejects.toThrow("OOM");
    });
  });

  describe("containsModule()", () => {
    it("finds RedisBloom in the reply shapes clients return", () => {
      expect(containsModule([["name", "bf", "ver", 1]])).toBe(true);
      expect(containsModule([{ name: "bf", ver: 1 }])).toBe(true);
      expect(containsModule([["name", "RedisBloom"]])).toBe(true);
      expect(containsModule([["name", "search"]])).toBe(false);
      expect(containsModule([])).toBe(false);
    });
  });
});
