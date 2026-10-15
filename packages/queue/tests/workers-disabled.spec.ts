import { afterEach, describe, expect, it } from "vitest";
import { closeQueue, defineJob, setQueueConfig, startWorkers } from "../src";
import { sleep, testQueueConfig } from "./test-redis";

describe("workers.enabled = false", () => {
  afterEach(async () => {
    await closeQueue();
  });

  it("startWorkers is a no-op so the process only produces jobs", async () => {
    setQueueConfig(testQueueConfig({ workers: { enabled: false } }));
    let calls = 0;

    const job = defineJob({
      name: "spec.disabled",
      async handle() {
        calls++;
      },
    });

    expect(await startWorkers()).toEqual([]);
    await job.dispatch({});
    await sleep(500);

    expect(calls).toBe(0);
  });
});
