import { afterEach, describe, expect, it } from "vitest";
import { closeQueue, defineJob, setQueueConfig, startWorkers } from "../src";
import { sleep, testQueueConfig, waitFor } from "./test-redis";

describe("graceful shutdown", () => {
  afterEach(async () => {
    await closeQueue({ timeout: 1_000 });
  });

  it("waits for the active job to finish before closeQueue resolves", async () => {
    setQueueConfig(testQueueConfig());
    let started = false;
    let finished = false;

    const slow = defineJob({
      name: "spec.shutdown.slow",
      async handle() {
        started = true;
        await sleep(800);
        finished = true;
      },
    });

    await startWorkers();
    await slow.dispatch({});
    await waitFor(() => started);

    await closeQueue({ timeout: 10_000 });

    expect(finished).toBe(true);
  });

  it("stops waiting once the timeout elapses", async () => {
    setQueueConfig(testQueueConfig());
    let started = false;

    const stuck = defineJob({
      name: "spec.shutdown.stuck",
      async handle() {
        started = true;
        await sleep(5_000);
      },
    });

    await startWorkers();
    await stuck.dispatch({});
    await waitFor(() => started);

    const closingAt = Date.now();
    await closeQueue({ timeout: 300 });

    expect(Date.now() - closingAt).toBeLessThan(3_000);
  });

  it("does not pick up new jobs after shutdown", async () => {
    setQueueConfig(testQueueConfig());
    let calls = 0;

    const job = defineJob({
      name: "spec.shutdown.after",
      async handle() {
        calls++;
      },
    });

    await startWorkers();
    await closeQueue();

    // Dispatching still works (a producer-only process), but nothing consumes it.
    await job.dispatch({});
    await sleep(500);

    expect(calls).toBe(0);
  });
});
