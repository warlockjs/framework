import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ProviderContentBlock } from "../contracts/provider-content-block.type";
import { MockSDK } from "../mock/mock-sdk";
import type { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import { agent } from "./agent";

function makeSchema<T>(
  validate: (value: unknown) => StandardSchemaV1.Result<T>,
): StandardSchemaV1<T> {
  return { "~standard": { version: 1, vendor: "test", validate } };
}

const stringSchema = makeSchema<string>((v) =>
  typeof v === "string" ? { value: v } : { issues: [{ message: "expected string" }] },
);

const thinking: ProviderContentBlock = {
  provider: "anthropic",
  type: "thinking",
  data: { type: "thinking", thinking: "", signature: "sig_1" },
};

const toolUse: ProviderContentBlock = {
  provider: "anthropic",
  type: "tool_use",
  data: { type: "tool_use", id: "c1", name: "echo", input: "x" },
};

const echoTool = tool({
  name: "echo",
  description: "echo",
  input: stringSchema,
  execute: async (value: string) => `echoed: ${value}`,
});

/** Snapshot of the messages each call received (the agent mutates its array afterwards). */
function snapshotCalls(model: MockModel): Message[][] {
  return model.callHistory.map((call) => call.messages.map((message) => ({ ...message })));
}

/** A promise with its resolver exposed, to hold a tool open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe("agent — provider content blocks (WR-022)", () => {
  it("copies the response blocks onto the assistant tool-call turn and the trip", async () => {
    const mock = MockSDK({
      responses: [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "echo", input: "x" }],
          blocks: [thinking, toolUse],
        },
        { content: "done", finishReason: "stop" },
      ],
    });
    const model = mock.model({ name: "m" }) as MockModel;

    const result = await agent({ model, tools: [echoTool] }).execute("go");

    const assistant = model.callHistory[1]?.messages.find(
      (message) => message.role === "assistant",
    );

    expect(assistant?.blocks).toEqual([thinking, toolUse]);
    expect(result.report.trips[0]?.blocks).toEqual([thinking, toolUse]);
    expect(result.report.trips[1]?.blocks).toBeUndefined();
  });

  it("exposes the final trip's blocks on the result", async () => {
    const finalBlocks: ProviderContentBlock[] = [
      thinking,
      { provider: "anthropic", type: "text", data: { type: "text", text: "hi" } },
    ];
    const mock = MockSDK({
      responses: [{ content: "hi", finishReason: "stop", blocks: finalBlocks }],
    });

    const result = await agent({ model: mock.model({ name: "m" }) }).execute("go");

    expect(result.blocks).toEqual(finalBlocks);
  });

  it("carries blocks through a streamed trip", async () => {
    const mock = MockSDK({
      responses: [{ content: "hi", finishReason: "stop", blocks: [thinking] }],
    });

    const stream = agent({ model: mock.model({ name: "m" }) }).stream("go");

    for await (const _event of stream) {
      // drain
    }

    const result = await stream.result;

    expect(result.blocks).toEqual([thinking]);
  });

  it("captures blocks on AgentReport.messages", async () => {
    const mock = MockSDK({
      responses: [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "echo", input: "x" }],
          blocks: [thinking, toolUse],
        },
        { content: "done", finishReason: "stop" },
      ],
    });

    const result = await agent({
      model: mock.model({ name: "m" }),
      tools: [echoTool],
      captureMessages: true,
    }).execute("go");

    const assistant = result.report.messages?.find((message) => message.role === "assistant");

    expect(assistant?.blocks).toEqual([thinking, toolUse]);
  });
});

describe("agent — pause_turn (WR-023)", () => {
  it("replays a paused turn and continues the loop", async () => {
    const paused: ProviderContentBlock[] = [
      {
        provider: "anthropic",
        type: "server_tool_use",
        data: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} },
      },
    ];
    const mock = MockSDK({
      responses: [
        { content: "searching", finishReason: "pause_turn", blocks: paused },
        { content: "found it", finishReason: "stop" },
      ],
    });
    const model = mock.model({ name: "m" }) as MockModel;

    const result = await agent({ model }).execute("look it up");

    const calls = snapshotCalls(model);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)).toEqual({ role: "assistant", content: "searching", blocks: paused });
    expect(result.text).toBe("found it");
    expect(result.error).toBeUndefined();
    expect(result.report.trips[1]?.input).toBe("[continue]");
  });

  it("reports max trips when the model keeps pausing", async () => {
    const mock = MockSDK({
      responses: [{ content: "still going", finishReason: "pause_turn" }],
    });

    const result = await agent({ model: mock.model({ name: "m" }), maxTrips: 2 }).execute("go");

    expect(result.error?.code).toBe("AGENT_MAX_TRIPS");
    expect(result.report.trips).toHaveLength(2);
  });

  it("stops on refusal and context_exceeded without continuing", async () => {
    for (const finishReason of ["refusal", "context_exceeded"] as const) {
      const mock = MockSDK({
        responses: [
          { content: "", finishReason },
          { content: "never", finishReason: "stop" },
        ],
      });
      const model = mock.model({ name: "m" }) as MockModel;

      const result = await agent({ model }).execute("go");

      expect(model.callCount, finishReason).toBe(1);
      expect(result.report.trips[0]?.finishReason).toBe(finishReason);
    }
  });
});

describe("agent — tool dispatch (WR-024)", () => {
  function makeTrackedTools() {
    const log: string[] = [];
    const gates = { a: deferred(), b: deferred() };

    const make = (name: "a" | "b") =>
      tool({
        name,
        description: name,
        input: stringSchema,
        execute: async (value: string) => {
          log.push(`start:${name}`);
          await gates[name].promise;
          log.push(`end:${name}`);

          return `${name}:${value}`;
        },
      });

    return { log, gates, tools: [make("a"), make("b")] };
  }

  const twoCalls = () =>
    MockSDK({
      responses: [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            { id: "call_a", name: "a", input: "1" },
            { id: "call_b", name: "b", input: "2" },
          ],
        },
        { content: "done", finishReason: "stop" },
      ],
    });

  it("runs the calls of one trip concurrently and keeps request order", async () => {
    const { log, gates, tools } = makeTrackedTools();
    const model = twoCalls().model({ name: "m" }) as MockModel;

    const running = agent({ model, tools }).execute("go");

    // Let both tools start, then finish them in reverse order.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log).toEqual(["start:a", "start:b"]);

    gates.b.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates.a.resolve();

    const result = await running;
    const toolMessages = snapshotCalls(model)[1]?.filter((message) => message.role === "tool");

    expect(log).toEqual(["start:a", "start:b", "end:b", "end:a"]);
    expect(toolMessages?.map((message) => message.toolCallId)).toEqual(["call_a", "call_b"]);
    expect(result.report.trips[0]?.toolCalls?.map((call) => call.name)).toEqual(["a", "b"]);
  });

  it("awaits each call before the next with toolDispatch: 'sequential'", async () => {
    const { log, gates, tools } = makeTrackedTools();
    const model = twoCalls().model({ name: "m" }) as MockModel;

    const running = agent({ model, tools, toolDispatch: "sequential" }).execute("go");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log).toEqual(["start:a"]);

    gates.a.resolve();
    gates.b.resolve();
    await running;

    expect(log).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("lets a per-call option override the agent's dispatch mode", async () => {
    const { log, gates, tools } = makeTrackedTools();
    const model = twoCalls().model({ name: "m" }) as MockModel;

    const running = agent({ model, tools, toolDispatch: "sequential" }).execute("go", {
      toolDispatch: "concurrent",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log).toEqual(["start:a", "start:b"]);

    gates.a.resolve();
    gates.b.resolve();
    await running;
  });
});
