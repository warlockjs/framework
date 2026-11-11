import { describe, expect, it } from "vitest";
import type { CheckpointRecord } from "../contracts/orchestrator/checkpoint-store.contract";
import type { RedisClientLike } from "../contracts/orchestrator/snapshot-store.contract";
import { redis } from "./redis";

/**
 * In-memory {@link RedisClientLike} — a `Map`-backed string KV with the
 * minimal `get` / `set` / `del` surface the contract declares (§8.4).
 * Captures the last `set` options arg so a test can assert TTL is
 * threaded through.
 */
class FakeRedisClient implements RedisClientLike {
  public store = new Map<string, string>();

  public lastSetArgs: unknown[] = [];

  public gets: string[] = [];

  public async get(key: string): Promise<string | null> {
    this.gets.push(key);

    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  public async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    this.store.set(key, value);
    this.lastSetArgs = args;

    return "OK";
  }

  public async del(key: string): Promise<number> {
    const existed = this.store.delete(key);

    return existed ? 1 : 0;
  }
}

/**
 * {@link FakeRedisClient} plus the camel-case set commands, so the store
 * keeps its session index as a Redis set. Yields between the read and the
 * write of each command so interleaved callers race like real clients.
 */
class FakeRedisSetClient extends FakeRedisClient {
  public sets = new Map<string, Set<string>>();

  public async sAdd(key: string, members: string | string[]): Promise<number> {
    await Promise.resolve();
    const set = this.sets.get(key) ?? new Set<string>();

    for (const member of Array.isArray(members) ? members : [members]) {
      set.add(member);
    }

    this.sets.set(key, set);

    return set.size;
  }

  public async sRem(key: string, members: string | string[]): Promise<number> {
    const set = this.sets.get(key);

    for (const member of Array.isArray(members) ? members : [members]) {
      set?.delete(member);
    }

    return set?.size ?? 0;
  }

  public async sMembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}

function makeRecord(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    orchestrator_name: "support",
    session_id: "sess-1",
    turn_index: 0,
    state: { count: 0 },
    last_route: null,
    signature: "sig-abc",
    version: null,
    summarized_through: null,
    lock_acquired_at: null,
    lock_expires_at: null,
    saved_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("checkpoint redis store", () => {
  it("should throw when no client is provided", () => {
    expect(() => redis({} as never)).toThrow(/client/);
  });

  it("should expose an empty schema for the redis store", () => {
    const store = redis({ client: new FakeRedisClient() });

    expect(store.schema()).toBe("");
  });

  it("should return undefined for an unknown session", async () => {
    const store = redis({ client: new FakeRedisClient() });

    const loaded = await store.load("support", "missing");

    expect(loaded).toBeUndefined();
  });

  it("should round-trip a saved checkpoint", async () => {
    const store = redis({ client: new FakeRedisClient() });
    const record = makeRecord({ state: { count: 7 } });

    await store.save(record);
    const loaded = await store.load("support", "sess-1");

    expect(loaded).toEqual(record);
  });

  it("should return the latest turn for a session", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 0, state: { count: 0 } }));
    await store.save(makeRecord({ turn_index: 1, state: { count: 1 } }));
    await store.save(makeRecord({ turn_index: 2, state: { count: 2 } }));

    const loaded = await store.load("support", "sess-1");

    expect(loaded?.turn_index).toBe(2);
    expect(loaded?.state).toEqual({ count: 2 });
  });

  it("should keep rows append-only without overwriting prior turns", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 0 }));
    await store.save(makeRecord({ turn_index: 1 }));

    expect((await store.load("support", "sess-1"))?.turn_index).toBe(1);
  });

  it("should round-trip a fan-out last_route array", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ last_route: ["lookup", "process"] }));
    const loaded = await store.load("support", "sess-1");

    expect(loaded?.last_route).toEqual(["lookup", "process"]);
  });

  it("should isolate sessions by orchestrator name and session id", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ orchestrator_name: "support", session_id: "a" }));
    await store.save(makeRecord({ orchestrator_name: "billing", session_id: "a" }));

    const supportSession = await store.load("support", "a");
    const billingSession = await store.load("billing", "a");

    expect(supportSession?.orchestrator_name).toBe("support");
    expect(billingSession?.orchestrator_name).toBe("billing");
  });

  it("should delete a session and de-index it", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 0 }));
    await store.save(makeRecord({ turn_index: 1 }));
    await store.delete("support", "sess-1");

    expect(await store.load("support", "sess-1")).toBeUndefined();
    expect(await store.list?.("support")).toEqual([]);
  });

  it("should list session ids scoped to an orchestrator", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ orchestrator_name: "support", session_id: "a" }));
    await store.save(makeRecord({ orchestrator_name: "support", session_id: "b" }));
    await store.save(makeRecord({ orchestrator_name: "billing", session_id: "c" }));

    const supportSessions = await store.list?.("support");

    expect(supportSessions?.sort()).toEqual(["a", "b"]);
  });

  it("should not duplicate a session id in the index across turns", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 0 }));
    await store.save(makeRecord({ turn_index: 1 }));
    await store.save(makeRecord({ turn_index: 2 }));

    expect(await store.list?.("support")).toEqual(["sess-1"]);
  });

  it("should filter listed sessions by prefix", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ session_id: "user-1" }));
    await store.save(makeRecord({ session_id: "user-2" }));
    await store.save(makeRecord({ session_id: "guest-1" }));

    const userSessions = await store.list?.("support", "user-");

    expect(userSessions?.sort()).toEqual(["user-1", "user-2"]);
  });

  it("should prune turns below the keep-before turn index", async () => {
    const client = new FakeRedisClient();
    const store = redis({ client });

    for (let turn = 0; turn <= 5; turn++) {
      await store.save(makeRecord({ turn_index: turn }));
    }

    await store.prune?.("support", "sess-1", 3);

    const turnKeys = [...client.store.keys()]
      .filter((key) => key.startsWith("warlock:orchestrator:turn:support:sess-1:"))
      .map((key) => Number(key.split(":").at(-1)))
      .sort((left, right) => left - right);

    expect(turnKeys).toEqual([3, 4, 5]);
    expect((await store.load("support", "sess-1"))?.turn_index).toBe(5);
  });

  it("should remove the whole session when the bound passes the latest turn", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 0 }));
    await store.save(makeRecord({ turn_index: 1 }));
    await store.prune?.("support", "sess-1", 2);

    expect(await store.load("support", "sess-1")).toBeUndefined();
    expect(await store.list?.("support")).toEqual([]);
  });

  it("should store one key per turn so a save never reads earlier rows", async () => {
    const client = new FakeRedisClient();
    const store = redis({ client });

    for (let turn = 0; turn < 5; turn++) {
      await store.save(makeRecord({ turn_index: turn }));
    }

    client.gets = [];
    await store.save(makeRecord({ turn_index: 5 }));

    expect(client.gets).toEqual(["warlock:orchestrator:session:support:sess-1"]);
    expect(client.store.get("warlock:orchestrator:session:support:sess-1")).toBe(
      JSON.stringify({ layout: 2, firstTurn: 0, latestTurn: 5 }),
    );
  });

  it("should let a re-save of the same turn replace that turn's row", async () => {
    const store = redis({ client: new FakeRedisClient() });

    await store.save(makeRecord({ turn_index: 3, lock_acquired_at: null }));
    await store.save(makeRecord({ turn_index: 3, lock_acquired_at: "2026-01-01T00:00:00.000Z" }));

    const loaded = await store.load("support", "sess-1");

    expect(loaded?.lock_acquired_at).toBe("2026-01-01T00:00:00.000Z");
  });

  describe("sessions written by the earlier single-document layout", () => {
    function seedLegacy(client: FakeRedisClient, turns: number[]): void {
      client.store.set(
        "warlock:orchestrator:session:support:sess-1",
        JSON.stringify({
          rows: turns.map((turn) => makeRecord({ turn_index: turn, state: { count: turn } })),
        }),
      );
      client.store.set(
        "warlock:orchestrator:index:support",
        JSON.stringify({ sessionIds: ["sess-1", "sess-2"] }),
      );
    }

    it("should load the latest row of an earlier-layout document", async () => {
      const client = new FakeRedisClient();
      seedLegacy(client, [0, 1, 2]);
      const store = redis({ client });

      const loaded = await store.load("support", "sess-1");

      expect(loaded?.turn_index).toBe(2);
      expect(loaded?.state).toEqual({ count: 2 });
    });

    it("should move earlier rows to per-turn keys on the next save", async () => {
      const client = new FakeRedisClient();
      seedLegacy(client, [0, 1, 2]);
      const store = redis({ client });

      await store.save(makeRecord({ turn_index: 3, state: { count: 3 } }));

      expect(client.store.get("warlock:orchestrator:session:support:sess-1")).toBe(
        JSON.stringify({ layout: 2, firstTurn: 0, latestTurn: 3 }),
      );
      expect(client.store.has("warlock:orchestrator:turn:support:sess-1:0")).toBe(true);
      expect((await store.load("support", "sess-1"))?.state).toEqual({ count: 3 });

      await store.prune?.("support", "sess-1", 2);

      expect(client.store.has("warlock:orchestrator:turn:support:sess-1:1")).toBe(false);
      expect(client.store.has("warlock:orchestrator:turn:support:sess-1:2")).toBe(true);
    });

    it("should prune an earlier-layout document by turn index", async () => {
      const client = new FakeRedisClient();
      seedLegacy(client, [0, 1, 2, 3, 4]);
      const store = redis({ client });

      await store.prune?.("support", "sess-1", 3);

      expect((await store.load("support", "sess-1"))?.turn_index).toBe(4);
      expect(client.store.has("warlock:orchestrator:turn:support:sess-1:2")).toBe(false);
      expect(client.store.has("warlock:orchestrator:turn:support:sess-1:3")).toBe(true);
    });

    it("should delete an earlier-layout session", async () => {
      const client = new FakeRedisClient();
      seedLegacy(client, [0, 1]);
      const store = redis({ client });

      await store.delete("support", "sess-1");

      expect(await store.load("support", "sess-1")).toBeUndefined();
      expect(await store.list?.("support")).toEqual(["sess-2"]);
    });

    it("should move the earlier JSON index into the Redis set", async () => {
      const client = new FakeRedisSetClient();
      seedLegacy(client, [0]);
      const store = redis({ client });

      await store.save(makeRecord({ session_id: "sess-3" }));

      expect((await store.list?.("support"))?.sort()).toEqual(["sess-1", "sess-2", "sess-3"]);
      expect(client.store.has("warlock:orchestrator:index:support")).toBe(false);
    });
  });

  describe("with a client that has set commands", () => {
    it("should keep every id when many sessions start at once", async () => {
      const store = redis({ client: new FakeRedisSetClient() });

      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          store.save(makeRecord({ session_id: `sess-${index}` })),
        ),
      );

      expect(await store.list?.("support")).toHaveLength(20);
    });

    it("should not read an index document on save", async () => {
      const client = new FakeRedisSetClient();
      const store = redis({ client });

      await store.save(makeRecord({ turn_index: 0 }));
      client.gets = [];
      await store.save(makeRecord({ turn_index: 1 }));

      expect(client.gets.some((key) => key.includes(":index:"))).toBe(false);
    });

    it("should de-index a deleted session", async () => {
      const store = redis({ client: new FakeRedisSetClient() });

      await store.save(makeRecord({ session_id: "a" }));
      await store.save(makeRecord({ session_id: "b" }));
      await store.delete("support", "a");

      expect(await store.list?.("support")).toEqual(["b"]);
    });

    it("should drop expired sessions from the index on list when a TTL is set", async () => {
      const client = new FakeRedisSetClient();
      const store = redis({ client, ttl: 60 });

      await store.save(makeRecord({ session_id: "a" }));
      await store.save(makeRecord({ session_id: "b" }));

      // Simulate the idle TTL expiring session "a".
      client.store.delete("warlock:orchestrator:session:support:a");

      expect(await store.list?.("support")).toEqual(["b"]);
      expect(await client.sMembers("warlock:orchestrator:sessions:support")).toEqual(["b"]);
    });
  });

  it("should attach the configured TTL to writes", async () => {
    const client = new FakeRedisClient();
    const store = redis({ client, ttl: 120 });

    await store.save(makeRecord());

    expect(client.lastSetArgs).toEqual([{ EX: 120 }]);
  });

  it("should honor a custom key prefix", async () => {
    const client = new FakeRedisClient();
    const store = redis({ client, prefix: "myapp" });

    await store.save(makeRecord());

    expect([...client.store.keys()]).toContain("myapp:session:support:sess-1");
    expect([...client.store.keys()]).toContain("myapp:turn:support:sess-1:0");
  });
});
