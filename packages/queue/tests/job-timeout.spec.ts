import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError, type Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  failedJobs,
  InvalidDurationError,
  InvalidJobDefinitionError,
  JobTimeoutError,
  resetQueueConfig,
  setQueueConfig,
  startWorkers,
  type QueueConfig,
} from "../src";
import { resolveJobOptions } from "../src/job-options";
import { createJobAbort } from "../src/job-timeout";
import { processJob } from "../src/process-job";

// These cases never instantiate BullMQ queues or connect to Redis.
vi.mock("bullmq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("bullmq")>()),
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
const eventually = (run: () => Promise<boolean> | boolean) =>
  vi.waitFor(async () => expect(await run()).toBe(true), { timeout: 5000, interval: 5 });

afterEach(() => {
  resetQueueConfig();
});

describe("timeout option resolution", () => {
  beforeEach(() => {
    setQueueConfig({ defaultJobOptions: { timeout: "1m", failOnTimeout: false } });
  });

  it("prefers dispatch options over the definition over queue.defaultJobOptions", () => {
    expect(resolveJobOptions({}, {})).toMatchObject({ timeout: 60_000, failOnTimeout: false });
    expect(resolveJobOptions({ timeout: "2m", failOnTimeout: true }, {})).toMatchObject({
      timeout: 120_000,
      failOnTimeout: true,
    });
    expect(
      resolveJobOptions(
        { timeout: "2m", failOnTimeout: true },
        { timeout: 500, failOnTimeout: false },
      ),
    ).toMatchObject({ timeout: 500, failOnTimeout: false });
  });

  it("leaves the timeout unset when nothing sets it", () => {
    setQueueConfig({});
    expect(resolveJobOptions({}, {}).timeout).toBeUndefined();
  });

  it("rejects non-positive, unparsable and non-boolean values loudly", () => {
    expect(() => resolveJobOptions({ timeout: 0 }, {})).toThrow(InvalidJobDefinitionError);
    expect(() => resolveJobOptions({}, { timeout: -5 })).toThrow(InvalidDurationError);
    expect(() => resolveJobOptions({ timeout: "soon" as never }, {})).toThrow(InvalidDurationError);
    expect(() => resolveJobOptions({ failOnTimeout: "yes" as never }, {})).toThrow(
      InvalidJobDefinitionError,
    );
    expect(() =>
      defineJob({ name: "timeout.invalid", timeout: 0, handle: () => undefined }),
    ).toThrow(/timeout/);
  });
});

describe("createJobAbort", () => {
  it("adds nothing without a timeout", async () => {
    const parent = new AbortController();
    const abort = createJobAbort("x", {}, parent.signal);
    expect(abort.signal).toBe(parent.signal);
    await expect(abort.guard(async () => 7)).resolves.toBe(7);
  });

  it("rejects with JobTimeoutError, aborts the signal and swallows the late rejection", async () => {
    const abort = createJobAbort("slow", { timeout: 20 });
    const failure = abort.guard(async () => {
      await sleep(60);
      throw new Error("late");
    });

    await expect(failure).rejects.toMatchObject({
      name: "JobTimeoutError",
      jobName: "slow",
      timeout: 20,
      failOnTimeout: false,
    });
    expect(abort.signal?.aborted).toBe(true);
    expect(abort.signal?.reason).toBeInstanceOf(JobTimeoutError);
    await sleep(80);
    abort.dispose();
  });

  it("returns the result and never aborts when the work finishes in time", async () => {
    const abort = createJobAbort("fast", { timeout: 500 });
    await expect(abort.guard(async () => "ok")).resolves.toBe("ok");
    abort.dispose();
    expect(abort.signal?.aborted).toBe(false);
  });

  it("forwards an abort from the parent signal", () => {
    const parent = new AbortController();
    const abort = createJobAbort("x", { timeout: 500 }, parent.signal);
    parent.abort(new Error("lease lost"));
    expect(abort.signal?.aborted).toBe(true);
    abort.dispose();
  });
});

describe("bullmq processor", () => {
  const fakeJob = (name: string, opts: Record<string, unknown>): Job =>
    ({
      id: "1",
      name,
      data: {},
      queueName: "default",
      attemptsMade: 0,
      opts,
      updateProgress: async () => {},
      log: async () => 0,
    }) as unknown as Job;

  it("fails a timed-out attempt with JobTimeoutError so BullMQ retries it", async () => {
    let signal: AbortSignal | undefined;
    defineJob({
      name: "bull.timeout",
      async handle(_: unknown, ctx) {
        signal = ctx.signal;
        await sleep(100);
      },
    });

    const error = await processJob(fakeJob("bull.timeout", { attempts: 3, timeout: 20 })).catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(JobTimeoutError);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('Job "bull.timeout" timed out after 20ms.');
    expect(signal?.aborted).toBe(true);
  });

  it("fails without retrying when failOnTimeout is set", async () => {
    defineJob({ name: "bull.nofail", handle: () => sleep(100) });

    const error = await processJob(
      fakeJob("bull.nofail", { attempts: 3, timeout: 20, failOnTimeout: true }),
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.message).toContain("timed out after 20ms");
  });

  it("applies no limit when the job has no timeout", async () => {
    defineJob({
      name: "bull.unlimited",
      async handle() {
        await sleep(30);
        return "done";
      },
    });

    await expect(processJob(fakeJob("bull.unlimited", {}))).resolves.toBe("done");
  });
});

for (const driver of ["memory", "local"] as const) {
  describe(`${driver} queue driver timeouts`, () => {
    let directory: string;
    let config: QueueConfig;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "warlock-queue-timeout-"));
      config = {
        driver,
        defaultQueue: "timeout-spec",
        local: { path: join(directory, "queue.sqlite"), pollInterval: 5, leaseDuration: 300 },
      };
      setQueueConfig(config);
    });
    afterEach(async () => {
      await closeQueue({ timeout: 0 });
      await rm(directory, { recursive: true, force: true });
    });

    it("fails the attempt, aborts the signal and retries with backoff", async () => {
      const signals: Array<AbortSignal | undefined> = [];
      const job = defineJob({
        name: `${driver}.timeout.retry`,
        attempts: 2,
        backoff: 5,
        timeout: 30,
        async handle(_: unknown, ctx) {
          signals.push(ctx.signal);
          if (ctx.attempt === 1) await sleep(200);
          return `attempt ${ctx.attempt}`;
        },
      });

      await startWorkers();
      const { id } = await job.dispatch({});
      await eventually(async () => (await job.find(id))?.state === "completed");

      expect(await job.find(id)).toMatchObject({ result: "attempt 2", attemptsMade: 2 });
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[0]?.reason).toBeInstanceOf(JobTimeoutError);
    });

    it("records the timeout as the failed reason once attempts run out", async () => {
      const job = defineJob({
        name: `${driver}.timeout.exhaust`,
        attempts: 2,
        timeout: "20ms",
        handle: () => sleep(200),
      });

      await startWorkers();
      const { id } = await job.dispatch({});
      await eventually(async () => (await job.find(id))?.state === "failed");

      const [failure] = await failedJobs();
      expect(failure).toMatchObject({ attemptsMade: 2 });
      expect(failure!.failedReason).toBe(`Job "${driver}.timeout.exhaust" timed out after 20ms.`);
    });

    it("skips the remaining attempts with failOnTimeout", async () => {
      let calls = 0;
      const job = defineJob({
        name: `${driver}.timeout.fail`,
        attempts: 5,
        timeout: 20,
        failOnTimeout: true,
        async handle() {
          calls++;
          await sleep(200);
        },
      });

      await startWorkers();
      const { id } = await job.dispatch({});
      await eventually(async () => (await job.find(id))?.state === "failed");
      await sleep(50);

      expect(calls).toBe(1);
      expect(await job.find(id)).toMatchObject({ attemptsMade: 1 });
    });

    it("lets a dispatch override the definition", async () => {
      let calls = 0;
      const job = defineJob({
        name: `${driver}.timeout.override`,
        timeout: 20,
        async handle() {
          calls++;
          await sleep(80);
          return "finished";
        },
      });

      await startWorkers();
      const { id } = await job.dispatch({}, { timeout: "2s" });
      await eventually(async () => (await job.find(id))?.state === "completed");

      expect(calls).toBe(1);
    });

    it("runs without a limit when no timeout is set", async () => {
      const job = defineJob({
        name: `${driver}.timeout.none`,
        async handle(_: unknown, ctx) {
          await sleep(60);
          return ctx.signal?.aborted ?? false;
        },
      });

      await startWorkers();
      const { id } = await job.dispatch({});
      await eventually(async () => (await job.find(id))?.state === "completed");

      expect(await job.find(id)).toMatchObject({ result: false });
    });
  });
}
