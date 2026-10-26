import { afterEach, describe, expect, it, vi } from "vitest";
import { RUNNING_SCHEDULERS_KEY } from "./running-schedulers";
import { Scheduler } from "./scheduler";

type Registry = { [RUNNING_SCHEDULERS_KEY]?: Set<unknown> };

const tracked = () => (globalThis as Registry)[RUNNING_SCHEDULERS_KEY];

describe("running scheduler registry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists a scheduler from start() until it stops", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler();

    scheduler.newJob("tracked", async () => undefined).everyHour();
    scheduler.start();

    expect(tracked()?.has(scheduler)).toBe(true);

    scheduler.stop();

    expect(tracked()?.has(scheduler)).toBe(false);
  });

  it("drops a scheduler once shutdown() resolves", async () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler();

    scheduler.newJob("tracked", async () => undefined).everyHour();
    scheduler.start();

    await scheduler.shutdown();

    expect(scheduler.isRunning).toBe(false);
    expect(tracked()?.has(scheduler)).toBe(false);
  });

  it("leaves no timer armed when shutdown() waits for a job that finishes first", async () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler();
    let finish!: () => void;

    scheduler
      .newJob(
        "slow",
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .everyMinute();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);

    const stopping = scheduler.shutdown(30_000);

    finish();
    await stopping;

    expect(vi.getTimerCount()).toBe(0);
  });
});
