import { setConfig } from "@warlock.js/core";
import { afterEach, describe, expect, it } from "vitest";
import { closeQueue, defineJob, queueConnector, runningWorkers } from "../src";
import { testQueueConfig, waitFor } from "./test-redis";

describe("queueConnector", () => {
  afterEach(async () => {
    await closeQueue();
  });

  it("is a late-phase connector named queue", () => {
    const connector = queueConnector();

    expect(connector).toMatchObject({ name: "queue", lifecyclePhase: "late" });
    expect(connector.shouldRestart(["src/config/queue.ts"])).toBe(true);
    expect(connector.shouldRestart(["src/config/app.ts"])).toBe(false);
  });

  it("reads the `queue` config key, starts workers, and closes them on shutdown", async () => {
    let processed = 0;
    const job = defineJob({
      name: "spec.connector",
      async handle() {
        processed++;
      },
    });

    setConfig("queue", testQueueConfig());
    const connector = queueConnector();

    await connector.boot();
    await connector.start();

    expect(connector.isActive()).toBe(true);
    expect(runningWorkers()).toEqual(["default"]);

    await job.dispatch({});
    await waitFor(() => processed === 1);

    await connector.shutdown();

    expect(connector.isActive()).toBe(false);
    expect(runningWorkers()).toEqual([]);
  });

  it("does not start workers when workers.enabled is false", async () => {
    defineJob({ name: "spec.connector.disabled", handle: () => undefined });
    const connector = queueConnector({ config: testQueueConfig({ workers: { enabled: false } }) });

    await connector.start();

    expect(connector.isActive()).toBe(true);
    expect(runningWorkers()).toEqual([]);

    await connector.shutdown();
  });
});
