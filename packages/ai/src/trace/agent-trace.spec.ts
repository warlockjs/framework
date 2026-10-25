import type { StandardSchemaV1 } from "@standard-schema/spec";
import { registerLogSecret } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent } from "../agent/agent";
import type { MockModelResponse } from "../mock/mock-config.type";
import { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import { diffAgentTraces, formatAgentTrace } from "./agent-trace-diff";
import { resolveTraceOptions } from "./agent-trace-recorder";
import { agentTraces, createAgentTraceStore } from "./agent-trace-store";
import type { AgentTrace } from "./agent-trace.type";

const stringSchema: StandardSchemaV1<unknown> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { query?: unknown }).query === "string"
        ? { value }
        : { issues: [{ message: "expected a query string" }] },
  },
  jsonSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
} as unknown as StandardSchemaV1<unknown>;

function lookupTool(
  execute: (input: unknown) => Promise<unknown> = async () => ({ found: true }),
  description = "Look something up.",
) {
  return tool({ name: "lookup", description, input: stringSchema, execute });
}

function build(responses: MockModelResponse[], pricing?: { input: number; output: number }) {
  return new MockModel("trace-model", responses, undefined, pricing);
}

const call = (input: unknown, id = "c1") => ({ id, name: "lookup", input });

function tracedAgent(
  model: MockModel,
  store = createAgentTraceStore(),
  extra: Record<string, unknown> = {},
) {
  return {
    store,
    agent: agent({
      name: "coach",
      model,
      systemPrompt: "You are a coach.",
      tools: [lookupTool()],
      trace: { enabled: true, store, text: true },
      ...extra,
    }),
  };
}

afterEach(() => {
  agentTraces.clear();
  vi.unstubAllEnvs();
});

describe("createAgentTraceStore()", () => {
  const trace = (runId: string, agentName = "a"): AgentTrace =>
    ({ runId, agent: agentName, status: "completed", turns: [] }) as unknown as AgentTrace;

  it("lists newest first and drops the oldest past capacity", () => {
    const store = createAgentTraceStore({ capacity: 2 });

    store.publish(trace("one"));
    store.publish(trace("two"));
    store.publish(trace("three"));

    expect(store.list().map((item) => item.runId)).toEqual(["three", "two"]);
    expect(store.get("one")).toBeUndefined();
    expect(store.capacity).toBe(2);
  });

  it("moves an updated run to the newest position instead of duplicating it", () => {
    const store = createAgentTraceStore();

    store.publish(trace("one"));
    store.publish(trace("two"));
    store.publish({ ...trace("one"), status: "failed" });

    expect(store.list().map((item) => `${item.runId}:${item.status}`)).toEqual([
      "one:failed",
      "two:completed",
    ]);
  });

  it("filters by agent and status and applies a limit", () => {
    const store = createAgentTraceStore();

    store.publish(trace("1", "a"));
    store.publish({ ...trace("2", "b"), status: "failed" });
    store.publish(trace("3", "a"));

    expect(store.list({ agent: "a" }).map((item) => item.runId)).toEqual(["3", "1"]);
    expect(store.list({ status: "failed" }).map((item) => item.runId)).toEqual(["2"]);
    expect(store.list({ limit: 1 })).toHaveLength(1);
  });

  it("isolates listeners and supports unsubscribe and clear", () => {
    const store = createAgentTraceStore();
    const seen: string[] = [];

    store.subscribe(() => {
      throw new Error("broken listener");
    });
    const off = store.subscribe((event) => seen.push(`${event.runId}:${event.status}`));

    store.publish(trace("one"));
    off();
    store.publish(trace("two"));

    expect(seen).toEqual(["one:completed"]);

    store.clear();
    expect(store.list()).toEqual([]);
  });

  it("shares one default store across module copies through the global registry", () => {
    const key = Symbol.for("@warlock.js/ai.agentTraces");

    expect((globalThis as Record<symbol, unknown>)[key]).toBe(agentTraces);
  });
});

describe("resolveTraceOptions()", () => {
  it("records in development, with text", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITEST", "");

    expect(resolveTraceOptions(undefined)).toMatchObject({ text: true, store: agentTraces });
  });

  it("records nothing under a test runner or in production unless asked", () => {
    expect(resolveTraceOptions(undefined)).toBeUndefined();

    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveTraceOptions(undefined)).toBeUndefined();
    expect(resolveTraceOptions(true)).toMatchObject({ text: false });
    expect(resolveTraceOptions({ text: true })).toBeUndefined();
    expect(resolveTraceOptions({ enabled: true, text: true })).toMatchObject({ text: true });
    expect(resolveTraceOptions(false)).toBeUndefined();
  });
});

describe("agent({ trace })", () => {
  it("records the system prompt, tools offered, calls, results, usage and cost per turn", async () => {
    const model = build(
      [
        {
          content: "Looking.",
          toolCalls: [call({ query: "squat" })],
          usage: { input: 100, output: 20 },
        },
        { content: "Found it.", usage: { input: 150, output: 30 } },
      ],
      { input: 1, output: 2 },
    );
    const { agent: coach, store } = tracedAgent(model);

    const result = await coach.execute("find squat");
    const trace = store.get(result.report.runId)!;

    expect(trace.schemaVersion).toBe(1);
    expect(trace.agent).toBe("coach");
    expect(trace.status).toBe("completed");
    expect(trace.input).toBe("find squat");
    expect(trace.model).toEqual({ name: "trace-model", provider: "mock" });
    expect(trace.systemPrompt?.text).toBe("You are a coach.");
    expect(trace.systemPrompt?.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(trace.turns).toHaveLength(2);
    expect(trace.usage).toMatchObject({ input: 250, output: 50 });
    expect(trace.cost).toBeGreaterThan(0);

    const [first, second] = trace.turns;

    expect(first).toMatchObject({
      index: 0,
      input: "find squat",
      finishReason: "tool_calls",
      systemPromptHash: trace.systemPrompt?.hash,
      text: "Looking.",
    });
    expect(first!.toolsOffered).toHaveLength(1);
    expect(first!.toolsOffered[0]).toMatchObject({ name: "lookup" });
    expect(first!.toolsOffered[0]!.tokens).toBeGreaterThan(0);
    expect(first!.toolCalls).toMatchObject([
      { name: "lookup", status: "completed", input: { query: "squat" }, output: { found: true } },
    ]);
    expect(first!.usage).toMatchObject({ input: 100, output: 20 });
    expect(first!.cost).toBeGreaterThan(0);
    expect(second).toMatchObject({ index: 1, input: "[tool results]", finishReason: "stop" });
    expect(second!.toolsHash).toBe(first!.toolsHash);

    const schema = trace.toolSchemas[first!.toolsOffered[0]!.schemaHash];

    expect(schema?.name).toBe("lookup");
    expect(JSON.parse(schema!.schema!)).toMatchObject({ type: "object" });
  });

  it("records refusals with their reason and failed tool errors", async () => {
    const model = build([{ content: "", toolCalls: [call(42)] }, { content: "Cannot." }]);
    const { agent: coach, store } = tracedAgent(model);

    const result = await coach.execute("go");
    const turn = store.get(result.report.runId)!.turns[0]!;

    expect(turn.toolCalls[0]).toMatchObject({ name: "lookup", status: "failed" });
    expect(turn.toolCalls[0]!.refusal).toContain("expected a query string");
    expect(turn.toolCalls[0]!.error?.message).toContain("expected a query string");
  });

  it("records what the tool-use contract did on the turn", async () => {
    const model = build([{ content: "I could do that." }, { content: "Done." }]);
    const { agent: coach, store } = tracedAgent(model, undefined, {
      actWhenAsked: { intents: ["swap"], requiredTools: ["lookup"] },
      backstops: [{ name: "audit", detect: () => true, run: () => undefined }],
    });

    const result = await coach.execute("swap it");
    const trace = store.get(result.report.runId)!;
    const events = trace.turns.flatMap((turn) => turn.contract.map((event) => event.type));

    expect(events).toContain("backstop");
    expect(events).toContain("act-reprompt");
    expect(trace.turns).toHaveLength(2);
    expect(trace.turns[1]!.input).toBe("[contract hint]");
  });

  it("records a backstop that ran before the first call on turn 0", async () => {
    const model = build([{ content: "Fine." }]);
    const { agent: coach, store } = tracedAgent(model, undefined, {
      backstops: [{ name: "early", phase: "before", detect: () => true, run: () => undefined }],
    });

    const result = await coach.execute("go");

    expect(store.get(result.report.runId)!.turns[0]!.contract).toMatchObject([
      { type: "backstop", name: "early", phase: "before" },
    ]);
  });

  it("marks a failed run with its error", async () => {
    const model = build([{ content: "", error: new Error("provider down") }]);
    const { agent: coach, store } = tracedAgent(model);

    const result = await coach.execute("go");
    const trace = store.get(result.report.runId)!;

    expect(trace.status).toBe("failed");
    expect(trace.error?.message).toContain("provider down");
    expect(trace.turns[0]!.error?.message).toContain("provider down");
  });

  it("publishes while the run is in progress and again when it ends", async () => {
    const model = build([{ content: "", toolCalls: [call({ query: "x" })] }, { content: "ok" }]);
    const { agent: coach, store } = tracedAgent(model);
    const statuses: string[] = [];

    store.subscribe((event) => statuses.push(event.status));
    await coach.execute("go");

    expect(statuses[0]).toBe("running");
    expect(statuses.at(-1)).toBe("completed");
    expect(statuses.length).toBeGreaterThan(2);
  });

  it("keeps hashes but no text when text is off", async () => {
    const store = createAgentTraceStore();
    const coach = agent({
      model: build([{ content: "secret reply" }]),
      systemPrompt: "You are a coach.",
      tools: [lookupTool()],
      trace: { enabled: true, store, text: false },
    });

    const result = await coach.execute("go");
    const trace = store.get(result.report.runId)!;

    expect(trace.systemPrompt?.hash).toBeDefined();
    expect(trace.systemPrompt?.text).toBeUndefined();
    expect(trace.turns[0]!.text).toBeUndefined();
    expect(Object.values(trace.toolSchemas)[0]!.schema).toBeUndefined();
  });

  it("is off under the test runner unless enabled, and never records with false", async () => {
    await agent({ model: build([{ content: "a" }]) }).execute("go");
    await agent({ model: build([{ content: "a" }]), trace: false }).execute("go");

    expect(agentTraces.list()).toEqual([]);

    const result = await agent({ model: build([{ content: "a" }]), trace: true }).execute("go");

    expect(agentTraces.get(result.report.runId)?.status).toBe("completed");
  });

  it("does not change the run result", async () => {
    const responses: MockModelResponse[] = [
      { content: "", toolCalls: [call({ query: "x" })] },
      { content: "Done." },
    ];
    const plain = await agent({ model: build(responses), tools: [lookupTool()] }).execute("go");
    const traced = await agent({
      model: build(responses),
      tools: [lookupTool()],
      trace: { enabled: true, store: createAgentTraceStore() },
    }).execute("go");

    expect(traced.text).toBe(plain.text);
    expect(traced.usage).toEqual(plain.usage);
    expect(traced.report.trips).toHaveLength(plain.report.trips?.length ?? 0);
  });
});

describe("agent trace redaction", () => {
  it("censors secret keys in tool arguments and results", async () => {
    const secretTool = tool({
      name: "login",
      description: "Log in.",
      execute: async () => ({ ok: true, token: "tok_live_123", password: "hunter2" }),
    });
    const store = createAgentTraceStore();
    const model = build([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "login", input: { query: "u", apiKey: "k-1" } }],
      },
      { content: "ok" },
    ]);

    const result = await agent({
      model,
      tools: [secretTool],
      trace: { enabled: true, store },
    }).execute("log me in");
    const call0 = store.get(result.report.runId)!.turns[0]!.toolCalls[0]!;

    expect(JSON.stringify(call0)).not.toContain("hunter2");
    expect(JSON.stringify(call0)).not.toContain("tok_live_123");
    expect(JSON.stringify(call0)).not.toContain("k-1");
    expect(call0.input).toMatchObject({ query: "u" });
  });

  it("masks registered credentials inside prompt and reply text", async () => {
    registerLogSecret("sk-live-ABCDEF123456");
    const store = createAgentTraceStore();
    const coach = agent({
      model: build([{ content: "Your key is sk-live-ABCDEF123456." }]),
      systemPrompt: "Use key sk-live-ABCDEF123456 for the API.",
      trace: { enabled: true, store, text: true },
    });

    const result = await coach.execute("what is my key sk-live-ABCDEF123456?");
    const text = JSON.stringify(store.get(result.report.runId));

    expect(text).not.toContain("sk-live-ABCDEF123456");
    expect(text).toContain("[REDACTED]");
  });

  it("applies extra redact keys and cuts long strings", async () => {
    const store = createAgentTraceStore();
    const model = build([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "echo", input: { note: "n".repeat(50), memberCode: "m-9" } }],
      },
      { content: "ok" },
    ]);
    const echo = tool({
      name: "echo",
      description: "Echo.",
      execute: async (input: unknown) => input,
    });

    const result = await agent({
      model,
      tools: [echo],
      trace: { enabled: true, store, redact: { keys: ["memberCode"] }, maxStringLength: 10 },
    }).execute("go");
    const input = store.get(result.report.runId)!.turns[0]!.toolCalls[0]!.input as Record<
      string,
      string
    >;

    expect(input.memberCode).toBe("[REDACTED]");
    expect(input.note).toMatch(/^n{10}\.\.\.\[40 more characters\]$/);
  });
});

describe("diffAgentTraces()", () => {
  async function run(description: string, systemPrompt: string) {
    const store = createAgentTraceStore();
    const result = await agent({
      model: build([{ content: "ok" }]),
      systemPrompt,
      tools: [lookupTool(undefined, description)],
      trace: { enabled: true, store, text: true },
    }).execute("go");

    return store.get(result.report.runId)!;
  }

  it("reports identical requests", async () => {
    const first = await run("Look it up.", "Line one.\nLine two.");
    const second = await run("Look it up.", "Line one.\nLine two.");

    expect(diffAgentTraces(first, second)).toEqual({
      identical: true,
      systemPrompt: { changed: false },
      tools: { added: [], removed: [], changed: [] },
    });
  });

  it("reports a changed tool definition and the changed prompt lines", async () => {
    const first = await run("Look it up.", "Line one.\nLine two.");
    const second = await run("Look it up quickly.", "Line one.\nLine three.");
    const diff = diffAgentTraces(first, second);

    expect(diff.identical).toBe(false);
    expect(diff.tools.changed).toEqual(["lookup"]);
    expect(diff.systemPrompt).toEqual({
      changed: true,
      addedLines: ["Line three."],
      removedLines: ["Line two."],
    });
  });

  it("reports added and removed tools", async () => {
    const first = await run("d", "p");
    const second = {
      ...first,
      turns: first.turns.map((turn) => ({
        ...turn,
        toolsOffered: [{ name: "extra", schemaHash: "abc", tokens: 1 }],
      })),
    };
    const diff = diffAgentTraces(first, second);

    expect(diff.tools).toEqual({ added: ["extra"], removed: ["lookup"], changed: [] });
  });
});

describe("formatAgentTrace()", () => {
  it("prints the run, turns, tool calls and refusals as plain text", async () => {
    const model = build([
      { content: "", toolCalls: [call(42)] },
      { content: "", toolCalls: [call({ query: "squat" }, "c2")] },
      { content: "Done." },
    ]);
    const { agent: coach, store } = tracedAgent(model);

    const result = await coach.execute("find squat");
    const text = formatAgentTrace(store.get(result.report.runId)!);

    expect(text).toContain("coach");
    expect(text).toContain("completed");
    expect(text).toContain("input: find squat");
    expect(text).toContain("turn 0");
    expect(text).toContain("tools offered (1");
    expect(text).toContain("call lookup");
    expect(text).toContain("refused: Validation failed: expected a query string");
    expect(text).toContain('result: {"found":true}');
    expect(text).toContain("total: in");
  });
});
