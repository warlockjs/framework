import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  getQueueDriver,
  resetQueueConfig,
  setQueueConfig,
  startWorkers,
  type QueueConfig,
} from "../src";
import { SqliteStore } from "../src/drivers/sqlite-store";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fixture = fileURLToPath(new URL("./fixtures/local-worker.mjs", import.meta.url));
type Child = {
  process: ChildProcess;
  pid: number;
  exited: Promise<void>;
  starts: string[];
  ready: Promise<void>;
};

async function eventually(run: () => boolean | Promise<boolean>): Promise<void> {
  await vi.waitFor(async () => expect(await run()).toBe(true), { timeout: 10_000, interval: 10 });
}

// Only children created and recorded here are ever signalled.
async function stop(child: Child): Promise<void> {
  if (child.process.exitCode === null && child.process.signalCode === null)
    child.process.kill("SIGKILL");
  await child.exited;
}

function spawnWorker(config: QueueConfig, mode: "race" | "crash"): Child {
  const process = fork(fixture, [JSON.stringify(config), mode], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const pid = process.pid;
  if (pid === undefined) throw new Error("Could not start local queue child process.");
  const starts: string[] = [];
  let stderr = "";
  process.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Worker ${pid} did not start: ${stderr}`)),
      10_000,
    );
    process.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const value = message as { type?: string; id?: string };
      if (value.type === "started" && value.id) starts.push(value.id);
      if (value.type === "ready") {
        clearTimeout(timer);
        resolve();
      }
    });
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Worker ${pid} exited (${code ?? signal}): ${stderr}`));
    });
  });
  return { process, pid, starts, exited, ready };
}

describe("durable local queue processes", () => {
  let directory: string;
  let config: QueueConfig;
  const children: Child[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "warlock-queue-process-"));
    config = {
      driver: "local",
      local: { path: join(directory, "jobs.sqlite"), pollInterval: 10, leaseDuration: 1000 },
    };
    setQueueConfig(config);
  });
  afterEach(async () => {
    await Promise.all(children.splice(0).map(stop));
    await closeQueue({ timeout: 0 });
    resetQueueConfig();
    await rm(directory, { recursive: true, force: true });
  });

  it("survives storage close/reopen, retaining delayed jobs and failed attempts", async () => {
    let failed = true;
    const job = defineJob({
      name: "durable.restart",
      attempts: 2,
      backoff: 500,
      handle() {
        if (failed) throw new Error("retry after restart");
        return "ok";
      },
    });
    const dispatched = await job.dispatch({}, { delay: 100 });
    await closeQueue();
    expect((await job.find(dispatched.id))?.state).toBe("delayed");
    await startWorkers();
    await eventually(async () => (await job.find(dispatched.id))?.attemptsMade === 1);
    await closeQueue();
    expect(await job.find(dispatched.id)).toMatchObject({
      state: "delayed",
      attemptsMade: 1,
      failedReason: "retry after restart",
    });
    failed = false;
    await startWorkers();
    await eventually(async () => (await job.find(dispatched.id))?.state === "completed");
    expect((await job.find(dispatched.id))?.attemptsMade).toBe(2);
  });

  it("separates namespaces and queue names in the same SQLite file", async () => {
    const one = getQueueDriver();
    await one.dispatch({ name: "one", queue: "a", data: 1, options: { jobId: "same" } });
    await one.dispatch({ name: "two", queue: "b", data: 2, options: { jobId: "same" } });
    await closeQueue();
    setQueueConfig({ ...config, prefix: "another" });
    expect(await getQueueDriver().find("a", "same")).toBeUndefined();
    await closeQueue();
    setQueueConfig(config);
    expect((await getQueueDriver().find("a", "same"))?.payload).toBe(1);
    expect((await getQueueDriver().find("b", "same"))?.payload).toBe(2);
  });

  it("two independent worker processes claim each job only once", async () => {
    // Initialize schema first; both workers still race the same transactional claims.
    const producer = getQueueDriver();
    const first = spawnWorker(config, "race");
    children.push(first);
    const second = spawnWorker(config, "race");
    children.push(second);
    await Promise.all([first.ready, second.ready]);
    for (let index = 0; index < 12; index++) {
      await producer.dispatch({
        name: "process.job",
        queue: "process-queue",
        data: index,
        options: { jobId: `job-${index}` },
      });
    }
    await eventually(async () => {
      for (let index = 0; index < 12; index++)
        if ((await producer.find("process-queue", `job-${index}`))?.state !== "completed")
          return false;
      return true;
    });
    const starts = [...first.starts, ...second.starts];
    expect(starts).toHaveLength(12);
    expect(new Set(starts).size).toBe(12);
    expect(first.starts.length).toBeGreaterThan(0);
    expect(second.starts.length).toBeGreaterThan(0);
  });

  it("re-delivers a job from a killed process only after its unrenewed lease expires", async () => {
    const job = defineJob({
      name: "process.job",
      queue: "process-queue",
      handle: () => "recovered",
    });
    const { id } = await job.dispatch({ survives: true });
    const child = spawnWorker(config, "crash");
    children.push(child);
    await child.ready;
    await eventually(() => child.starts.includes(id));
    const inspection = new SqliteStore(config);
    let leaseUntil: number;
    try {
      leaseUntil = inspection.get("process-queue", id)?.leaseUntil ?? 0;
    } finally {
      inspection.close();
    }
    await stop(child);
    expect(leaseUntil).toBeGreaterThan(Date.now());
    await startWorkers();
    await sleep(50);
    expect((await job.find(id))?.state).toBe("active");
    await eventually(async () => (await job.find(id))?.state === "completed");
    expect(Date.now()).toBeGreaterThanOrEqual(leaseUntil);
    expect(await job.find(id)).toMatchObject({
      result: "recovered",
      attemptsMade: 1,
      payload: { survives: true },
    });
  });

  it.each(["expired", "replaced"] as const)(
    "rejects acknowledgements and progress from an %s lease owner",
    async (ownership) => {
      const store = new SqliteStore(config);
      let release = () => {};
      let started = false;
      let rejected = false;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const job = defineJob({
        name: "durable.fenced",
        async handle(_payload: {}, ctx) {
          started = true;
          await hold;
          try {
            await ctx.progress(100);
          } catch {
            rejected = true;
          }
          return "old owner";
        },
      });
      try {
        const { id } = await job.dispatch({});
        await startWorkers();
        await eventually(() => started);
        store.transaction(() => {
          const record = store.get(job.queue, id);
          if (!record) throw new Error("Missing active job");
          if (ownership === "replaced") record.token = "replacement-owner";
          record.leaseUntil = ownership === "expired" ? Date.now() - 1 : Date.now() + 10_000;
          store.put(record);
        });
        // Stop further claims, keeping storage open while the old handler drains.
        const closing = closeQueue({ timeout: 1000 });
        release();
        await closing;
        expect(rejected).toBe(true);
        expect(store.get(job.queue, id)).toMatchObject({ state: "active", progress: 0 });
        expect(store.get(job.queue, id)?.result).toBeUndefined();
      } finally {
        release();
        store.close();
      }
    },
  );
});
