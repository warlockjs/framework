import {
  ConverseStreamCommand,
  type BedrockRuntimeClient,
  type ConverseResponse,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { ai, type ModelStreamChunk } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BedrockModel } from "./model";

function makeModel(options: {
  events?: ConverseStreamOutput[];
  converse?: Partial<ConverseResponse>;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const send = async (command: { input: unknown }) => {
    calls.push(command.input as Record<string, unknown>);

    if (command instanceof ConverseStreamCommand) {
      return {
        stream: (async function* () {
          yield* options.events ?? [];
        })(),
      };
    }

    return options.converse;
  };
  const client = { send } as unknown as BedrockRuntimeClient;

  return { model: new BedrockModel(client, { name: "anthropic.claude-sonnet-4-5" }), calls };
}

async function collect(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Recorded-style ConverseStream events: a reasoning block (text deltas then
 * a signature), and a client tool use whose input streams in fragments.
 * Event members follow the SDK's `ConverseStreamOutput` union.
 */
const REASONING_AND_TOOL_EVENTS = [
  { messageStart: { role: "assistant" } },
  {
    contentBlockDelta: {
      contentBlockIndex: 0,
      delta: { reasoningContent: { text: "Check the " } },
    },
  },
  {
    contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "forecast." } } },
  },
  {
    contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig" } } },
  },
  { contentBlockStop: { contentBlockIndex: 0 } },
  {
    contentBlockStart: {
      contentBlockIndex: 1,
      start: { toolUse: { toolUseId: "tooluse_1", name: "get_weather" } },
    },
  },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{"city":' } } } },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '"Cairo"}' } } } },
  { contentBlockStop: { contentBlockIndex: 1 } },
  { messageStop: { stopReason: "tool_use" } },
  { metadata: { usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } } },
] as unknown as ConverseStreamOutput[];

/** A system tool (Nova web grounding) runs server-side: `server_tool_use`. */
const SERVER_TOOL_EVENTS = [
  { messageStart: { role: "assistant" } },
  {
    contentBlockStart: {
      contentBlockIndex: 0,
      start: { toolUse: { toolUseId: "srv_1", name: "nova_grounding", type: "server_tool_use" } },
    },
  },
  {
    contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"query":"news"}' } } },
  },
  { contentBlockStop: { contentBlockIndex: 0 } },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { text: "Here is the news." } } },
  { contentBlockStop: { contentBlockIndex: 1 } },
  { messageStop: { stopReason: "end_turn" } },
  { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } },
] as unknown as ConverseStreamOutput[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BedrockModel.stream() optional chunks", () => {
  it("keeps the old sequence without opt-in", async () => {
    const { model } = makeModel({ events: REASONING_AND_TOOL_EVENTS });

    const chunks = await collect(model.stream([{ role: "user", content: "weather?" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["tool-call", "done"]);
  });

  it("maps reasoningContent text and toolUse input deltas", async () => {
    const { model } = makeModel({ events: REASONING_AND_TOOL_EVENTS });

    const chunks = await collect(
      model.stream([{ role: "user", content: "weather?" }], { streamChunks: true }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning",
      "reasoning",
      "tool-args",
      "tool-args",
      "tool-call",
      "done",
    ]);
    expect(chunks[2]).toEqual({
      type: "tool-args",
      callId: "tooluse_1",
      name: "get_weather",
      delta: '{"city":',
    });
  });

  it("never turns a server_tool_use block into a tool call", async () => {
    const { model } = makeModel({ events: SERVER_TOOL_EVENTS });

    const chunks = await collect(
      model.stream([{ role: "user", content: "news?" }], { streamChunks: true }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual(["delta", "done"]);
  });
});

describe("BedrockModel provider-defined tools", () => {
  it("appends a systemTool definition after the function tool specs", async () => {
    const { model, calls } = makeModel({ events: SERVER_TOOL_EVENTS });
    const grounding = ai.providerTool({
      provider: "bedrock",
      definition: { systemTool: { name: "nova_grounding" } },
    });
    const lookup = ai.tool({ name: "lookup", description: "Lookup", execute: async () => ({}) });

    await collect(
      model.stream([{ role: "user", content: "news?" }], { tools: [lookup, grounding] }),
    );

    expect(grounding.name).toBe("nova_grounding");
    expect(calls[0]?.toolConfig).toEqual({
      tools: [
        { toolSpec: expect.objectContaining({ name: "lookup" }) },
        { systemTool: { name: "nova_grounding" } },
      ],
    });
  });

  it("drops server_tool_use blocks from complete() tool calls", async () => {
    const { model } = makeModel({
      converse: {
        output: {
          message: {
            role: "assistant",
            content: [
              {
                toolUse: {
                  toolUseId: "srv_1",
                  name: "nova_grounding",
                  input: {},
                  type: "server_tool_use",
                },
              },
              { text: "News." },
            ],
          },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      } as unknown as Partial<ConverseResponse>,
    });

    const response = await model.complete([{ role: "user", content: "news?" }]);

    expect(response.toolCalls).toBeUndefined();
    expect(response.content).toBe("News.");
  });

  it("skips an openai definition with a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const { model, calls } = makeModel({ events: SERVER_TOOL_EVENTS });

    await collect(
      model.stream([{ role: "user", content: "x" }], {
        providerTools: [{ provider: "openai", definition: { type: "web_search" } }],
      }),
    );

    expect(calls[0]?.toolConfig).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "ai.bedrock",
      "providerTool.skipped",
      expect.any(String),
      expect.objectContaining({ provider: "openai" }),
    );
  });
});
