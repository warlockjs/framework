import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueCounts, resetQueueConfig, type JobState } from "../src";
import { BullMQDriver } from "../src/drivers/bullmq";
import { LocalDriver } from "../src/drivers/local";
import { MemoryStore } from "../src/drivers/memory-store";
import type { LocalJob, LocalStore } from "../src/drivers/local-store";
import { SqliteStore } from "../src/drivers/sqlite-store";

const getJobCounts = vi.fn(async () => ({
  waiting: 2,
  prioritized: 1,
  active: 3,
  delayed: 4,
  failed: 5,
  completed: 6,
}));

vi.mock("bullmq", () => ({
  Queue: class {
    on() {}
    getJobCounts = getJobCounts;
    async close() {}
  },
  Worker: class {},
}));

function job(queue: string, id: string, state: JobState): LocalJob {
  return {
    id,
    queue,
    name: "sample-job",
    data: {},
    options: {} as LocalJob["options"],
    state,
    createdAt: 0,
    readyAt: 0,
    attemptsMade: 0,
    priority: 0,
    progress: 0,
    logs: [],
    stacktrace: [],
    leaseUntil: 0,
  };
}

const fill = (store: LocalStore) => {
  const states: JobState[] = [
    "waiting",
    "prioritized",
    "delayed",
    "active",
    "failed",
    "failed",
    "completed",
  ];
  states.forEach((state, index) => store.put(job("shop", String(index), state)));
  store.put(job("other", "x", "waiting"));
};
const expected = { waiting: 2, active: 1, delayed: 1, failed: 2, completed: 1 };

describe("queue counts", () => {
  let directory: string | undefined;

  afterEach(async () => {
    resetQueueConfig();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("counts every state per queue in the memory store", () => {
    const store = new MemoryStore();
    fill(store);
    expect(store.counts("shop")).toEqual(expected);
    expect(store.counts("empty")).toEqual({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    });
  });

  it("counts every state per queue in the sqlite store", async () => {
    directory = await mkdtemp(join(tmpdir(), "warlock-counts-"));
    const store = new SqliteStore({ local: { path: join(directory, "queue.sqlite") } });
    fill(store);
    expect(store.counts("shop")).toEqual(expected);
    store.close();
  });

  it("exposes counts on the local driver", async () => {
    const store = new MemoryStore();
    fill(store);
    const driver = new LocalDriver(store, {});
    expect(await driver.counts("shop")).toEqual(expected);
    await driver.close(0);
  });

  it("maps BullMQ job counts, folding prioritized into waiting", async () => {
    const driver = new BullMQDriver({ connection: { host: "localhost" } });
    expect(await driver.counts("shop")).toEqual({
      waiting: 3,
      active: 3,
      delayed: 4,
      failed: 5,
      completed: 6,
    });
    await driver.close(0);
  });

  it("queueCounts resolves undefined without an active driver", async () => {
    expect(await queueCounts("shop")).toBeUndefined();
  });
});
