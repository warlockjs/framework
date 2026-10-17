import type Anthropic from "@anthropic-ai/sdk";
import type { ModelStreamChunk } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { AnthropicModel } from "./model";

/**
 * Recorded-style Messages API stream: adaptive thinking, a text answer and
 * a client `tool_use` whose input streams as `input_json_delta`s. Event
 * shapes follow the Anthropic streaming docs (`thinking_delta`,
 * `signature_delta`, `input_json_delta`, cumulative `message_delta.usage`).
 */
const THINKING_AND_TOOL_STREAM = [
  {
    type: "message_start",
    message: { usage: { input_tokens: 120, output_tokens: 1 } },
  },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "", signature: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "The user wants " },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "the weather." },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "EqQBCg" },
  },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking." } },
  { type: "content_block_stop", index: 1 },
  {
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "toolu_01", name: "get_weather", input: {} },
  },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "" } },
  {
    type: "content_block_delta",
    index: 2,
    delta: { type: "input_json_delta", partial_json: '{"location":' },
  },
  {
    type: "content_block_delta",
    index: 2,
    delta: { type: "input_json_delta", partial_json: ' "Cairo"}' },
  },
  { type: "content_block_stop", index: 2 },
  {
    type: "message_delta",
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { output_tokens: 89 },
  },
  { type: "message_stop" },
] as unknown as Anthropic.RawMessageStreamEvent[];

/**
 * Recorded-style server tool stream (Anthropic streaming docs, web search
 * example): the `server_tool_use` input streams as `input_json_delta` but is
 * run by Anthropic, so it must never surface as a `tool-args` chunk.
 */
const SERVER_TOOL_STREAM = [
  { type: "message_start", message: { usage: { input_tokens: 2679, output_tokens: 3 } } },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", id: "srvtoolu_014", name: "web_search", input: {} },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"query":' },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: ' "weather NYC today"}' },
  },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_014",
      content: [
        {
          type: "web_search_result",
          title: "NYC",
          url: "https://example.com",
          encrypted_content: "Ev0D",
        },
      ],
    },
  },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Sunny." } },
  { type: "content_block_stop", index: 2 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { input_tokens: 10682, output_tokens: 510, server_tool_use: { web_search_requests: 1 } },
  },
  { type: "message_stop" },
] as unknown as Anthropic.RawMessageStreamEvent[];

function makeStreamingModel(events: Anthropic.RawMessageStreamEvent[]): AnthropicModel {
  const create = async () =>
    (async function* () {
      for (const event of events) {
        yield event;
      }
    })();

  return new AnthropicModel({ messages: { create } } as unknown as Anthropic, {
    name: "claude-sonnet-4-6",
  });
}

async function collect(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

describe("AnthropicModel.stream() optional chunks", () => {
  it("keeps the delta / tool-call / done sequence when the call does not opt in", async () => {
    const model = makeStreamingModel(THINKING_AND_TOOL_STREAM);

    const chunks = await collect(model.stream([{ role: "user", content: "weather?" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["delta", "tool-call", "done"]);
  });

  it("maps thinking_delta to reasoning, input_json_delta to tool-args and usage snapshots", async () => {
    const model = makeStreamingModel(THINKING_AND_TOOL_STREAM);

    const chunks = await collect(
      model.stream([{ role: "user", content: "weather?" }], { streamChunks: true }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "usage",
      "reasoning",
      "reasoning",
      "delta",
      "tool-args",
      "tool-args",
      "tool-call",
      "usage",
      "done",
    ]);
    expect(chunks.filter((chunk) => chunk.type === "reasoning")).toEqual([
      { type: "reasoning", delta: "The user wants " },
      { type: "reasoning", delta: "the weather." },
    ]);

    const args = chunks.filter((chunk) => chunk.type === "tool-args");

    expect(args).toEqual([
      { type: "tool-args", callId: "toolu_01", name: "get_weather", delta: '{"location":' },
      { type: "tool-args", callId: "toolu_01", name: "get_weather", delta: ' "Cairo"}' },
    ]);
    expect(chunks[0]).toEqual({
      type: "usage",
      usage: { input: 120, output: 0, total: 120, inputIncludesCache: false },
    });
    expect(chunks[7]).toEqual({
      type: "usage",
      usage: { input: 120, output: 89, total: 209, inputIncludesCache: false },
    });
    expect(chunks.at(-1)).toMatchObject({
      type: "done",
      usage: { input: 120, output: 89, total: 209 },
    });
  });

  it("emits only the kinds the call picks", async () => {
    const model = makeStreamingModel(THINKING_AND_TOOL_STREAM);

    const chunks = await collect(
      model.stream([{ role: "user", content: "weather?" }], { streamChunks: { reasoning: true } }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning",
      "reasoning",
      "delta",
      "tool-call",
      "done",
    ]);
  });

  it("does not stream a server tool's input as tool-args", async () => {
    const model = makeStreamingModel(SERVER_TOOL_STREAM);

    const chunks = await collect(
      model.stream([{ role: "user", content: "weather in NYC?" }], {
        streamChunks: { toolArgs: true },
      }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual(["delta", "done"]);

    const done = chunks.at(-1);

    // The server tool blocks still round-trip on `done.blocks`.
    expect(done?.type === "done" ? done.blocks?.map((block) => block.type) : []).toEqual([
      "server_tool_use",
      "web_search_tool_result",
      "text",
    ]);
  });
});
