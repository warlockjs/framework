import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeQueue, defineJob, queueConnector, resetQueueConfig } from "../src";
import { testQueueConfig } from "./test-redis";

/**
 * The connector mounts the dashboard in `boot()`, which runs before any late
 * connector's `start()` — so `boot()` is on its own for registering the
 * config the dashboard resolves queues through. Booting with the config unset
 * is what a real app does, and what the mountQueueDashboard specs (which set
 * it by hand) cannot see.
 */
describe("queueConnector().boot() with the dashboard enabled", () => {
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify();
    defineJob({ name: "spec.connector-dashboard-boot", handle: () => undefined });
    resetQueueConfig();

    vi.doMock("@warlock.js/core", () => ({
      config: { get: () => ({ ...testQueueConfig(), dashboard: { enabled: true, middleware: [() => undefined] } }) },
      getHttpServer: () => server,
    }));
  });

  afterEach(async () => {
    vi.doUnmock("@warlock.js/core");
    vi.resetModules();
    resetQueueConfig();
    await server.close();
    await closeQueue();
  });

  it("registers the config itself, so the dashboard resolves its queues", async () => {
    await expect(queueConnector().boot?.()).resolves.not.toThrow();

    const response = await server.inject({ method: "GET", url: "/admin/queues" });

    expect(response.statusCode).not.toBe(404);
  });
});
