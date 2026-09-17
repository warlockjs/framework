import { Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  failedJobs,
  retryFailedJob,
  setQueueConfig,
  startWorkers,
  type JobContext,
} from "../src";
import { sleep, testQueueConfig, waitFor } from "./test-redis";

describe("@warlock.js/queue against a real Redis", () => {
  beforeEach(() => {
    setQueueConfig(testQueueConfig({ workers: { concurrency: 1 } }));
  });

  afterEach(async () => {
    await closeQueue({ timeout: 5_000 });
  });

  it("dispatches a job and processes it with its typed payload", async () => {
    const received: Array<{ payload: { invoiceId: string }; context: JobContext }> = [];

    const sendInvoice = defineJob({
      name: "spec.dispatch",
      async handle(payload: { invoiceId: string }, context) {
        received.push({ payload, context });
        return "sent";
      },
    });

    await startWorkers();
    const dispatched = await sendInvoice.dispatch({ invoiceId: "inv-1" }, { jobId: "custom-1" });

    expect(dispatched).toMatchObject({ id: "custom-1", name: "spec.dispatch", queue: "default" });

    await waitFor(() => received.length === 1);
    expect(received[0]!.payload).toEqual({ invoiceId: "inv-1" });
    expect(received[0]!.context).toMatchObject({ id: "custom-1", attempt: 1, queue: "default" });
  });

  it("retries a failing job up to `attempts` then lists it as failed", async () => {
    let calls = 0;

    const flaky = defineJob({
      name: "spec.retry",
      attempts: 3,
      backoff: { type: "fixed", delay: 10 },
      async handle(_payload: { n: number }, context) {
        calls++;
        throw new Error(`boom on attempt ${context.attempt}`);
      },
    });

    await startWorkers();
    const { id } = await flaky.dispatch({ n: 1 });

    await waitFor(() => calls === 3);
    await sleep(200);
    expect(calls).toBe(3);

    const failed = await failedJobs();
    const job = failed.find((entry) => entry.id === id);

    expect(job).toMatchObject({
      name: "spec.retry",
      payload: { n: 1 },
      attemptsMade: 3,
      failedReason: "boom on attempt 3",
    });
  });

  it("succeeds on a later attempt without being listed as failed", async () => {
    let calls = 0;

    const eventually = defineJob({
      name: "spec.retry-success",
      attempts: 3,
      backoff: 10,
      async handle() {
        calls++;
        if (calls < 2) throw new Error("first attempt fails");
      },
    });

    await startWorkers();
    const { id } = await eventually.dispatch({});

    await waitFor(() => calls === 2);
    await sleep(200);
    expect((await failedJobs()).some((entry) => entry.id === id)).toBe(false);
  });

  it("retries a failed job on demand", async () => {
    let shouldFail = true;
    let succeeded = 0;

    const recoverable = defineJob({
      name: "spec.manual-retry",
      async handle() {
        if (shouldFail) throw new Error("down");
        succeeded++;
      },
    });

    await startWorkers();
    const { id } = await recoverable.dispatch({});

    let failed = await failedJobs();
    const deadline = Date.now() + 10_000;
    while (!failed.some((entry) => entry.id === id) && Date.now() < deadline) {
      await sleep(50);
      failed = await failedJobs();
    }
    expect(failed.some((entry) => entry.id === id)).toBe(true);

    shouldFail = false;
    await retryFailedJob(id);

    await waitFor(() => succeeded === 1);
    expect((await failedJobs()).some((entry) => entry.id === id)).toBe(false);
  });

  it("delays a job by the given duration", async () => {
    let processedAt = 0;

    const delayed = defineJob({
      name: "spec.delay",
      async handle() {
        processedAt = Date.now();
      },
    });

    await startWorkers();
    const dispatchedAt = Date.now();
    await delayed.dispatch({}, { delay: "1s" });

    await sleep(500);
    expect(processedAt).toBe(0);

    await waitFor(() => processedAt > 0);
    expect(processedAt - dispatchedAt).toBeGreaterThanOrEqual(950);
  });

  it("processes higher-priority (lower number) jobs first", async () => {
    const order: string[] = [];

    const prioritized = defineJob({
      name: "spec.priority",
      async handle(payload: { label: string }) {
        order.push(payload.label);
      },
    });

    // Enqueue BEFORE the worker starts so all three wait together.
    await prioritized.dispatch({ label: "low" }, { priority: 10 });
    await prioritized.dispatch({ label: "high" }, { priority: 1 });
    await prioritized.dispatch({ label: "medium" }, { priority: 5 });

    await startWorkers();
    await waitFor(() => order.length === 3);

    expect(order).toEqual(["high", "medium", "low"]);
  });

  it("reports progress through ctx.progress and exposes it on find()", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reachedHalf = false;

    const tracked = defineJob({
      name: "spec.progress",
      async handle(_payload: Record<string, never>, context) {
        await context.progress(50);
        reachedHalf = true;
        await gate;
        await context.progress(100);
        return { done: true };
      },
    });

    await startWorkers();
    const { id } = await tracked.dispatch({});

    await waitFor(() => reachedHalf);
    expect(await tracked.find(id)).toMatchObject({ id, state: "active", progress: 50 });

    release();
    let snapshot = await tracked.find(id);
    const deadline = Date.now() + 10_000;
    while (snapshot?.state !== "completed" && Date.now() < deadline) {
      await sleep(50);
      snapshot = await tracked.find(id);
    }

    expect(snapshot).toMatchObject({ state: "completed", progress: 100, result: { done: true } });
  });

  it("returns a consistent snapshot even when the job finishes mid-find()", async () => {
    let releaseHandler: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (releaseHandler = resolve));
    let handlerFinished = false;

    const racy = defineJob({
      name: "spec.find-race",
      async handle(_payload: Record<string, never>) {
        await gate;
        return { done: true };
      },
    });

    await startWorkers();
    const { id } = await racy.dispatch({});

    // Wait until the job is actually running (recorded as "active" in Redis).
    let started = false;
    const startDeadline = Date.now() + 10_000;
    while (!started && Date.now() < startDeadline) {
      started = (await racy.find(id))?.state === "active";
      if (!started) {
        await sleep(20);
      }
    }
    expect(started).toBe(true);

    // Simulate find() racing a job that finishes between the moment its
    // state is read and the moment its data is read: on the *first*
    // getState() call made anywhere in this test (the one `find()` issues),
    // let the job's handler complete, wait for BullMQ to persist that as
    // "completed" in Redis, and only then let the original getState() run.
    const originalGetState = Job.prototype.getState;
    let getStateCalls = 0;

    vi.spyOn(Job.prototype, "getState").mockImplementation(async function (
      this: Job,
    ) {
      getStateCalls++;

      if (getStateCalls === 1) {
        releaseHandler();
        handlerFinished = true;

        let completed = false;
        const completeDeadline = Date.now() + 10_000;
        while (!completed && Date.now() < completeDeadline) {
          completed = (await originalGetState.call(this)) === "completed";
          if (!completed) {
            await sleep(20);
          }
        }
      }

      return originalGetState.call(this);
    });

    let snapshot: Awaited<ReturnType<typeof racy.find>>;

    try {
      snapshot = await racy.find(id);
    } finally {
      vi.restoreAllMocks();
    }

    expect(handlerFinished).toBe(true);
    expect(snapshot).toMatchObject({
      id,
      state: "completed",
      attemptsMade: 1,
      result: { done: true },
    });
    expect(snapshot?.finishedAt).toBeInstanceOf(Date);
  });
});
