import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Job, job } from "./job";
import { Scheduler } from "./scheduler";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-11T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Job run history", () => {
  it("starts empty", () => {
    const j = new Job("sample", async () => {});
    expect(j.history).toEqual([]);
    expect(j.stats).toMatchObject({
      runs: 0,
      failures: 0,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
    });
  });

  it("records a successful run with its start and duration", async () => {
    const j = job("sample", async () => {
      await vi.advanceTimersByTimeAsync(250);
    }).everyMinute();
    await j.run();

    expect(j.history).toHaveLength(1);
    expect(j.history[0]).toMatchObject({ outcome: "success", durationMs: 250 });
    expect(j.history[0]?.startedAt).toBe(new Date("2026-05-11T10:00:00Z").getTime());
    expect(j.stats).toMatchObject({
      runs: 1,
      failures: 0,
      lastDurationMs: 250,
      lastError: null,
      lastOutcome: "success",
    });
  });

  it("records a failure with the message only, then clears lastError on success", async () => {
    let fail = true;
    const j = job("sample", async () => {
      if (fail) throw new Error("boom");
    }).everyMinute();

    await j.run();
    expect(j.history[0]).toMatchObject({ outcome: "failed", error: "boom" });
    expect(JSON.stringify(j.history)).not.toContain("at ");
    expect(j.stats).toMatchObject({ runs: 1, failures: 1, lastError: "boom" });

    fail = false;
    await j.run();
    expect(j.stats).toMatchObject({ runs: 2, failures: 1, lastError: null });
    expect(j.history.map((entry) => entry.outcome)).toEqual(["success", "failed"]);
  });

  it("cuts a long error message", async () => {
    const j = job("sample", async () => {
      throw new Error("x".repeat(900));
    }).everyMinute();
    await j.run();
    expect(j.history[0]?.error?.length).toBeLessThanOrEqual(503);
  });

  it("keeps at most the configured number of runs, newest first, totals keep counting", async () => {
    const j = job("sample", async () => {})
      .everyMinute()
      .keepHistory(3);
    for (let index = 0; index < 5; index++) await j.run();
    expect(j.history).toHaveLength(3);
    expect(j.stats.runs).toBe(5);
  });

  it("defaults to 20 runs and keeps nothing at 0", async () => {
    const j = job("sample", async () => {}).everyMinute();
    for (let index = 0; index < 25; index++) await j.run();
    expect(j.history).toHaveLength(20);

    const none = job("none", async () => {})
      .everyMinute()
      .keepHistory(0);
    await none.run();
    expect(none.history).toEqual([]);
    expect(none.stats.runs).toBe(1);
  });

  it("records one skipped entry per busy tick, not counted as a run", async () => {
    const j = job("sample", async () => {})
      .everyMinute()
      .preventOverlap();
    j.prepare();
    j.recordOverlapSkip();
    j.recordOverlapSkip();
    expect(j.history).toHaveLength(1);
    expect(j.history[0]).toMatchObject({
      outcome: "skipped",
      skipReason: "Job is already running",
    });
    expect(j.stats).toMatchObject({ runs: 0, skips: 1 });
  });

  it("the scheduler records an overlap skip while a run is still going", async () => {
    const scheduler = new Scheduler();
    let release = () => {};
    const slow = job(
      "slow",
      () => new Promise<void>((resolve) => (release = resolve)),
    ).everySecond();
    scheduler.addJob(slow);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3500);
    expect(slow.isRunning).toBe(true);
    expect(slow.history.some((entry) => entry.outcome === "skipped")).toBe(true);

    release();
    await scheduler.shutdown();
  });
});
