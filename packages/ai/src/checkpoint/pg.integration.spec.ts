import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckpointRecord } from "../contracts/orchestrator/checkpoint-store.contract";
import { pg } from "./pg";

/**
 * The Postgres checkpoint store against a real server. Runs only when
 * `LOCAL_PG_DATABASE`, `LOCAL_PG_USER` and `LOCAL_PG_PASSWORD` name one
 * (`LOCAL_PG_HOST` / `LOCAL_PG_PORT` default to `127.0.0.1` / `5432`).
 */
const enabled = Boolean(process.env.LOCAL_PG_DATABASE && process.env.LOCAL_PG_USER);

const TABLE = "wjs_checkpoint_integration";

function record(
  turn: number,
  state: unknown,
  extra: Partial<CheckpointRecord> = {},
): CheckpointRecord {
  return {
    orchestrator_name: "support",
    session_id: "session_1",
    turn_index: turn,
    state,
    last_route: "billing",
    signature: "sig",
    version: null,
    summarized_through: null,
    lock_acquired_at: null,
    lock_expires_at: null,
    saved_at: new Date().toISOString(),
    ...extra,
  };
}

describe.skipIf(!enabled)("real PostgreSQL checkpoint store", () => {
  let pool: Pool;
  const store = () => pg({ client: pool, table: TABLE });

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.LOCAL_PG_HOST ?? "127.0.0.1",
      port: Number(process.env.LOCAL_PG_PORT ?? 5432),
      database: process.env.LOCAL_PG_DATABASE,
      user: process.env.LOCAL_PG_USER,
      password: process.env.LOCAL_PG_PASSWORD,
    });
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.query((store() as unknown as { schema(): string }).schema());
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.end();
  });

  it("saves, loads the latest turn and round-trips jsonb state", async () => {
    await store().save(record(0, { a: 1 }));
    await store().save(record(1, { a: 2, nested: { list: [1, 2] } }));

    const latest = await store().load("support", "session_1");

    expect(latest?.turn_index).toBe(1);
    expect(latest?.state).toEqual({ a: 2, nested: { list: [1, 2] } });
  });

  it("updates the same turn in place when the state is identical", async () => {
    await store().save(record(1, { a: 2, nested: { list: [1, 2] } }, { summarized_through: 1 }));

    const latest = await store().load("support", "session_1");

    expect(latest?.summarized_through).toBe(1);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
    expect(rows[0].n).toBe(2);
  });

  it("refuses a second save of the same turn with a different state", async () => {
    await expect(store().save(record(1, { a: 999 }))).rejects.toThrow(
      /already saved with a different state/,
    );

    const latest = await store().load("support", "session_1");
    expect(latest?.state).toEqual({ a: 2, nested: { list: [1, 2] } });
  });

  it("lists sessions by escaped prefix and prunes old turns", async () => {
    await store().save(record(0, {}, { session_id: "other%1" }));

    expect((await store().list("support", "session_")).sort()).toEqual(["session_1"]);
    expect(await store().list("support", "other%")).toEqual(["other%1"]);

    await store().prune("support", "session_1", 1);
    const rows = await pool.query(`SELECT turn_index FROM ${TABLE} WHERE session_id = 'session_1'`);
    expect(rows.rows.map((row) => row.turn_index)).toEqual([1]);

    await store().delete("support", "session_1");
    expect(await store().load("support", "session_1")).toBeUndefined();
  });
});
