import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeQueue,
  defineJob,
  loadBullBoard,
  queueDashboard,
  QueueDashboardDependencyError,
  setQueueConfig,
} from "../src";
import { testQueueConfig } from "./test-redis";

describe("queueDashboard", () => {
  afterEach(async () => {
    await closeQueue();
  });

  it("mounts bull-board on a Fastify server and lists the queue", async () => {
    setQueueConfig(testQueueConfig());
    const job = defineJob({
      name: "spec.dashboard",
      handle: () => {
        throw new Error("nope");
      },
    });
    await job.dispatch({});

    const server = Fastify();
    await queueDashboard(server, { basePath: "/admin/queues" });
    await server.ready();

    const page = await server.inject({ method: "GET", url: "/admin/queues" });
    expect(page.statusCode).toBe(200);

    const api = await server.inject({ method: "GET", url: "/admin/queues/api/queues" });
    expect(api.statusCode).toBe(200);
    expect(api.json().queues.map((queue: { name: string }) => queue.name)).toContain("default");

    await server.close();
  });

  it("throws a named error telling the user what to install when a peer is missing", async () => {
    const missing = Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" });

    await expect(loadBullBoard(() => Promise.reject(missing))).rejects.toThrow(
      QueueDashboardDependencyError,
    );
    await expect(loadBullBoard(() => Promise.reject(missing))).rejects.toThrow(
      "npm install @bull-board/api @bull-board/fastify",
    );
  });
});
