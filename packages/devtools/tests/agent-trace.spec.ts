import http from "node:http";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { mountDevtoolsRoutes } from "../src/server";
import {
  AGENT_TRACES_KEY,
  attachAgentTraceSource,
  summarizeAgentTrace,
  type DevtoolsAgentTrace,
  type DevtoolsAgentTraceStore,
} from "../src/sources/agent-trace-source";

const request = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock("../src/current-request-id", () => ({ currentRequestId: () => request.current }));

const servers: ReturnType<typeof Fastify>[] = [];
const registry = globalThis as { [AGENT_TRACES_KEY]?: DevtoolsAgentTraceStore };

afterEach(async () => {
  request.current = undefined;
  delete registry[AGENT_TRACES_KEY];
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function trace(runId: string, overrides: Partial<DevtoolsAgentTrace> = {}): DevtoolsAgentTrace {
  return {
    runId,
    agent: "coach",
    status: "completed",
    startedAt: "2026-10-25T10:00:00.000Z",
    durationMs: 40,
    model: { name: "fake", provider: "mock" },
    usage: { input: 10, output: 5, total: 15 },
    cost: 0.001,
    turns: [{ toolCalls: [{}, { refusal: "Exercise not in library" }] }, { toolCalls: [] }],
    ...overrides,
  };
}

/** A hand-rolled store with the surface `@warlock.js/ai` publishes. */
function fakeStore(initial: DevtoolsAgentTrace[] = []) {
  const traces = new Map(initial.map((item) => [item.runId, item]));
  const listeners = new Set<(event: { runId: string; status: string }) => void>();
  const store: DevtoolsAgentTraceStore = {
    get: (runId) => traces.get(runId),
    list: () => [...traces.values()].reverse(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    store,
    listeners,
    publish(item: DevtoolsAgentTrace) {
      traces.set(item.runId, item);
      for (const listener of listeners) listener({ runId: item.runId, status: item.status });
    },
  };
}

describe("summarizeAgentTrace()", () => {
  it("counts tool calls and refusals across turns", () => {
    expect(summarizeAgentTrace(trace("run_1"), "req-1")).toEqual({
      runId: "run_1",
      agent: "coach",
      status: "completed",
      startedAt: "2026-10-25T10:00:00.000Z",
      durationMs: 40,
      model: "mock/fake",
      turns: 2,
      toolCalls: 2,
      refusals: 1,
      usage: { input: 10, output: 5 },
      cost: 0.001,
      requestId: "req-1",
    });
  });
});

describe("attachAgentTraceSource()", () => {
  it("is unavailable until the AI package has created its store, then picks it up", async () => {
    const source = await attachAgentTraceSource();

    expect(source.available()).toBe(false);
    expect(source.list()).toEqual([]);
    expect(source.get("run_1")).toBeUndefined();

    registry[AGENT_TRACES_KEY] = fakeStore([trace("run_1")]).store;

    expect(source.available()).toBe(true);
    expect(source.list().map((run) => run.runId)).toEqual(["run_1"]);
    expect(source.get("run_1")?.runId).toBe("run_1");
    source.dispose();
  });

  it("links a run to the request that was active when it was first reported", async () => {
    const fake = fakeStore();
    registry[AGENT_TRACES_KEY] = fake.store;
    const source = await attachAgentTraceSource();
    const events: unknown[] = [];

    source.subscribe((event) => events.push(event));
    request.current = "req-7";
    fake.publish(trace("run_1", { status: "running" }));
    request.current = undefined;
    fake.publish(trace("run_1"));
    fake.publish(trace("run_2"));

    expect(events).toEqual([
      { runId: "run_1", status: "running", requestId: "req-7" },
      { runId: "run_1", status: "completed", requestId: "req-7" },
      { runId: "run_2", status: "completed" },
    ]);
    expect(source.list({ requestId: "req-7" }).map((run) => run.runId)).toEqual(["run_1"]);
    expect(source.list().map((run) => run.runId)).toEqual(["run_2", "run_1"]);
    source.dispose();
  });

  it("isolates a broken listener and stops delivering after unsubscribe and dispose", async () => {
    const fake = fakeStore();
    registry[AGENT_TRACES_KEY] = fake.store;
    const source = await attachAgentTraceSource();
    const seen: string[] = [];

    source.subscribe(() => {
      throw new Error("broken client");
    });
    const off = source.subscribe((event) => seen.push(event.runId));

    fake.publish(trace("run_1"));
    off();
    fake.publish(trace("run_2"));
    expect(seen).toEqual(["run_1"]);

    source.dispose();
    expect(fake.listeners.size).toBe(0);
  });

  it("re-attaches when a new store replaces the old one", async () => {
    const first = fakeStore();
    const second = fakeStore();
    registry[AGENT_TRACES_KEY] = first.store;
    const source = await attachAgentTraceSource();
    const seen: string[] = [];

    source.subscribe((event) => seen.push(event.runId));
    registry[AGENT_TRACES_KEY] = second.store;
    source.available();
    first.publish(trace("old"));
    second.publish(trace("new"));

    expect(seen).toEqual(["new"]);
    expect(first.listeners.size).toBe(0);
    source.dispose();
  });
});

describe("agent trace routes", () => {
  async function fixture(development = true, path = "/__warlock") {
    const fake = fakeStore([trace("run_1", { status: "failed" }), trace("run_2")]);
    registry[AGENT_TRACES_KEY] = fake.store;
    const agentTraces = await attachAgentTraceSource();
    const options = resolveDevtoolsOptions({ path });
    const server = Fastify();
    servers.push(server);
    mountDevtoolsRoutes(server, {
      collector: createCollector(options),
      options,
      isDevelopment: () => development,
      agentTraces,
    });

    return { server, fake, agentTraces };
  }

  it("lists runs newest first and serves one trace in full", async () => {
    const { server } = await fixture(true, "/dev");

    const list = await server.inject({ url: "/dev/api/ai/agent-runs", remoteAddress: "127.0.0.1" });

    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json()).toMatchObject({
      available: true,
      runs: [
        { runId: "run_2", refusals: 1, toolCalls: 2 },
        { runId: "run_1", status: "failed" },
      ],
    });

    const detail = await server.inject({
      url: "/dev/api/ai/agent-runs/run_1",
      remoteAddress: "::1",
    });

    expect(detail.json()).toMatchObject({ runId: "run_1", turns: [{}, {}] });

    const missing = await server.inject({
      url: "/dev/api/ai/agent-runs/nope",
      remoteAddress: "127.0.0.1",
    });

    expect(missing.statusCode).toBe(404);
  });

  it("filters by request id", async () => {
    const { server, fake } = await fixture();

    request.current = "req-9";
    fake.publish(trace("run_3"));
    request.current = undefined;

    const response = await server.inject({
      url: "/__warlock/api/ai/agent-runs?requestId=req-9",
      remoteAddress: "127.0.0.1",
    });

    expect(response.json().runs.map((run: { runId: string }) => run.runId)).toEqual(["run_3"]);
  });

  it("explains how to enable traces when none are available", async () => {
    const options = resolveDevtoolsOptions();
    const server = Fastify();
    servers.push(server);
    mountDevtoolsRoutes(server, {
      collector: createCollector(options),
      options,
      isDevelopment: () => true,
      agentTraces: await attachAgentTraceSource(),
    });

    const response = await server.inject({
      url: "/__warlock/api/ai/agent-runs",
      remoteAddress: "127.0.0.1",
    });

    expect(response.json()).toEqual({
      available: false,
      message: expect.stringContaining("@warlock.js/ai"),
      runs: [],
    });
  });

  it("answers 404 for the detail route when no source is wired", async () => {
    const options = resolveDevtoolsOptions();
    const server = Fastify();
    servers.push(server);
    mountDevtoolsRoutes(server, {
      collector: createCollector(options),
      options,
      isDevelopment: () => true,
    });

    const response = await server.inject({
      url: "/__warlock/api/ai/agent-runs/run_1",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(404);
  });

  it.each(["/api/ai/agent-runs", "/api/ai/agent-runs/run_1"])(
    "guards %s from production and remote clients",
    async (path) => {
      const remote = await fixture();
      const production = await fixture(false);

      for (const [server, remoteAddress] of [
        [remote.server, "10.0.0.5"],
        [production.server, "127.0.0.1"],
      ] as const) {
        const response = await server.inject({ url: `/__warlock${path}`, remoteAddress });

        expect(response.statusCode).toBe(404);
        expect(response.body).toBe("");
      }
    },
  );

  it("streams agent-trace updates and detaches the listener on disconnect", async () => {
    const { server, fake, agentTraces } = await fixture();
    let active = 0;
    const subscribe = agentTraces.subscribe.bind(agentTraces);

    agentTraces.subscribe = (listener) => {
      active += 1;
      const off = subscribe(listener);

      return () => {
        active -= 1;
        off();
      };
    };

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

      await waitFor(() => active === 1);
      fake.publish(trace("run_9"));

      expect(await frame).toBe(
        'event: agent-trace\ndata: {"runId":"run_9","status":"completed"}\n\n',
      );

      request.destroy();
      await waitFor(() => active === 0);
    } finally {
      request.destroy();
    }
  });
});
