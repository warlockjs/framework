import { describe, expect, it } from "vitest";
import { memory as checkpointMemory } from "../checkpoint/memory";
import { pg as checkpointPg } from "../checkpoint/pg";
import { redis as checkpointRedis } from "../checkpoint/redis";
import type { CheckpointStore } from "../contracts/orchestrator/checkpoint-store.contract";
import { persistCheckpoint } from "./checkpoint";
import type { OrchestratorEngineContext } from "./engine-context.type";

/** `get`/`set`/`del` key-value client standing in for a connected redis client. */
class FakeRedisClient {
  public store = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);

    return "OK";
  }

  public async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

type FakeRow = { orchestrator_name: string; session_id: string; turn_index: number };

/**
 * Pattern-matching pg client: just the insert, the latest-row select and
 * the retention delete the checkpoint store issues.
 */
class FakePgClient {
  public rows: FakeRow[] = [];

  public async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql.startsWith("INSERT INTO")) {
      this.rows.push({
        orchestrator_name: params[0] as string,
        session_id: params[1] as string,
        turn_index: params[2] as number,
      });

      // `RETURNING turn_index` of the inserted row.
      return { rows: [{ turn_index: params[2] }] };
    }

    if (sql.startsWith("DELETE FROM") && sql.includes("turn_index < $3")) {
      const [name, sessionId, bound] = params as [string, string, number];

      this.rows = this.rows.filter(
        (row) =>
          !(
            row.orchestrator_name === name &&
            row.session_id === sessionId &&
            row.turn_index < bound
          ),
      );

      return { rows: [] };
    }

    throw new Error(`FakePgClient: unexpected query: ${sql}`);
  }
}

function makeContext(
  store: CheckpointStore,
  keepSnapshots: number,
): OrchestratorEngineContext<unknown, unknown> {
  return {
    config: { name: "support", keepSnapshots },
    signature: "sig",
    checkpointStore: store,
    snapshotStore: undefined,
    emitter: { emit: () => undefined },
  } as unknown as OrchestratorEngineContext<unknown, unknown>;
}

async function runTurns(store: CheckpointStore, turns: number, keepSnapshots: number) {
  const ctx = makeContext(store, keepSnapshots);

  for (let turnIndex = 0; turnIndex < turns; turnIndex++) {
    await persistCheckpoint({
      ctx,
      sessionId: "s1",
      turnIndex,
      state: { turnIndex },
      lastRoute: null,
      summarizedThrough: null,
    });
  }
}

describe("orchestrator checkpoint retention across stores", () => {
  it("keeps exactly the last keepSnapshots turns in the memory store", async () => {
    const store = checkpointMemory();

    await runTurns(store, 10, 3);

    const rows = (store as unknown as { sessions: Map<string, { turn_index: number }[]> }).sessions;
    const turns = [...rows.values()].flat().map((row) => row.turn_index);

    expect(turns).toEqual([7, 8, 9]);
  });

  it("keeps exactly the last keepSnapshots turns in the pg store", async () => {
    const client = new FakePgClient();
    const store = checkpointPg({ client });

    await runTurns(store, 10, 3);

    expect(client.rows.map((row) => row.turn_index)).toEqual([7, 8, 9]);
  });

  it("keeps exactly the last keepSnapshots turns in the redis store", async () => {
    const client = new FakeRedisClient();
    const store = checkpointRedis({ client });

    await runTurns(store, 10, 3);

    const turns = [...client.store.keys()]
      .filter((key) => key.startsWith("warlock:orchestrator:turn:support:s1:"))
      .map((key) => Number(key.split(":").at(-1)))
      .sort((left, right) => left - right);

    expect(turns).toEqual([7, 8, 9]);
    expect((await store.load("support", "s1"))?.turn_index).toBe(9);
  });
});
