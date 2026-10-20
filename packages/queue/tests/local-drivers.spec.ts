import { resetRolesCacheForTests } from "@warlock.js/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  defineQueueContext,
  failedJobs,
  getQueue,
  getQueueDriver,
  queueConnector,
  queueDashboard,
  resetQueueConfig,
  resetQueueContext,
  retryFailedJob,
  runningWorkers,
  setQueueConfig,
  setQueueContext,
  startWorkers,
  UnrecoverableJobError,
  type QueueConfig,
} from "../src";
import { LocalDriver } from "../src/drivers/local";
import { MemoryStore } from "../src/drivers/memory-store";
import { SqliteStore } from "../src/drivers/sqlite-store";

// These cases never instantiate BullMQ or connect to Redis.
vi.mock("bullmq", () => ({
  Queue: class {
    constructor() {
      throw new Error("Unexpected Redis queue");
    }
  },
  Worker: class {
    constructor() {
      throw new Error("Unexpected Redis worker");
    }
  },
}));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function eventually(run: () => Promise<boolean> | boolean): Promise<void> {
  await vi.waitFor(async () => expect(await run()).toBe(true), { timeout: 5000, interval: 5 });
}
function gate(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

for (const driver of ["memory", "local"] as const) {
  describe(`${driver} queue driver`, () => {
    let directory: string;
    let config: QueueConfig;
    const extraDrivers: LocalDriver[] = [];

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "warlock-queue-"));
      config = {
        driver,
        defaultQueue: "local-spec",
        local: { path: join(directory, "queue.sqlite"), pollInterval: 5, leaseDuration: 300 },
      };
      setQueueConfig(config);
    });
    afterEach(async () => {
      await closeQueue({ timeout: 0 });
      for (const extra of extraDrivers.splice(0)) await extra.close(0);
      resetQueueConfig();
      resetQueueContext();
      await rm(directory, { recursive: true, force: true });
    });

    it("dispatches through the connector, stores progress/results and deduplicates ids", async () => {
      const connector = queueConnector({ config });
      const job = defineJob({
        name: "local.basic",
        async handle(payload: { value: number }, ctx) {
          await ctx.progress({ done: true });
          await ctx.log("processed");
          expect(ctx.attempt).toBe(1);
          return payload.value * 2;
        },
      });
      await job.dispatch({ value: 3 }, { jobId: "stable" });
      await job.dispatch({ value: 9 }, { jobId: "stable" });
      await connector.start();
      await eventually(async () => (await job.find("stable"))?.state === "completed");
      expect(await job.find("stable")).toMatchObject({
        payload: { value: 3 },
        result: 6,
        progress: { done: true },
        attemptsMade: 1,
        createdAt: expect.any(Date),
        finishedAt: expect.any(Date),
      });
      expect(runningWorkers()).toContain("local-spec");
      await connector.shutdown();
      expect(runningWorkers()).toEqual([]);
    });

    it("does not take delayed jobs early and orders ready jobs by priority then FIFO", async () => {
      const seen: { payload: number; at: number }[] = [];
      const job = defineJob({
        name: "local.priority",
        handle: (payload: number) => {
          seen.push({ payload, at: Date.now() });
        },
      });
      const dispatchedAt = Date.now();
      const delayed = await job.dispatch(4, { delay: "150ms" });
      expect((await job.find(delayed.id))?.state).toBe("delayed");
      await job.dispatch(3, { priority: 10 });
      await job.dispatch(2, { priority: 1 });
      await job.dispatch(0);
      await job.dispatch(1);
      await startWorkers();
      await eventually(() => seen.length === 5);
      // Durable writes can take longer than the delay on a slow machine, so the
      // delayed job may legitimately become ready before workers start. Assert the
      // guarantees themselves: never early, and ready jobs by priority then FIFO.
      expect(seen.filter(({ payload }) => payload !== 4).map(({ payload }) => payload)).toEqual([
        0, 1, 2, 3,
      ]);
      const delayedRun = seen.find(({ payload }) => payload === 4);
      expect(delayedRun).toBeDefined();
      expect((delayedRun?.at ?? 0) - dispatchedAt).toBeGreaterThanOrEqual(150);
    });

    it.each([
      20,
      { type: "fixed" as const, delay: 20 },
      { type: "exponential" as const, delay: 20 },
    ])("merges defaults and retries with backoff %j", async (backoff) => {
      setQueueConfig({ ...config, defaultJobOptions: { attempts: 2, backoff: 1 } });
      const started: number[] = [];
      const job = defineJob({
        name: "local.backoff",
        attempts: 3,
        backoff: 2,
        handle(_payload: {}, ctx) {
          started.push(Date.now());
          expect(ctx.maxAttempts).toBe(4);
          if (ctx.attempt < 4) throw new Error("temporary");
          return "ok";
        },
      });
      const { id } = await job.dispatch({}, { attempts: 4, backoff });
      await startWorkers();
      await eventually(async () => (await job.find(id))?.state === "completed");
      expect((await job.find(id))?.attemptsMade).toBe(4);
      const base = typeof backoff === "number" ? backoff : backoff.delay;
      for (let index = 1; index < started.length; index++) {
        const minimum =
          typeof backoff === "object" && backoff.type === "exponential"
            ? base * 2 ** (index - 1)
            : base;
        expect(Number(started[index]) - Number(started[index - 1])).toBeGreaterThanOrEqual(minimum);
      }
    });

    it("lists failures and supports both retry APIs with attempts reset", async () => {
      let shouldFail = true;
      const job = defineJob({
        name: "local.failure",
        attempts: 2,
        handle() {
          if (shouldFail) throw new Error("unavailable");
          return "recovered";
        },
      });
      const first = await job.dispatch({});
      await startWorkers();
      await eventually(async () => (await job.find(first.id))?.state === "failed");
      const second = await job.dispatch({});
      await eventually(async () => (await job.find(second.id))?.state === "failed");
      const failures = await failedJobs({ start: 0, end: -1 });
      expect(failures.map((entry) => entry.id)).toEqual([second.id, first.id]);
      expect(failures[0]).toMatchObject({
        attemptsMade: 2,
        failedReason: "unavailable",
        stacktrace: expect.any(Array),
      });
      shouldFail = false;
      await failures[0]?.retry();
      await retryFailedJob(first.id);
      await eventually(
        async () =>
          (await job.find(first.id))?.state === "completed" &&
          (await job.find(second.id))?.state === "completed",
      );
      expect((await job.find(first.id))?.attemptsMade).toBe(1);
      await expect(retryFailedJob("missing")).rejects.toThrow("No failed job");
    });

    it("fails unrecoverable and undefined jobs without spending all retries", async () => {
      const fatal = defineJob({
        name: "local.fatal",
        attempts: 5,
        handle() {
          throw new UnrecoverableJobError("permanent");
        },
      });
      const { id } = await fatal.dispatch({});
      const backend = getQueueDriver();
      await backend.dispatch({
        name: "local.missing",
        queue: "local-spec",
        data: {},
        options: { jobId: "missing-handler", attempts: 5 },
      });
      await startWorkers();
      await eventually(
        async () =>
          (await fatal.find(id))?.state === "failed" &&
          (await backend.find("local-spec", "missing-handler"))?.state === "failed",
      );
      expect((await fatal.find(id))?.attemptsMade).toBe(1);
      expect((await backend.find("local-spec", "missing-handler"))?.attemptsMade).toBe(1);
    });

    it("enforces concurrency per queue, including jobs registered after startup", async () => {
      setQueueConfig({ ...config, workers: { concurrency: 2 } });
      await startWorkers();
      const hold = gate();
      let active = 0;
      let maximum = 0;
      let done = 0;
      const job = defineJob({
        name: "local.concurrent",
        queue: "late-queue",
        async handle() {
          maximum = Math.max(maximum, ++active);
          await hold.promise;
          active--;
          done++;
        },
      });
      try {
        await Promise.all(Array.from({ length: 5 }, () => job.dispatch({})));
        await eventually(() => active === 2);
        await sleep(30);
        expect(maximum).toBe(2);
        expect(done).toBe(0);
      } finally {
        hold.release();
      }
      await eventually(() => done === 5);
      expect(maximum).toBe(2);
    });

    it("drains active jobs on shutdown and stops taking waiting jobs", async () => {
      const hold = gate();
      let started = 0;
      let finished = 0;
      const job = defineJob({
        name: "local.drain",
        async handle() {
          started++;
          await hold.promise;
          finished++;
        },
      });
      await job.dispatch({});
      const waiting = await job.dispatch({});
      await startWorkers();
      await eventually(() => started === 1);
      let closed = false;
      const closing = closeQueue({ timeout: 1000 }).then(() => {
        closed = true;
      });
      try {
        await sleep(20);
        expect(closed).toBe(false);
        expect(runningWorkers()).toEqual([]);
      } finally {
        hold.release();
      }
      await closing;
      expect(finished).toBe(1);
      expect(started).toBe(1);
      if (driver === "local") expect((await job.find(waiting.id))?.state).toBe("waiting");
      await closeQueue();
    });

    it("times out, aborts and releases work; fences off late writes from the old handler", async () => {
      const hold = gate();
      let signal: AbortSignal | undefined;
      let started = false;
      let lateWriteRejected = false;
      let oldFinished = false;
      const job = defineJob({
        name: "local.release",
        async handle(_payload: {}, ctx) {
          started = true;
          signal = ctx.signal;
          await hold.promise;
          try {
            await ctx.progress(99);
          } catch {
            lateWriteRejected = true;
          }
          oldFinished = true;
          return "old";
        },
      });
      const dispatched = await job.dispatch({});
      await startWorkers();
      await eventually(() => started);
      const closingAt = Date.now();
      await closeQueue({ timeout: 20 });
      expect(Date.now() - closingAt).toBeLessThan(500);
      expect(signal?.aborted).toBe(true);
      if (driver === "local") {
        expect((await job.find(dispatched.id))?.state).toBe("waiting");
        defineJob({ name: "local.release", handle: () => "new" });
        await startWorkers();
        await eventually(async () => (await job.find(dispatched.id))?.state === "completed");
      }
      hold.release();
      await eventually(() => oldFinished);
      expect(lateWriteRejected).toBe(true);
      if (driver === "local") expect((await job.find(dispatched.id))?.result).toBe("new");
    });

    it("restores captured context, permits opting out, and serializes payloads", async () => {
      const storage = new AsyncLocalStorage<string>();
      const seen: unknown[] = [];
      setQueueContext(
        defineQueueContext({
          capture: () => storage.getStore(),
          restore: (value, run) => storage.run(value, run),
        }),
      );
      const job = defineJob({
        name: "local.context",
        handle(payload: { value: number }, ctx) {
          seen.push([storage.getStore(), ctx.context, payload.value]);
        },
      });
      const bare = defineJob({
        name: "local.no-context",
        context: false,
        handle() {
          seen.push(storage.getStore());
        },
      });
      const payload = { value: 1 };
      await storage.run("tenant", () => job.dispatch(payload));
      payload.value = 2;
      await storage.run("tenant", () => bare.dispatch({}));
      await startWorkers();
      await eventually(() => seen.length === 2);
      expect(seen).toEqual([["tenant", "tenant", 1], undefined]);
    });

    it("honours completed/failed retention and job-name scoped find", async () => {
      const keep = defineJob({ name: "local.retain", removeOnComplete: 1, handle: () => "ok" });
      const other = defineJob({ name: "local.other", handle: () => undefined });
      const first = await keep.dispatch({});
      await startWorkers();
      await eventually(async () => (await keep.find(first.id))?.state === "completed");
      expect(await other.find(first.id)).toBeUndefined();
      const second = await keep.dispatch({});
      await eventually(async () => (await keep.find(second.id))?.state === "completed");
      expect(await keep.find(first.id)).toBeUndefined();
      const failed = defineJob({
        name: "local.remove-failed",
        removeOnFail: true,
        handle() {
          throw new Error("gone");
        },
      });
      const failure = await failed.dispatch({});
      await eventually(async () => (await failed.find(failure.id)) === undefined);
      expect(await failedJobs()).toEqual([]);
      const remove = defineJob({
        name: "local.remove-completed",
        removeOnComplete: true,
        handle: () => undefined,
      });
      const removed = await remove.dispatch({});
      await eventually(async () => (await remove.find(removed.id)) === undefined);
    });

    it("supports dispatch-only mode, rejects invalid settings, and guards BullMQ-only APIs", async () => {
      setQueueConfig({ ...config, workers: { enabled: false } });
      const job = defineJob({
        name: "local.disabled",
        handle: () => {
          throw new Error("should not run");
        },
      });
      expect(await startWorkers()).toEqual([]);
      const { id } = await job.dispatch({});
      await sleep(20);
      expect((await job.find(id))?.state).toBe("waiting");
      expect(() => getQueue("default")).toThrow("requires the bullmq");
      await expect(queueDashboard({ register() {} })).rejects.toThrow("requires the bullmq");
      await expect(
        queueConnector({ config: { ...config, dashboard: { enabled: true } } }).boot?.(),
      ).rejects.toThrow("requires the bullmq");
      await expect(job.dispatch({}, { attempts: 0 })).rejects.toThrow("attempts");
      await expect(job.dispatch({}, { backoff: -1 })).rejects.toThrow("backoff");
      await expect(job.dispatch({}, { priority: -1 })).rejects.toThrow("priority");
      await closeQueue();
      setQueueConfig({ ...config, workers: { concurrency: 0 } });
      expect(() => getQueueDriver()).toThrow("workers.concurrency");
    });

    it("honours worker role gating without starting consumers", async () => {
      const previousRoles = process.env.WARLOCK_ROLES;
      try {
        process.env.WARLOCK_ROLES = "web";
        resetRolesCacheForTests();
        defineJob({ name: "local.roles", handle: () => undefined });
        expect(await startWorkers()).toEqual([]);
        expect(runningWorkers()).toEqual([]);
      } finally {
        if (previousRoles === undefined) delete process.env.WARLOCK_ROLES;
        else process.env.WARLOCK_ROLES = previousRoles;
        resetRolesCacheForTests();
      }
    });

    it("rolls back invalid JSON dispatches and rejects invalid lease/poll intervals", async () => {
      const job = defineJob({ name: "local.invalid", handle: (_payload: unknown) => undefined });
      const circular: { self?: unknown } = {};
      circular.self = circular;
      await expect(job.dispatch(circular, { jobId: "invalid" })).rejects.toThrow();
      expect(await job.find("invalid")).toBeUndefined();
      await job.dispatch({}, { jobId: "valid" });
      expect((await job.find("valid"))?.state).toBe("waiting");
      await closeQueue();
      setQueueConfig({ ...config, local: { ...config.local, leaseDuration: 1 } });
      expect(() => getQueueDriver()).toThrow("local.leaseDuration");
      setQueueConfig({ ...config, local: { ...config.local, pollInterval: 0 } });
      expect(() => getQueueDriver()).toThrow("local.pollInterval");
    });

    it("competing consumers renew leases so a long handler is not claimed twice", async () => {
      const store = driver === "local" ? new SqliteStore(config) : new MemoryStore();
      const one = new LocalDriver(store, config);
      const two = new LocalDriver(driver === "local" ? new SqliteStore(config) : store, config);
      extraDrivers.push(one, two);
      const hold = gate();
      let calls = 0;
      defineJob({
        name: "local.lease-renewal",
        async handle() {
          calls++;
          await hold.promise;
          return "done";
        },
      });
      await one.dispatch({
        name: "local.lease-renewal",
        queue: "renewal",
        data: {},
        options: { jobId: "one" },
      });
      try {
        await one.start("renewal");
        await eventually(() => calls === 1);
        await two.start("renewal");
        await sleep(700);
        expect(calls).toBe(1);
      } finally {
        hold.release();
      }
      await eventually(async () => (await two.find("renewal", "one"))?.state === "completed");
    });
  });
}
