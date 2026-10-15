import { resetRolesCacheForTests } from "@warlock.js/core";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  queueConnector,
  runningWorkers,
  setQueueConfig,
  startWorkers,
} from "../src";
import { testQueueConfig } from "./test-redis";

/**
 * `startWorkers` (and the connector's `start()`, which calls it) must not
 * touch Redis at all when the process lacks the `worker` role — so BullMQ is
 * mocked here rather than pointed at a real server.
 */
vi.mock("bullmq", () => {
  class FakeWorker {
    public name: string;
    constructor(name: string) {
      this.name = name;
    }
    on(): void {}
    async waitUntilReady(): Promise<void> {}
    async close(): Promise<void> {}
    async disconnect(): Promise<void> {}
  }

  class FakeQueue {
    on(): void {}
    async close(): Promise<void> {}
  }

  return { Worker: FakeWorker, Queue: FakeQueue };
});

vi.mock("@warlock.js/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warlock.js/logger")>();

  return { ...actual, log: { ...actual.log, info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

describe("queue role gating", () => {
  afterEach(async () => {
    delete process.env.WARLOCK_ROLES;
    resetRolesCacheForTests();
    vi.clearAllMocks();
    await closeQueue();
  });

  it("startWorkers starts nothing and logs when the process lacks the worker role", async () => {
    process.env.WARLOCK_ROLES = "web";
    resetRolesCacheForTests();
    setQueueConfig(testQueueConfig());
    defineJob({ name: "spec.role-gating.web", handle: () => undefined });

    const started = await startWorkers();

    expect(started).toEqual([]);
    expect(runningWorkers()).toEqual([]);
    expect(log.info).toHaveBeenCalledWith(
      "queue",
      "workers",
      "queue: workers not started (role: web)",
    );
  });

  it("startWorkers is unchanged when no role restriction is set", async () => {
    resetRolesCacheForTests();
    setQueueConfig(testQueueConfig());
    defineJob({ name: "spec.role-gating.unset", handle: () => undefined });

    const started = await startWorkers();

    expect(started).toContain("default");
    expect(runningWorkers()).toContain("default");
  });

  it("the connector starts no workers on a web-only process", async () => {
    process.env.WARLOCK_ROLES = "web";
    resetRolesCacheForTests();
    defineJob({ name: "spec.role-gating.connector", handle: () => undefined });

    const connector = queueConnector({ config: testQueueConfig() });
    await connector.start();

    expect(connector.isActive()).toBe(true);
    expect(runningWorkers()).toEqual([]);

    await connector.shutdown();
  });
});
