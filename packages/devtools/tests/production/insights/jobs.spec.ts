import { closeQueue, defineJob, resetQueueConfig, setQueueConfig } from "@warlock.js/queue";
import { afterEach, describe, expect, it } from "vitest";
import { createJobsReader } from "../../../src/production/insights";

describe("createJobsReader", () => {
  it("reports both parts unavailable when the packages are absent", async () => {
    const read = createJobsReader({ scheduler: async () => null, queue: async () => null });

    expect(await read()).toEqual({
      available: { scheduler: false, queue: false },
      schedules: [],
      queues: [],
    });
  });

  it("maps scheduler jobs and queue counts when present", async () => {
    const read = createJobsReader({
      scheduler: async () => [
        {
          name: "cleanup",
          cronExpression: "0 * * * *",
          isRunning: true,
          lastRun: new Date(1000),
          nextRun: new Date(2000),
        },
        { name: "poll", intervals: { every: { type: "minute", value: 5 } } },
      ],
      queue: async () => [{ name: "mail", counts: { waiting: 3, failed: 1 } }],
    });
    const report = await read();

    expect(report.available).toEqual({ scheduler: true, queue: true });
    expect(report.schedules[0]).toMatchObject({
      name: "cleanup",
      cron: "0 * * * *",
      interval: null,
      isRunning: true,
      lastRunAt: 1000,
      nextRunAt: 2000,
    });
    expect(report.schedules[1]).toMatchObject({
      name: "poll",
      cron: null,
      interval: "every 5 minutes",
      lastRunAt: null,
    });
    expect(report.queues).toEqual([{ name: "mail", counts: { waiting: 3, failed: 1 } }]);
  });

  it("reads totals, last error and recent runs from the scheduler's stats and history", async () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      startedAt: 1000 - index,
      durationMs: 5,
      outcome: "success" as const,
    }));
    const read = createJobsReader({
      scheduler: async () => [
        {
          name: "cleanup",
          stats: { runs: 12, failures: 2, lastRunAt: 1000, lastDurationMs: 42, lastError: "boom" },
          history,
        },
        {
          name: "failing",
          history: [
            {
              startedAt: 7,
              durationMs: 1,
              outcome: "failed",
              error: "boom",
              stack: "secret",
            } as never,
          ],
        },
      ],
      queue: async () => null,
    });
    const [first, second] = (await read()).schedules;

    expect(first).toMatchObject({
      runs: 12,
      failures: 2,
      lastRunAt: 1000,
      lastDurationMs: 42,
      lastError: "boom",
    });
    expect(first?.recentRuns).toHaveLength(10);
    expect(second?.recentRuns).toEqual([
      { startedAt: 7, durationMs: 1, outcome: "failed", error: "boom" },
    ]);
  });

  it("keeps a queue whose driver cannot count, marked as such", async () => {
    const read = createJobsReader({
      queue: async () => [{ name: "mail", counts: {}, countsAvailable: false }],
    });

    expect((await read()).queues).toEqual([{ name: "mail", counts: {}, countsAvailable: false }]);
  });

  it("marks a failing part unavailable and never throws", async () => {
    const read = createJobsReader({
      scheduler: async () => {
        throw new Error("broken");
      },
      queue: async () => [{ name: "mail", counts: {} }],
    });
    const report = await read();

    expect(report.available).toEqual({ scheduler: false, queue: true });
    expect(report.schedules).toEqual([]);
  });

  it("scrubs the values out of job error messages, as it does for request errors", async () => {
    const message = 'Duplicate key "SKU-1001" for buyer@example.com in { sku: 1 }';
    const read = createJobsReader({
      scheduler: async () => [
        {
          name: "sync-products",
          stats: { runs: 1, failures: 1, lastRunAt: 1000, lastDurationMs: 3, lastError: message },
          history: [{ startedAt: 1000, durationMs: 3, outcome: "failed", error: message }],
        },
      ],
      queue: async () => null,
    });
    const [schedule] = (await read()).schedules;
    const shown = [schedule?.lastError, schedule?.recentRuns?.[0]?.error];

    for (const text of shown) {
      expect(text).toBe("Duplicate key ? for ? in {?}");
    }
  });

  describe("with the real queue package", () => {
    afterEach(async () => {
      await closeQueue({ timeout: 0 });
      resetQueueConfig();
    });

    it("reads the counts of the active driver", async () => {
      setQueueConfig({ driver: "memory" });

      const job = defineJob({
        name: "jobs-reader-sample",
        queue: "shop-orders",
        handle: async () => undefined,
      });

      await job.dispatch({ id: 1 });
      await job.dispatch({ id: 2 }, { delay: 60_000 });

      const report = await createJobsReader()();
      const queue = report.queues.find((item) => item.name === "shop-orders");

      expect(report.available.queue).toBe(true);
      expect(queue?.countsAvailable).toBeUndefined();
      expect(queue?.counts).toMatchObject({ waiting: 1, delayed: 1, active: 0, failed: 0 });
    });
  });

  it("reads the real packages without throwing", async () => {
    const report = await createJobsReader()();

    expect(report.available.queue).toBe(false);
    expect(Array.isArray(report.schedules)).toBe(true);
  });
});
