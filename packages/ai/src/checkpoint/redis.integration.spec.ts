import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckpointRecord } from "../contracts/orchestrator/checkpoint-store.contract";
import { redis } from "./redis";

/**
 * The Redis checkpoint store (one key per turn plus a session head, set-backed
 * session index) against a real server. Runs only when `WARLOCK_REDIS_INTEGRATION=1`;
 * `QUEUE_REDIS_HOST` / `QUEUE_REDIS_PORT` name the server (default `127.0.0.1:6390`).
 */
const enabled = process.env.WARLOCK_REDIS_INTEGRATION === "1";
const PREFIX = `wjs-checkpoint-it-${process.pid}`;

function record(
  turn: number,
  state: unknown,
  extra: Partial<CheckpointRecord> = {},
): CheckpointRecord {
  return {
    orchestrator_name: "support",
    session_id: "s1",
    turn_index: turn,
    state,
    last_route: null,
    signature: "sig",
    version: null,
    summarized_through: null,
    lock_acquired_at: null,
    lock_expires_at: null,
    saved_at: new Date().toISOString(),
    ...extra,
  };
}

describe.skipIf(!enabled)("real Redis checkpoint store", () => {
  let client: ReturnType<typeof createClient>;
  const store = () => redis({ client: client as never, prefix: PREFIX });

  beforeAll(async () => {
    client = createClient({
      socket: {
        host: process.env.QUEUE_REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.QUEUE_REDIS_PORT ?? 6390),
      },
    });
    await client.connect();
  });

  afterAll(async () => {
    const keys = await client.keys(`${PREFIX}*`);
    if (keys.length > 0) await client.del(keys);
    await client.quit();
  });

  it("writes one key per turn and loads the latest", async () => {
    await store().save(record(0, { a: 1 }));
    await store().save(record(1, { a: 2 }));
    await store().save(record(2, { a: 3 }));

    expect((await store().load("support", "s1"))?.state).toEqual({ a: 3 });

    const keys = await client.keys(`${PREFIX}*`);
    // session head + three turn keys + the session index
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(await store().list!("support")).toEqual(["s1"]);
  });

  it("prunes older turn keys and keeps the latest loadable", async () => {
    await store().prune!("support", "s1", 2);

    expect((await store().load("support", "s1"))?.turn_index).toBe(2);
    const turnKeys = (await client.keys(`${PREFIX}*`)).filter((key) => /[:/]2$|turn/.test(key));
    expect(turnKeys.length).toBeGreaterThan(0);
  });

  it("lists by prefix and deletes a session with its index entry", async () => {
    await store().save(record(0, {}, { session_id: "t_2" }));
    expect((await store().list!("support", "t_")).sort()).toEqual(["t_2"]);

    await store().delete("support", "s1");
    await store().delete("support", "t_2");

    expect(await store().load("support", "s1")).toBeUndefined();
    expect(await store().list!("support")).toEqual([]);
    expect(await client.keys(`${PREFIX}*`)).toEqual([]);
  });
});
