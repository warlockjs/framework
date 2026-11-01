import { beforeEach, describe, expect, it } from "vitest";
import { agent } from "../agent/agent";
import { MockSDK } from "../mock/mock-sdk";
import { clearToolMemo } from "./memoize";
import { tool } from "./tool";

function toolTrip(...calls: Array<{ id: string; input: unknown }>) {
  return {
    content: "",
    finishReason: "tool_calls" as const,
    toolCalls: calls.map((call) => ({ id: call.id, name: "lookup", input: call.input })),
  };
}

function scripted(...trips: ReturnType<typeof toolTrip>[]) {
  const sdk = MockSDK({
    responses: [...trips, { content: "done", finishReason: "stop" as const }],
  });

  return sdk.model({ name: "gpt-test" });
}

function lookupTool(memoize: Parameters<typeof tool>[0]["memoize"], failOnce = false) {
  const calls: unknown[] = [];
  let failed = !failOnce;

  const lookup = tool({
    name: "lookup",
    description: "Read-only lookup",
    memoize,
    execute: async (input: unknown) => {
      calls.push(input);

      if (!failed) {
        failed = true;
        throw new Error("transient");
      }

      return { found: input };
    },
  });

  return { lookup, calls };
}

beforeEach(() => clearToolMemo());

describe("tool memoize", () => {
  it("runs a plain tool every time", async () => {
    const { lookup, calls } = lookupTool(undefined);
    const model = scripted(toolTrip({ id: "1", input: { id: 1 } }), toolTrip({ id: "2", input: { id: 1 } }));

    await agent({ model, tools: [lookup] }).execute("go");

    expect(calls).toHaveLength(2);
  });

  it("reuses a result for the same arguments inside a run, whatever the key order", async () => {
    const { lookup, calls } = lookupTool(true);
    const model = scripted(
      toolTrip({ id: "1", input: { a: 1, b: 2 } }),
      toolTrip({ id: "2", input: { b: 2, a: 1 } }),
      toolTrip({ id: "3", input: { a: 9, b: 2 } }),
    );

    const result = await agent({ model, tools: [lookup] }).execute("go");
    const records = result.report.children.filter((child) => child.type === "tool") as Array<{
      memoized?: true;
      output?: unknown;
    }>;

    expect(calls).toHaveLength(2);
    expect(records.map((record) => record.memoized)).toEqual([undefined, true, undefined]);
    expect(records[1].output).toEqual(records[0].output);
  });

  it("shares one execution between identical calls of the same trip", async () => {
    const { lookup, calls } = lookupTool(true);
    const model = scripted(toolTrip({ id: "1", input: { id: 1 } }, { id: "2", input: { id: 1 } }));

    await agent({ model, tools: [lookup] }).execute("go");

    expect(calls).toHaveLength(1);
  });

  it("does not carry a run memo into the next run", async () => {
    const { lookup, calls } = lookupTool(true);
    const run = () =>
      agent({ model: scripted(toolTrip({ id: "1", input: { id: 1 } })), tools: [lookup] }).execute("go");

    await run();
    await run();

    expect(calls).toHaveLength(2);
  });

  it("shares results across runs of one session and keeps sessions apart", async () => {
    const { lookup, calls } = lookupTool({ scope: "session" });
    const run = (sessionId?: string) =>
      agent({ model: scripted(toolTrip({ id: "1", input: { id: 1 } })), tools: [lookup] }).execute(
        "go",
        { sessionId },
      );

    await run("s1");
    await run("s1");
    expect(calls).toHaveLength(1);

    await run("s2");
    expect(calls).toHaveLength(2);

    await run();
    await run();
    expect(calls).toHaveLength(4);
  });

  it("expires a session result after its ttl", async () => {
    const { lookup, calls } = lookupTool({ scope: "session", ttl: 20 });
    const run = () =>
      agent({ model: scripted(toolTrip({ id: "1", input: { id: 1 } })), tools: [lookup] }).execute(
        "go",
        { sessionId: "s1" },
      );

    await run();
    await new Promise((done) => setTimeout(done, 40));
    await run();

    expect(calls).toHaveLength(2);
  });

  it("does not memoize an error", async () => {
    const { lookup, calls } = lookupTool(true, true);
    const model = scripted(toolTrip({ id: "1", input: { id: 1 } }), toolTrip({ id: "2", input: { id: 1 } }));

    const result = await agent({ model, tools: [lookup] }).execute("go");
    const records = result.report.children.filter((child) => child.type === "tool") as Array<{
      memoized?: true;
      error?: unknown;
    }>;

    expect(calls).toHaveLength(2);
    expect(records[0].error).toBeDefined();
    expect(records[1].memoized).toBeUndefined();
    expect(records[1].error).toBeUndefined();
  });

  it("emits the memoized flag on the tool-called event", async () => {
    const { lookup } = lookupTool(true);
    const model = scripted(toolTrip({ id: "1", input: { id: 1 } }), toolTrip({ id: "2", input: { id: 1 } }));
    const flags: Array<true | undefined> = [];

    await agent({
      model,
      tools: [lookup],
      on: { "agent.tool.called": (payload) => flags.push((payload as { memoized?: true }).memoized) },
    }).execute("go");

    expect(flags).toEqual([undefined, true]);
  });
});
