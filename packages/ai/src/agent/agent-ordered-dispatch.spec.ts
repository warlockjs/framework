import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { MockSDK } from "../mock/mock-sdk";
import { catalogue } from "../tool/catalogue";
import { tool } from "../tool/tool";
import { agent } from "./agent";
import type { AgentMiddleware } from "./agent-middleware.type";

const stringSchema: StandardSchemaV1<string> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: String(value) }),
  },
};

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { id: string; name: string; input: string };

function modelFor(calls: Call[]) {
  return MockSDK({
    responses: [
      { content: "", finishReason: "tool_calls", toolCalls: calls },
      { content: "done", finishReason: "stop" },
    ],
  }).model({ name: "m" });
}

function makeTools(log: string[], delays: Record<string, number> = {}) {
  const make = (name: string, readOnly: boolean) =>
    tool({
      name,
      description: name,
      input: stringSchema,
      readOnly,
      execute: async (value: string) => {
        log.push(`start:${name}:${value}`);
        await tick(delays[`${name}:${value}`] ?? 10);
        log.push(`end:${name}:${value}`);

        return value;
      },
    });

  return [make("read", true), make("write", false), make("run", false)];
}

describe("toolDispatch: ordered", () => {
  it("runs a dependent call after the write finishes", async () => {
    const log: string[] = [];

    await agent({
      model: modelFor([
        { id: "1", name: "write", input: "a.js" },
        { id: "2", name: "run", input: "a.js" },
      ]),
      tools: makeTools(log),
      toolDispatch: "ordered",
    }).execute("go");

    expect(log).toEqual(["start:write:a.js", "end:write:a.js", "start:run:a.js", "end:run:a.js"]);
  });

  it("starts consecutive read-only calls together", async () => {
    const log: string[] = [];

    await agent({
      model: modelFor([
        { id: "1", name: "read", input: "a" },
        { id: "2", name: "read", input: "b" },
      ]),
      tools: makeTools(log),
      toolDispatch: "ordered",
    }).execute("go");

    expect(log.slice(0, 2)).toEqual(["start:read:a", "start:read:b"]);
  });

  it("runs a write between two reads alone", async () => {
    const log: string[] = [];

    await agent({
      model: modelFor([
        { id: "1", name: "read", input: "a" },
        { id: "2", name: "write", input: "w" },
        { id: "3", name: "read", input: "b" },
      ]),
      tools: makeTools(log, { "read:a": 20 }),
      toolDispatch: "ordered",
    }).execute("go");

    expect(log).toEqual([
      "start:read:a",
      "end:read:a",
      "start:write:w",
      "end:write:w",
      "start:read:b",
      "end:read:b",
    ]);
  });

  it("keeps results in request order", async () => {
    const log: string[] = [];
    const model = modelFor([
      { id: "1", name: "read", input: "slow" },
      { id: "2", name: "read", input: "fast" },
    ]);

    const result = await agent({
      model,
      tools: makeTools(log, { "read:slow": 30, "read:fast": 1 }),
      toolDispatch: "ordered",
    }).execute("go");

    expect(result.report.children.map((call) => call.callId)).toEqual(["1", "2"]);
  });

  it("fails an unregistered tool at once without delaying the others", async () => {
    const log: string[] = [];
    const result = await agent({
      model: modelFor([
        { id: "1", name: "read", input: "a" },
        { id: "2", name: "nope", input: "x" },
        { id: "3", name: "read", input: "b" },
      ]),
      tools: makeTools(log),
      toolDispatch: "ordered",
    }).execute("go");

    expect(log.slice(0, 2)).toEqual(["start:read:a", "start:read:b"]);
    expect(result.report.children.map((call) => call.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
  });

  it("still caps a read-only group with maxConcurrentTools", async () => {
    let running = 0;
    let peak = 0;
    const slow = tool({
      name: "slow",
      description: "slow",
      input: stringSchema,
      readOnly: true,
      execute: async (value: string) => {
        running++;
        peak = Math.max(peak, running);
        await tick();
        running--;

        return value;
      },
    });

    await agent({
      model: modelFor(
        Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: "slow", input: "x" })),
      ),
      tools: [slow],
      toolDispatch: "ordered",
      maxConcurrentTools: 2,
    }).execute("go");

    expect(peak).toBe(2);
  });

  it("starts tool middleware in request order", async () => {
    const seen: string[] = [];
    const recorder: AgentMiddleware = {
      name: "recorder",
      tool: {
        before(context) {
          seen.push(context.callId);
        },
      },
    };

    await agent({
      model: modelFor([
        { id: "1", name: "read", input: "a" },
        { id: "2", name: "read", input: "b" },
        { id: "3", name: "write", input: "c" },
      ]),
      tools: makeTools([]),
      toolDispatch: "ordered",
      middleware: [recorder],
    }).execute("go");

    expect(seen).toEqual(["1", "2", "3"]);
  });

  it("classifies a catalogue call by the tool it resolves to", async () => {
    const log: string[] = [];
    const [read, write] = makeTools(log);
    const cat = catalogue({ searchable: [read!, write!] });
    const callOf = (id: string, name: string, input: string): Call =>
      ({ id, name: "tool_call", input: { name, input } }) as unknown as Call;

    await agent({
      model: modelFor([
        callOf("1", "read", "a"),
        callOf("2", "read", "b"),
        callOf("3", "write", "w"),
      ]),
      tools: cat.tools,
      toolDispatch: "ordered",
    }).execute("go");

    expect(log.slice(0, 2)).toEqual(["start:read:a", "start:read:b"]);
    expect(log.indexOf("start:write:w")).toBeGreaterThan(log.indexOf("end:read:b"));
  });

  it("keeps concurrent as the default mode", async () => {
    const log: string[] = [];

    await agent({
      model: modelFor([
        { id: "1", name: "write", input: "a.js" },
        { id: "2", name: "run", input: "a.js" },
      ]),
      tools: makeTools(log),
    }).execute("go");

    expect(log.slice(0, 2)).toEqual(["start:write:a.js", "start:run:a.js"]);
  });

  it("exposes readOnly on the tool", () => {
    expect(makeTools([])[0]?.readOnly).toBe(true);
    expect(makeTools([])[1]?.readOnly).toBe(false);
  });
});

describe("tool call id and event order", () => {
  it("passes the model's call id to the tool", async () => {
    const seen: Array<string | undefined> = [];
    const probe = tool({
      name: "probe",
      description: "probe",
      input: stringSchema,
      execute: async (_value: string, ctx) => {
        seen.push(ctx?.callId);

        return "ok";
      },
    });

    await agent({
      model: modelFor([
        { id: "x1", name: "probe", input: "a" },
        { id: "x2", name: "probe", input: "b" },
      ]),
      tools: [probe],
    }).execute("go");

    expect(seen.sort()).toEqual(["x1", "x2"]);
  });

  it("keeps the caller's toolCtx and signal next to the call id", async () => {
    const artifacts = { kept: true };
    const controller = new AbortController();
    let received: { artifacts?: unknown; signal?: AbortSignal; callId?: string } | undefined;
    const probe = tool({
      name: "probe",
      description: "probe",
      input: stringSchema,
      execute: async (_value: string, ctx) => {
        received = ctx;

        return "ok";
      },
    });

    await agent({
      model: modelFor([{ id: "z", name: "probe", input: "a" }]),
      tools: [probe],
    }).execute("go", { toolCtx: { artifacts }, signal: controller.signal });

    expect(received?.artifacts).toBe(artifacts);
    expect(received?.signal).toBe(controller.signal);
    expect(received?.callId).toBe("z");
  });

  it("emits agent.tool.calling before the tool's execute starts", async () => {
    const order: string[] = [];
    const probe = tool({
      name: "probe",
      description: "probe",
      input: stringSchema,
      execute: async () => {
        order.push("execute");

        return "ok";
      },
    });

    await agent({
      model: modelFor([{ id: "c", name: "probe", input: "a" }]),
      tools: [probe],
      on: { "agent.tool.calling": () => void order.push("calling") },
    }).execute("go");

    expect(order).toEqual(["calling", "execute"]);
  });

  it("puts the tool-call stream part before the tool's output", async () => {
    const order: string[] = [];
    const probe = tool({
      name: "probe",
      description: "probe",
      input: stringSchema,
      execute: async () => {
        order.push("execute");

        return "ok";
      },
    });
    const stream = agent({
      model: modelFor([{ id: "c", name: "probe", input: "a" }]),
      tools: [probe],
    }).stream("go");

    for await (const event of stream) {
      if (event.type === "agent.tool.calling") order.push("calling");
      if (event.type === "agent.tool.called") order.push("called");
    }

    expect(order).toEqual(["calling", "execute", "called"]);
  });
});

describe("agent.context.edited", () => {
  const big = "x".repeat(400);

  it("is emitted once when clearing crosses afterTokens, and the cache miss names messages", async () => {
    const edited = vi.fn();
    const misses = vi.fn();
    const probe = tool({
      name: "probe",
      description: "probe",
      input: stringSchema,
      execute: async () => big,
    });
    const responses = [1, 2, 3, 4].map((id) => ({
      content: "",
      finishReason: "tool_calls" as const,
      toolCalls: [{ id: `c${id}`, name: "probe", input: "a" }],
      usage: { input: 10, output: 1, cachedTokens: id === 4 ? 0 : 1000 },
    }));

    await agent({
      model: MockSDK({
        responses: [...responses, { content: "done", finishReason: "stop" as const }],
      }).model({ name: "m" }),
      tools: [probe],
      contextEditing: { clearToolResults: { afterTokens: 300, keep: 1 } },
      diagnostics: { cacheFingerprint: true },
      on: { "agent.context.edited": edited, "agent.trip.cache-miss-cause": misses },
    }).execute("go");

    expect(edited).toHaveBeenCalled();
    const first = edited.mock.calls[0]![0];

    expect(first.clearedResults).toBeGreaterThan(0);
    expect(first.tokensAfter).toBeLessThan(first.tokensBefore);
    expect(first.tripIndex).toBeTypeOf("number");
    expect(misses.mock.calls.some(([payload]) => payload.segments.includes("messages"))).toBe(true);
  });
});
