import { ai, type ModelStreamChunk } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIModel } from "./model";
import { OpenAIResponsesModel } from "./responses-model";

type Body = Record<string, unknown> & { tools?: Array<Record<string, unknown>> };

async function collect(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

function chatClient(chunks: unknown[]) {
  const calls: Body[] = [];
  const create = async (params: Body) => {
    calls.push(params);

    if (params.stream === true) {
      return (async function* () {
        yield* chunks;
      })();
    }

    return {
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  };

  return { client: { chat: { completions: { create } } } as unknown as OpenAI, calls };
}

function responsesClient(events: unknown[]) {
  const calls: Body[] = [];
  const create = async (params: Body) => {
    calls.push(params);

    return (async function* () {
      yield* events;
    })();
  };

  return { client: { responses: { create } } as unknown as OpenAI, calls };
}

/**
 * Recorded-style Chat Completions stream from an OpenAI-compatible vendor
 * that streams `reasoning_content` (DeepSeek's documented delta field) and a
 * tool call whose arguments arrive in fragments (first fragment carries the
 * id and name, later ones only `index`).
 */
const CHAT_STREAM = [
  { choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Need the " } }] },
  { choices: [{ index: 0, delta: { reasoning_content: "weather." } }] },
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: "" },
            },
          ],
        },
      },
    ],
  },
  {
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } },
    ],
  },
  {
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Cairo"}' } }] } },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
];

/**
 * Recorded-style Responses stream (event names and fields from the OpenAI
 * SDK's `ResponseStreamEvent` union): a reasoning summary, then a function
 * call whose arguments stream by `item_id`.
 */
const RESPONSES_STREAM = [
  {
    type: "response.output_item.added",
    output_index: 0,
    sequence_number: 1,
    item: { type: "reasoning", id: "rs_1", summary: [] },
  },
  {
    type: "response.reasoning_summary_text.delta",
    item_id: "rs_1",
    output_index: 0,
    summary_index: 0,
    sequence_number: 2,
    delta: "Looking up ",
  },
  {
    type: "response.reasoning_summary_text.delta",
    item_id: "rs_1",
    output_index: 0,
    summary_index: 0,
    sequence_number: 3,
    delta: "the weather.",
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    sequence_number: 4,
    item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc_1" },
  },
  {
    type: "response.output_item.added",
    output_index: 1,
    sequence_number: 5,
    item: {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_weather",
      arguments: "",
      status: "in_progress",
    },
  },
  {
    type: "response.function_call_arguments.delta",
    item_id: "fc_1",
    output_index: 1,
    sequence_number: 6,
    delta: '{"city":',
  },
  {
    type: "response.function_call_arguments.delta",
    item_id: "fc_1",
    output_index: 1,
    sequence_number: 7,
    delta: '"Cairo"}',
  },
  {
    type: "response.output_item.done",
    output_index: 1,
    sequence_number: 8,
    item: {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"Cairo"}',
      status: "completed",
    },
  },
  {
    type: "response.completed",
    sequence_number: 9,
    response: {
      status: "completed",
      incomplete_details: null,
      output: [],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAIModel (Chat Completions) optional stream chunks", () => {
  it("keeps the old sequence without opt-in", async () => {
    const { client } = chatClient(CHAT_STREAM);
    const model = new OpenAIModel(client, { name: "deepseek-reasoner" }, "deepseek");

    const chunks = await collect(model.stream([{ role: "user", content: "weather?" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["tool-call", "done"]);
  });

  it("maps reasoning_content and tool_call argument fragments", async () => {
    const { client } = chatClient(CHAT_STREAM);
    const model = new OpenAIModel(client, { name: "deepseek-reasoner" }, "deepseek");

    const chunks = await collect(
      model.stream([{ role: "user", content: "weather?" }], { streamChunks: true }),
    );

    expect(chunks.filter((chunk) => chunk.type === "reasoning")).toEqual([
      { type: "reasoning", delta: "Need the " },
      { type: "reasoning", delta: "weather." },
    ]);
    expect(chunks.filter((chunk) => chunk.type === "tool-args")).toEqual([
      { type: "tool-args", callId: "call_1", name: "get_weather", delta: '{"city":' },
      { type: "tool-args", callId: "call_1", name: "get_weather", delta: '"Cairo"}' },
    ]);
    expect(chunks.some((chunk) => chunk.type === "usage")).toBe(false);
    expect(chunks.find((chunk) => chunk.type === "tool-call")).toMatchObject({
      id: "call_1",
      input: { city: "Cairo" },
    });
  });
});

describe("OpenAIResponsesModel optional stream chunks", () => {
  it("maps reasoning summary deltas and function_call_arguments deltas", async () => {
    const { client } = responsesClient(RESPONSES_STREAM);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });

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
      callId: "call_1",
      name: "get_weather",
      delta: '{"city":',
    });
  });

  it("emits none of them without opt-in", async () => {
    const { client } = responsesClient(RESPONSES_STREAM);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });

    const chunks = await collect(model.stream([{ role: "user", content: "weather?" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["tool-call", "done"]);
  });
});

describe("OpenAI provider-defined tools", () => {
  const weatherTool = ai.tool({
    name: "get_weather",
    description: "Weather",
    execute: async () => ({}),
  });

  it("appends openai definitions verbatim to a Responses request", async () => {
    const { client, calls } = responsesClient(RESPONSES_STREAM);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });
    const webSearch = ai.providerTool({ provider: "openai", definition: { type: "web_search" } });

    await collect(
      model.stream([{ role: "user", content: "news" }], { tools: [weatherTool, webSearch] }),
    );

    expect(calls[0]?.tools).toEqual([
      expect.objectContaining({ type: "function", name: "get_weather" }),
      { type: "web_search" },
    ]);
  });

  it("skips another provider's definition on Responses with a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const { client, calls } = responsesClient(RESPONSES_STREAM);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });

    await collect(
      model.stream([{ role: "user", content: "news" }], {
        providerTools: [{ provider: "anthropic", definition: { type: "web_search_20250305" } }],
      }),
    );

    expect(Object.keys(calls[0] ?? {})).not.toContain("tools");
    expect(warn).toHaveBeenCalledWith(
      "ai.openai",
      "providerTool.skipped",
      expect.stringContaining("anthropic"),
      expect.objectContaining({ provider: "anthropic" }),
    );
  });

  it("sends a Chat Completions definition only to the matching provider label", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const browserSearch = { provider: "groq", definition: { type: "browser_search" } };
    const groq = chatClient([]);
    const openai = chatClient([]);

    await new OpenAIModel(groq.client, { name: "openai/gpt-oss-120b" }, "groq").complete(
      [{ role: "user", content: "x" }],
      { providerTools: [browserSearch] },
    );
    await new OpenAIModel(openai.client, { name: "gpt-4o" }).complete(
      [{ role: "user", content: "x" }],
      { providerTools: [browserSearch] },
    );

    expect(groq.calls[0]?.tools).toEqual([{ type: "browser_search" }]);
    expect(Object.keys(openai.calls[0] ?? {})).not.toContain("tools");
  });

  it("does not replay a reasoning item that led into a hosted tool call", async () => {
    const events = [
      {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: 1,
        item: { type: "reasoning", id: "rs_a", summary: [], encrypted_content: "enc_a" },
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        sequence_number: 2,
        item: {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { type: "search", query: "x" },
        },
      },
      {
        type: "response.output_item.done",
        output_index: 2,
        sequence_number: 3,
        item: { type: "reasoning", id: "rs_b", summary: [], encrypted_content: "enc_b" },
      },
      {
        type: "response.output_item.done",
        output_index: 3,
        sequence_number: 4,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "get_weather",
          arguments: "{}",
          status: "completed",
        },
      },
      RESPONSES_STREAM.at(-1),
    ];
    const { client } = responsesClient(events);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });

    const chunks = await collect(model.stream([{ role: "user", content: "x" }]));
    const call = chunks.find((chunk) => chunk.type === "tool-call");
    const stored = call?.type === "tool-call" ? call.providerMetadata?.openaiResponses : undefined;

    expect(stored).toMatchObject({ reasoningItems: [{ id: "rs_b" }] });
  });

  it("fails closed when the model emits a built-in call the caller would have to run", async () => {
    const { client } = responsesClient([
      {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: 1,
        item: { type: "shell_call", id: "sh_1", call_id: "call_sh", status: "completed" },
      },
      RESPONSES_STREAM.at(-1),
    ]);
    const model = new OpenAIResponsesModel(client, { name: "gpt-5.6", api: "responses" });
    vi.spyOn(log, "error").mockImplementation(() => Promise.resolve() as never);

    await expect(collect(model.stream([{ role: "user", content: "x" }]))).rejects.toThrow(
      /"shell_call" item/,
    );
  });
});
