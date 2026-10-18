import type OpenAI from "openai";
import { ai, type ModelStreamChunk } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { OpenAIModel } from "./model";
import { OpenAIResponsesModel } from "./responses-model";
import { moonshotSearchCall } from "./utils/moonshot-search";
import { OPENAI_SERVER_TOOL_PRICING } from "./known-pricing";

const incompleteKimiResponse = async () => ({
  choices: [
    {
      finish_reason: "length",
      message: {
        content: "",
        tool_calls: [
          { id: "call", type: "function", function: { name: "$web_search", arguments: "{" } },
        ],
      },
    },
  ],
});

const messages = [{ role: "user" as const, content: "search" }];
const hosted = {
  type: "web_search_call",
  id: "search_1",
  status: "completed",
  action: { type: "search", query: "news", sources: [{ type: "url", url: "https://example.com" }] },
};
const definition = { provider: "openai", definition: { type: "web_search" } };
const price = { input: 0, output: 0, serverTools: OPENAI_SERVER_TOOL_PRICING };
function responsesModel(streaming: boolean) {
  const response = {
    status: "completed",
    output: [hosted],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  const create = vi.fn(async (_params: Record<string, unknown>) =>
    streaming
      ? (async function* () {
          yield { type: "response.output_item.done", item: hosted };
          yield { type: "response.completed", response };
        })()
      : response,
  );
  return {
    model: new OpenAIResponsesModel({ responses: { create } } as unknown as OpenAI, {
      name: "gpt-4.1",
      pricing: price,
    }),
    create,
  };
}

function compatible(provider: string, repeat = false, mixed = false) {
  const argumentsText = '{ "query" : "news", "usage": {"total_tokens":3} }';
  const calls: Array<Record<string, unknown>> = [];
  const clientCall = {
    id: "client_1",
    type: "function",
    function: { name: "local", arguments: "{}" },
  };
  const searchCall = {
    id: "hosted_1",
    type: "function",
    function: { name: "$web_search", arguments: argumentsText },
  };
  const create = async (body: Record<string, unknown>) => {
    calls.push(body);
    const searching = repeat || calls.length === 1;
    const toolCalls = searching ? [searchCall, ...(mixed ? [clientCall] : [])] : undefined;
    if (body.stream)
      return (async function* () {
        for (const [index, call] of (toolCalls ?? []).entries()) {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index,
                      id: call.id,
                      function: {
                        name: call.function.name,
                        arguments: call.function.arguments.slice(0, 10),
                      },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index, function: { arguments: call.function.arguments.slice(10) } },
                  ],
                },
              },
            ],
          };
        }
        yield {
          choices: [
            {
              delta: { content: searching ? "" : "answer" },
              finish_reason: searching ? "tool_calls" : "stop",
            },
          ],
        };
      })();
    return {
      choices: [
        {
          message: { content: searching ? "" : "answer", tool_calls: toolCalls },
          finish_reason: searching ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  };
  return {
    model: new OpenAIModel(
      { chat: { completions: { create } } } as unknown as OpenAI,
      { name: "test-model", reasoning: false },
      provider,
    ),
    calls,
    argumentsText,
  };
}

const search = (execute?: () => Promise<unknown>) =>
  ai.providerTool({
    provider: "moonshot",
    name: "$web_search",
    ...(execute ? { execute } : {}),
    definition: { type: "builtin_function", function: { name: "$web_search" } },
  });

describe("Responses hosted output", () => {
  it("counts hosted output items, preserves actions/sources and requests sources", async () => {
    const { model, create } = responsesModel(false);
    const response = await model.complete(messages, { providerTools: [definition] });
    expect(response.usage.serverToolUse).toEqual({ webSearchRequests: 1 });
    expect(response.usage.cost?.serverTools?.webSearch).toBe(0.01);
    expect(response.providerMetadata).toEqual({ openai: { output: [hosted] } });
    expect(response.toolCalls).toBeUndefined();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      include: ["reasoning.encrypted_content", "web_search_call.action.sources"],
    });
  });

  it("does not count the same item from events and the terminal snapshot twice", async () => {
    const { model } = responsesModel(true);
    const chunks: ModelStreamChunk[] = [];
    for await (const chunk of model.stream(messages, { providerTools: [definition] }))
      chunks.push(chunk);
    const done = chunks.find((chunk) => chunk.type === "done");
    expect(done?.usage.serverToolUse?.webSearchRequests).toBe(1);
    expect(done?.providerMetadata).toEqual({ openai: { output: [hosted] } });
    expect(chunks.some((chunk) => chunk.type === "tool-call")).toBe(false);
  });
});

describe("compatible native-search controls", () => {
  it.each(["qwen", "dashscope"])(
    "maps the %s option to a top-level request flag in both modes",
    async (provider) => {
      const { model, calls } = compatible(provider);
      const options = { providerOptions: { [provider]: { enableSearch: true } } };
      await model.complete(messages, options);
      for await (const chunk of model.stream(messages, options)) {
        void chunk;
      }
      expect(calls.map((call) => call.enable_search)).toEqual([true, true]);
      expect(calls.every((call) => call.tools === undefined)).toBe(true);
    },
  );

  it("does not send Qwen flags to other providers", async () => {
    const { model, calls } = compatible("openai");
    await model.complete(messages, { providerOptions: { qwen: { enableSearch: true } } });
    expect(calls[0]?.enable_search).toBeUndefined();
  });

  it("echoes Kimi arguments verbatim in the next trip without invoking application handlers", async () => {
    const { model, calls, argumentsText } = compatible("moonshot", false, true);
    const local = vi.fn(async () => "local result");
    const hostedHandler = vi.fn(async () => "should not run");
    const result = await ai
      .agent({
        model,
        maxTrips: 3,
        tools: [
          search(hostedHandler),
          ai.tool({ name: "local", description: "local tool", execute: local }),
        ],
      })
      .execute("search");
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("answer");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", tool_call_id: "hosted_1", content: argumentsText }),
        expect.objectContaining({
          role: "assistant",
          tool_calls: expect.arrayContaining([
            expect.objectContaining({
              function: { name: "$web_search", arguments: argumentsText },
            }),
          ]),
        }),
      ]),
    );
    expect(hostedHandler).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledOnce();
    expect(result.usage.serverToolUse).toBeUndefined();
  });

  it("continues streamed Kimi calls and keeps them outside tool-call chunks", async () => {
    const { model, calls, argumentsText } = compatible("moonshot");
    const assistant = ai.agent({ model, maxTrips: 3, tools: [search()] });
    const stream = assistant.stream("search");
    for await (const event of stream) {
      void event;
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", content: argumentsText })]),
    );
    const { model: direct } = compatible("moonshot");
    const chunks = [];
    for await (const chunk of direct.stream(messages, {
      providerTools: [search()],
      streamChunks: true,
    }))
      chunks.push(chunk);
    expect(chunks.some((chunk) => chunk.type === "tool-call" || chunk.type === "tool-args")).toBe(
      false,
    );
  });

  it("bounds Kimi continuation by maxTrips", async () => {
    const { model, calls } = compatible("moonshot", true);
    const result = await ai.agent({ model, maxTrips: 2, tools: [search()] }).execute("search");
    expect(calls).toHaveLength(2);
    expect(result.error).toBeDefined();
  });
});

describe("native-search edge cases", () => {
  it("retains streamed hosted metadata and costs on agent trips", async () => {
    const { model } = responsesModel(true);
    const stream = ai.agent({ model, tools: [ai.providerTool(definition)] }).stream("search");
    for await (const event of stream) void event;
    const result = await stream.result;
    expect(result.report.trips[0]?.providerMetadata).toEqual({ openai: { output: [hosted] } });
    expect(result.usage.serverToolUse?.webSearchRequests).toBe(1);
    expect(result.usage.cost?.serverTools?.webSearch).toBe(0.01);
  });

  it("rejects invalid Kimi JSON instead of echoing fabricated arguments", () => {
    expect(() => moonshotSearchCall("call", "$web_search", "{")).toThrow("invalid JSON");
  });

  it("does not echo an incomplete Kimi call", async () => {
    const model = new OpenAIModel(
      { chat: { completions: { create: incompleteKimiResponse } } } as unknown as OpenAI,
      { name: "test-model" },
      "moonshot",
    );
    const response = await model.complete(messages, { providerTools: [search()] });
    expect(response.finishReason).toBe("length");
    expect(response.serverToolCalls).toBeUndefined();
    expect(response.toolCalls).toBeUndefined();
  });

  it("bounds streamed Kimi continuation by maxTrips", async () => {
    const { model, calls } = compatible("moonshot", true);
    const stream = ai.agent({ model, maxTrips: 2, tools: [search()] }).stream("search");
    for await (const event of stream) void event;
    expect(calls).toHaveLength(2);
    expect((await stream.result).error).toBeDefined();
  });

  it("preserves an explicit false Qwen flag and rejects malformed flags", async () => {
    const { model, calls } = compatible("qwen");
    await model.complete(messages, { providerOptions: { qwen: { enableSearch: false } } });
    expect(calls[0]?.enable_search).toBe(false);
    await expect(
      model.complete(messages, { providerOptions: { qwen: { enableSearch: "yes" } } }),
    ).rejects.toThrow("boolean");
    expect(calls).toHaveLength(1);
  });
});
