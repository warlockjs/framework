import http from "node:http";
import {
  createCollector as createPanopticCollector,
  createInMemoryTraceStore,
  totalCostUsd,
} from "@warlock.js/ai-panoptic";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { mountDevtoolsRoutes } from "../src/server";
import type { DevtoolsAiEvent } from "../src/sources/ai-source";
import { summarizeAiTrace } from "../src/sources/ai-source";

vi.mock("../src/current-request-id", () => ({ currentRequestId: () => undefined }));
const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function fixture(development = true, path = "/__warlock") {
  const store = createInMemoryTraceStore();
  const options = resolveDevtoolsOptions({ path });
  const collector = createCollector(options);
  const trace = createPanopticCollector().toTrace({
    runId: "run",
    rootRunId: "run",
    name: "assistant",
    type: "agent",
    status: "incomplete",
    startedAt: "2026-10-19T10:00:00.000Z",
    endedAt: "2026-10-19T10:00:00.100Z",
    duration: 100,
    usage: { input: 10, output: 5, total: 15 },
    children: [],
  });
  store.add({ ...trace, requestId: "http-a" });
  store.add({ ...trace, traceId: "background" });
  const listeners = new Set<(event: DevtoolsAiEvent) => void>();
  const server = Fastify();
  servers.push(server);
  mountDevtoolsRoutes(server, {
    collector,
    options,
    isDevelopment: () => development,
    ai: {
      available: true,
      store,
      summarize: (item) => summarizeAiTrace(item, totalCostUsd(item.usage)),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      dispose() {},
    },
  });
  return { server, store, listeners };
}

describe("AI metadata API", () => {
  it("returns per-request runs and root usage aggregates, plus complete span trees by run", async () => {
    const { server } = fixture(true, "/dev");
    const list = await server.inject({
      url: "/dev/api/ai?requestId=http-a",
      remoteAddress: "127.0.0.1",
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json()).toMatchObject({
      available: true,
      runs: [{ traceId: "run", requestId: "http-a", incomplete: true }],
      aggregate: { traces: 1, usage: { total: 15 } },
    });
    const detail = await server.inject({ url: "/dev/api/ai/runs/run", remoteAddress: "::1" });
    expect(detail.json()).toMatchObject({
      requestId: "http-a",
      root: { spanId: "run", status: "incomplete" },
    });
    const all = await server.inject({ url: "/dev/api/ai", remoteAddress: "127.0.0.1" });
    expect(all.json().runs).toHaveLength(2);
    const missing = await server.inject({
      url: "/dev/api/ai/runs/missing",
      remoteAddress: "127.0.0.1",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("provides install guidance without Panoptic", async () => {
    const server = Fastify();
    servers.push(server);
    const options = resolveDevtoolsOptions();
    mountDevtoolsRoutes(server, {
      collector: createCollector(options),
      options,
      isDevelopment: () => true,
    });
    const response = await server.inject({ url: "/__warlock/api/ai", remoteAddress: "127.0.0.1" });
    expect(response.json()).toEqual({
      available: false,
      message: expect.stringContaining("Install"),
      runs: [],
    });
  });

  it.each(["/api/ai", "/api/ai/runs/run"])(
    "guards %s from production and remote clients",
    async (path) => {
      const remote = fixture();
      const production = fixture(false);
      for (const [server, remoteAddress] of [
        [remote.server, "10.0.0.5"],
        [production.server, "127.0.0.1"],
      ] as const) {
        const response = await server.inject({
          url: `/__warlock${path}`,
          remoteAddress,
          headers: { "x-forwarded-for": "127.0.0.1" },
        });
        expect(response.statusCode).toBe(404);
        expect(response.body).toBe("");
      }
    },
  );

  it("streams AI updates and detaches the AI listener on disconnect", async () => {
    const { server, listeners } = fixture();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address();
    if (!address || typeof address === "string") throw new Error("Expected ephemeral port");
    const request = http.get({
      host: "127.0.0.1",
      port: address.port,
      path: "/__warlock/api/stream",
    });
    try {
      const frame = new Promise<string>((resolve, reject) => {
        request.on("error", reject);
        request.on("response", (response) => {
          let received = "";
          response.on("error", reject);
          response.on("data", (chunk) => {
            received += chunk.toString();
            if (received.includes("\n\n")) resolve(received);
          });
        });
      });
      const waitFor = async (condition: () => boolean) => {
        const deadline = Date.now() + 2000;
        while (!condition()) {
          if (Date.now() > deadline) throw new Error("Timed out waiting for stream listener");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      };
      await waitFor(() => listeners.size === 1);
      for (const listener of listeners) listener({ traceId: "run", requestId: "http-a" });
      expect(await frame).toBe('event: ai\ndata: {"traceId":"run","requestId":"http-a"}\n\n');
      request.destroy();
      await waitFor(() => listeners.size === 0);
    } finally {
      request.destroy();
    }
  });

  it("clears only the devtools trace store through the guarded Clear endpoint", async () => {
    const { server, store } = fixture();
    const refused = await server.inject({
      method: "DELETE",
      url: "/__warlock/api/requests",
      remoteAddress: "10.0.0.5",
    });
    expect(refused.statusCode).toBe(404);
    expect(store.size).toBe(2);
    const response = await server.inject({
      method: "DELETE",
      url: "/__warlock/api/requests",
      remoteAddress: "127.0.0.1",
    });
    expect(response.statusCode).toBe(204);
    expect(store.size).toBe(0);
  });
});
