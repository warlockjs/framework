import { log } from "@warlock.js/logger";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeQueue,
  defineJob,
  mountQueueDashboard,
  QueueDashboardUnguardedError,
  setQueueConfig,
} from "../src";
import { testQueueConfig } from "./test-redis";

describe("mountQueueDashboard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    defineJob({ name: "spec.dashboard-config", handle: () => undefined });
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await closeQueue();
  });

  it("throws QueueDashboardUnguardedError in production with no middleware", async () => {
    process.env.NODE_ENV = "production";
    setQueueConfig(testQueueConfig());
    const server = Fastify();

    await expect(
      mountQueueDashboard(server, {
        ...testQueueConfig(),
        dashboard: { enabled: true },
      }),
    ).rejects.toThrow(QueueDashboardUnguardedError);

    await server.close();
  });

  it("mounts and rejects a request that does not pass the guard middleware", async () => {
    process.env.NODE_ENV = "production";
    setQueueConfig(testQueueConfig());
    const server = Fastify();

    await mountQueueDashboard(server, {
      ...testQueueConfig(),
      dashboard: {
        enabled: true,
        path: "/admin/queues",
        middleware: [
          ({ response }) => {
            return response.forbidden({ error: "nope" });
          },
        ],
      },
    });
    await server.ready();

    const page = await server.inject({ method: "GET", url: "/admin/queues" });
    expect(page.statusCode).toBe(403);

    await server.close();
  });

  it("does not mount when dashboard.enabled is false", async () => {
    setQueueConfig(testQueueConfig());
    const server = Fastify();
    const registerSpy = vi.spyOn(server, "register");

    await mountQueueDashboard(server, {
      ...testQueueConfig(),
      dashboard: { enabled: false },
    });

    expect(registerSpy).not.toHaveBeenCalled();

    await server.close();
  });

  it("mounts and logs one warning outside production with no middleware", async () => {
    process.env.NODE_ENV = "development";
    setQueueConfig(testQueueConfig());
    const server = Fastify();
    const warnSpy = vi.spyOn(log, "warn");

    await mountQueueDashboard(server, {
      ...testQueueConfig(),
      dashboard: { enabled: true, path: "/admin/queues" },
    });
    await server.ready();

    const page = await server.inject({ method: "GET", url: "/admin/queues" });
    expect(page.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    await server.close();
  });
});
