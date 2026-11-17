import { describe, expect, it } from "vitest";
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
    expect(report.schedules[1]).toMatchObject({ name: "poll", cron: null, interval: "every 5 minutes", lastRunAt: null });
    expect(report.queues).toEqual([{ name: "mail", counts: { waiting: 3, failed: 1 } }]);
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

  it("reads the real packages without throwing", async () => {
    const report = await createJobsReader()();

    expect(report.available.queue).toBe(false);
    expect(Array.isArray(report.schedules)).toBe(true);
  });
});
