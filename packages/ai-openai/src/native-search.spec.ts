import type OpenAI from "openai";
import { ai, type ModelStreamChunk } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { OpenAIModel } from "./model";
import { OpenAISDK } from "./sdk";
import { OpenAIResponsesModel } from "./responses-model";
import { OPENAI_SERVER_TOOL_PRICING } from "./known-pricing";

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

function compatible(provider: string) {
  const calls: Array<Record<string, unknown>> = [];
  const create = async (body: Record<string, unknown>) => {
    calls.push(body);
    return body.stream
      ? (async function* () {
          yield { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] };
        })()
      : { choices: [{ message: { content: "answer" }, finish_reason: "stop" }] };
  };
  return {
    model: new OpenAIModel(
      { chat: { completions: { create } } } as unknown as OpenAI,
      { name: "test-model", reasoning: false },
      provider,
    ),
    calls,
  };
}

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

describe("hosted web_search on the direct OpenAI provider", () => {
  const search = ai.providerTool({ provider: "openai", definition: { type: "web_search" } });

  function sdkWithFetch() {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith("/responses")
            ? {
                id: "r",
                object: "response",
                status: "completed",
                output: [
                  hosted,
                  {
                    type: "message",
                    id: "m",
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "answer", annotations: [] }],
                  },
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              }
            : {
                id: "c",
                object: "chat.completion",
                created: 0,
                model: "gpt-4.1",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "chat" },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              },
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    return { sdk: new OpenAISDK({ apiKey: "k", fetch }), requests, fetch };
  }

  it("routes a call carrying web_search to POST /responses without changing the model", async () => {
    const { sdk, requests } = sdkWithFetch();
    const model = sdk.model({ name: "gpt-4.1" });
    const response = await model.complete(messages, { tools: [search] });

    expect(response.content).toBe("answer");
    expect(response.usage.serverToolUse).toEqual({ webSearchRequests: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(/\/responses$/u);
    expect(requests[0]?.body.tools).toEqual([{ type: "web_search" }]);
  });

  it("keeps ordinary calls on Chat Completions", async () => {
    const { sdk, requests } = sdkWithFetch();
    const response = await sdk.model({ name: "gpt-4.1" }).complete(messages);

    expect(response.content).toBe("chat");
    expect(requests[0]?.url).toMatch(/\/chat\/completions$/u);
  });

  it("throws a clear error, before transport, when the model is pinned to api: chat", async () => {
    const { sdk, fetch } = sdkWithFetch();
    const model = sdk.model({ name: "gpt-4.1", api: "chat" });

    await expect(model.complete(messages, { tools: [search] })).rejects.toThrow(
      'pinned to api: "chat"',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["gpt-4.1-nano", "gpt-3.5-turbo", "o3-mini", "gpt-4-turbo"])(
    "refuses web_search on %s with a capability error and no request",
    async (name) => {
      const { sdk, fetch } = sdkWithFetch();
      const model = sdk.model({ name });

      await expect(model.complete(messages, { tools: [search] })).rejects.toThrow(
        "not available on",
      );
      await expect(async () => {
        for await (const chunk of model.stream(messages, { tools: [search] })) void chunk;
      }).rejects.toThrow("not available on");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("refuses web_search on gpt-5 with minimal reasoning only", async () => {
    const { sdk, fetch } = sdkWithFetch();
    const model = sdk.model({ name: "gpt-5" });

    await expect(
      model.complete(messages, { tools: [search], reasoning: { effort: "minimal" } }),
    ).rejects.toThrow("minimal reasoning");
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      model.complete(messages, { tools: [search], reasoning: { effort: "low" } }),
    ).resolves.toMatchObject({ content: "answer" });
  });
});
