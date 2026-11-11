import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn(async (_name: string, _data: unknown, _opts: unknown) => ({ id: "1" }));

vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: class {
      add = add;
      on(): void {}
      async close(): Promise<void> {}
    },
  };
});

import {
  closeQueue,
  defineJob,
  InvalidJobDefinitionError,
  resetQueueConfig,
  setQueueConfig,
} from "../src";
import type { LocalJob, LocalStore } from "../src/drivers/local-store";
import { LocalDriver } from "../src/drivers/local";
import { MemoryStore } from "../src/drivers/memory-store";
import { SqliteStore } from "../src/drivers/sqlite-store";
import { resolveJobOptions } from "../src/job-options";

const DAY = 24 * 3600 * 1000;

function finishedJob(
  id: string,
  finishedAt: number,
  state: "completed" | "failed" = "completed",
): LocalJob {
  return {
    id,
    queue: "q",
    name: "retained",
    data: { __warlock: { v: 2 }, payload: { id } },
    options: {},
    state,
    createdAt: finishedAt,
    readyAt: finishedAt,
    attemptsMade: 1,
    priority: 0,
    progress: 0,
    logs: [],
    stacktrace: [],
    finishedAt,
    leaseUntil: 0,
  };
}

afterEach(async () => {
  await closeQueue({ timeout: 0 });
  resetQueueConfig();
  add.mockClear();
});

describe("job retention defaults", () => {
  it("bounds completed and failed jobs when nothing configures retention", () => {
    setQueueConfig({ driver: "memory" });
    const resolved = resolveJobOptions({}, {});

    expect(resolved.removeOnComplete).toEqual({ age: DAY, count: 1000 });
    expect(resolved.removeOnFail).toEqual({ age: 7 * DAY, count: 5000 });
  });

  it("keeps everything with false, and app or job settings win over the default", () => {
    setQueueConfig({ driver: "memory", defaultJobOptions: { removeOnComplete: false } });

    expect(resolveJobOptions({}, {}).removeOnComplete).toBe(false);
    expect(resolveJobOptions({ removeOnFail: false }, {}).removeOnFail).toBe(false);
    expect(resolveJobOptions({ removeOnComplete: 50 }, {}).removeOnComplete).toBe(50);
    expect(resolveJobOptions({ removeOnComplete: { age: "2h" } }, {}).removeOnComplete).toEqual({
      age: 2 * 3600 * 1000,
    });
  });

  it("rejects a retention window without age or count, or with a bad count", () => {
    setQueueConfig({ driver: "memory" });

    expect(() => resolveJobOptions({ removeOnComplete: {} }, {})).toThrow(
      InvalidJobDefinitionError,
    );
    expect(() => resolveJobOptions({ removeOnFail: { count: -1 } }, {})).toThrow(
      "removeOnFail.count",
    );
  });

  it("hands BullMQ its native retention, with age in seconds", async () => {
    setQueueConfig({ connection: {} });
    const job = defineJob({ name: "retention.bullmq", handle: async (_p: {}) => {} });

    await job.dispatch({});

    const options = add.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(options.removeOnComplete).toEqual({ age: 24 * 3600, count: 1000 });
    expect(options.removeOnFail).toEqual({ age: 7 * 24 * 3600, count: 5000 });
  });
});

describe("local store pruning", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "warlock-retention-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const stores: Array<[string, () => LocalStore]> = [
    ["memory", () => new MemoryStore()],
    ["sqlite", () => new SqliteStore({ local: { path: join(directory, "queue.sqlite") } })],
  ];

  for (const [type, create] of stores) {
    it(`${type}: keeps the newest N by finish time and drops jobs past the age window`, () => {
      const store = create();
      try {
        for (let index = 0; index < 1100; index++)
          store.put(finishedJob(`j${index}`, 1000 + index));
        store.put(finishedJob("failed", 1, "failed"));

        store.transaction(() => store.prune("q", "completed", { count: 1000 }));
        const kept = store.list("q", "completed");
        expect(kept).toHaveLength(1000);
        expect(kept.map((job) => job.id)).not.toContain("j99");
        expect(kept.map((job) => job.id)).toContain("j100");

        store.transaction(() => store.prune("q", "completed", { before: 2000 }));
        expect(store.list("q", "completed").map((job) => job.id)).toEqual(
          Array.from({ length: 100 }, (_, index) => `j${1000 + index}`),
        );
        // Other states are never touched.
        expect(store.list("q", "failed")).toHaveLength(1);
      } finally {
        store.close();
      }
    });
  }

  it("sqlite: prunes with one statement and never decodes the rows", () => {
    const store = new SqliteStore({ local: { path: join(directory, "queue.sqlite") } });
    try {
      for (let index = 0; index < 20; index++) store.put(finishedJob(`j${index}`, index));
      const db = (store as unknown as { db: { prepare: (sql: string) => unknown } }).db;
      const prepare = vi.spyOn(db, "prepare");
      const list = vi.spyOn(store, "list");

      store.prune("q", "completed", { count: 5, before: 3 });

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(String(prepare.mock.calls[0]?.[0])).toMatch(/^DELETE/);
      expect(list).not.toHaveBeenCalled();
      expect(store.list("q", "completed")).toHaveLength(5);
    } finally {
      store.close();
    }
  });

  it("a finished job with numeric retention prunes without listing the whole state", async () => {
    const store = new MemoryStore();
    const driver = new LocalDriver(store, { driver: "memory", local: { pollInterval: 1 } });
    const list = vi.spyOn(store, "list");
    const prune = vi.spyOn(store, "prune");
    defineJob({ name: "retention.local", removeOnComplete: 1, handle: () => "ok" });
    setQueueConfig({ driver: "memory" });
    try {
      for (let index = 0; index < 3; index++) {
        await driver.dispatch({
          name: "retention.local",
          queue: "q",
          data: {},
          options: resolveJobOptions({ removeOnComplete: 1 }, {}),
        });
      }
      await driver.start("q");
      await vi.waitFor(() => expect(prune).toHaveBeenCalledTimes(3), {
        timeout: 5000,
        interval: 5,
      });

      expect(prune).toHaveBeenCalledWith("q", "completed", { count: 1 });
      expect(list).not.toHaveBeenCalled();
      expect(store.list("q", "completed")).toHaveLength(1);
    } finally {
      await driver.close(0);
    }
  });
});

describe("memory store", () => {
  it("copies only the chosen job when polling, however many finished jobs are kept", () => {
    const store = new MemoryStore();
    for (let index = 0; index < 10_000; index++) store.put(finishedJob(`done${index}`, index));
    store.put({ ...finishedJob("next", 0), state: "waiting", finishedAt: undefined, readyAt: 0 });
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      const candidate = store.transaction(() => store.ready("q", Date.now()));

      expect(candidate?.id).toBe("next");
      // One copy of the candidate (jsonCopy), nothing per kept job.
      expect(stringify).toHaveBeenCalledTimes(1);
    } finally {
      stringify.mockRestore();
    }
  });

  it("rolls back puts and removals, keeping the original order", () => {
    const store = new MemoryStore();
    store.put({ ...finishedJob("a", 0), state: "waiting", readyAt: 0 });
    store.put({ ...finishedJob("b", 0), state: "waiting", readyAt: 0 });
    store.put({ ...finishedJob("c", 0), state: "waiting", readyAt: 0 });

    expect(() =>
      store.transaction(() => {
        store.put({ ...finishedJob("b", 0), state: "active", readyAt: 0 });
        store.remove("q", "a");
        store.put({ ...finishedJob("d", 0), state: "waiting", readyAt: 0 });
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(store.list("q").map((job) => [job.id, job.state])).toEqual([
      ["a", "waiting"],
      ["b", "waiting"],
      ["c", "waiting"],
    ]);
    // FIFO among equal priorities is unchanged after the rollback.
    expect(store.ready("q", Date.now())?.id).toBe("a");
  });
});
