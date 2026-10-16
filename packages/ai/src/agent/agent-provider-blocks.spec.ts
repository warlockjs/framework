import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { AgentMiddleware } from "../contracts/middleware";
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

describe("agent — provider content blocks", () => {
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

  it("leaves result.blocks unset after a multi-trip run (they need the intermediate turns)", async () => {
    const mock = MockSDK({
      responses: [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "echo", input: "x" }],
          blocks: [thinking, toolUse],
        },
        { content: "done", finishReason: "stop", blocks: [thinking] },
      ],
    });

    const result = await agent({
      model: mock.model({ name: "m" }),
      tools: [echoTool],
      captureMessages: true,
    }).execute("go");

    expect(result.text).toBe("done");
    expect(result.blocks).toBeUndefined();
    // The full transcript still carries them, with the turns they were signed against.
    expect(result.report.trips[1]?.blocks).toEqual([thinking]);
    expect(result.report.messages?.some((message) => message.blocks !== undefined)).toBe(true);
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

describe("agent — pause_turn", () => {
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
    // The continuation carries only its new content: the turn's text is both segments.
    expect(result.text).toBe("searchingfound it");
    expect(result.error).toBeUndefined();
    expect(result.report.trips[1]?.input).toBe("[continue]");
  });

  it("parses structured output from every segment of a resumed turn", async () => {
    const objectSchema = makeSchema<{ answer: number }>((value) =>
      typeof value === "object" && value !== null && "answer" in value
        ? { value: value as { answer: number } }
        : { issues: [{ message: "expected { answer }" }] },
    );
    const mock = MockSDK({
      responses: [
        { content: '{"answer":', finishReason: "pause_turn" },
        { content: " 42}", finishReason: "stop" },
      ],
    });

    const result = await agent({ model: mock.model({ name: "m" }), output: objectSchema }).execute(
      "go",
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ answer: 42 });
    expect(result.text).toBe('{"answer": 42}');
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

describe("agent — tool dispatch", () => {
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

  it("appends each result before the next call under sequential dispatch", async () => {
    const seen: string[][] = [];
    const recorder: AgentMiddleware = {
      name: "recorder",
      tool: {
        before(context) {
          seen.push(
            context.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.toolCallId ?? ""),
          );
        },
      },
    };
    const { gates, tools } = makeTrackedTools();
    gates.a.resolve();
    gates.b.resolve();

    await agent({
      model: twoCalls().model({ name: "m" }),
      tools,
      toolDispatch: "sequential",
      middleware: [recorder],
    }).execute("go");

    // Call b's middleware sees call a's result, as it did before 5.30.
    expect(seen).toEqual([[], ["call_a"]]);
  });

  it("caps concurrently running tools with maxConcurrentTools", async () => {
    let running = 0;
    let peak = 0;
    const slow = tool({
      name: "slow",
      description: "slow",
      input: stringSchema,
      execute: async (value: string) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;

        return value;
      },
    });
    const calls = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      name: "slow",
      input: String(index),
    }));
    const mock = () =>
      MockSDK({
        responses: [
          { content: "", finishReason: "tool_calls", toolCalls: calls },
          { content: "done", finishReason: "stop" },
        ],
      });

    const capped = mock().model({ name: "m" }) as MockModel;
    await agent({ model: capped, tools: [slow], maxConcurrentTools: 2 }).execute("go");
    expect(peak).toBe(2);

    const order = snapshotCalls(capped)[1]?.filter((message) => message.role === "tool");
    expect(order?.map((message) => message.toolCallId)).toEqual(calls.map((call) => call.id));

    peak = 0;
    await agent({ model: mock().model({ name: "m" }), tools: [slow] }).execute("go");
    expect(peak).toBe(4); // the default cap

    peak = 0;
    await agent({
      model: mock().model({ name: "m" }),
      tools: [slow],
      maxConcurrentTools: 2,
    }).execute("go", { maxConcurrentTools: 6 });
    expect(peak).toBe(6);
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
