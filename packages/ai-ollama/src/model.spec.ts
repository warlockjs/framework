import type { ToolConfig } from "@warlock.js/ai";
import type { ChatRequest, ChatResponse, Ollama } from "ollama";
import { describe, expect, it } from "vitest";
import { OllamaModel } from "./model";

function makeFakeClient(options: {
  response?: Partial<ChatResponse>;
  streamChunks?: Array<Partial<ChatResponse>>;
  throws?: unknown;
}) {
  const calls: ChatRequest[] = [];
  let aborted = false;

  const chat = async (request: ChatRequest) => {
    calls.push(request);

    if (options.throws) {
      throw options.throws;
    }

    if (request.stream) {
      return {
        abort: () => {
          aborted = true;
        },
        async *[Symbol.asyncIterator]() {
          for (const chunk of options.streamChunks ?? []) {
            yield chunk as ChatResponse;
          }
        },
      };
    }

    return options.response as ChatResponse;
  };

  const client = { chat } as unknown as Ollama;

  return { client, calls, wasAborted: () => aborted };
}

const baseResponse: Partial<ChatResponse> = {
  message: { role: "assistant", content: "hello" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 5,
  eval_count: 3,
};

describe("OllamaModel.complete()", () => {
  it("forwards model, messages, and inference options", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, {
      name: "llama3.1",
      temperature: 0.4,
      maxTokens: 256,
    });

    await model.complete([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hi" },
    ]);

    expect(calls[0].model).toBe("llama3.1");
    expect(calls[0].messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hi" },
    ]);
    expect(calls[0].options).toEqual({ temperature: 0.4, num_predict: 256 });
    expect(calls[0].stream).toBe(false);
  });

  it("omits options when none set; per-call overrides config", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }]);
    expect(calls[0].options).toBeUndefined();

    await model.complete([{ role: "user", content: "hi" }], { maxTokens: 64, temperature: 0.9 });
    expect(calls[1].options).toEqual({ temperature: 0.9, num_predict: 64 });
  });

  it("normalizes a text response into ModelResponse shape", async () => {
    const { client } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      content: "hello",
      finishReason: "stop",
      usage: { input: 5, output: 3, total: 8 },
      toolCalls: undefined,
    });
  });

  it("extracts tool calls (synthesized id = name) and finishes as tool_calls", async () => {
    const { client } = makeFakeClient({
      response: {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "getWeather", arguments: { city: "Cairo" } } }],
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 1,
        eval_count: 1,
      },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "getWeather", name: "getWeather", input: { city: "Cairo" } },
    ]);
  });

  it("emits native format for an object schema; omits otherwise", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });

    const model = new OllamaModel(client, { name: "llama3.1" });
    const schema = { type: "object", properties: { summary: { type: "string" } } };
    await model.complete([{ role: "user", content: "hi" }], { responseSchema: schema });
    expect(calls[0].format).toEqual(schema);

    await model.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "array" },
    });
    expect(calls[1].format).toBeUndefined();

    const noStruct = new OllamaModel(client, { name: "llama3.1", structuredOutput: false });
    await noStruct.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "object", properties: {} },
    });
    expect(calls[2].format).toBeUndefined();
  });

  it("rethrows a wrapped typed error on failure", async () => {
    const { client } = makeFakeClient({
      throws: { name: "ResponseError", status_code: 404, message: "model not found" },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await expect(model.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "PROVIDER_INVALID_REQUEST",
    });
  });

  it("forwards mapped tools on the request", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }], {
      tools: [
        {
          name: "getWeather",
          description: "weather lookup",
          input: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: (value: unknown) => ({ value }),
              jsonSchema: {
                input: () => ({ type: "object", properties: { city: { type: "string" } } }),
              },
            },
          } as unknown as ToolConfig<unknown, unknown>["input"],
          execute: async (value: unknown) => value,
        },
      ],
    });

    expect(calls[0].tools).toEqual([
      {
        type: "function",
        function: {
          name: "getWeather",
          description: "weather lookup",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ]);
  });

  it("omits tools when none are supplied", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0].tools).toBeUndefined();
  });

  it("includes a zero temperature / maxTokens in options (0 is not 'unset')", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1", temperature: 0, maxTokens: 0 });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0].options).toEqual({ temperature: 0, num_predict: 0 });
  });

  it("maps a 'length' done reason to 'length'", async () => {
    const { client } = makeFakeClient({
      response: { ...baseResponse, done_reason: "length" },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("length");
  });

  it("maps an unknown / load done reason to 'error'", async () => {
    const { client } = makeFakeClient({
      response: { ...baseResponse, done_reason: "load" },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    expect((await model.complete([{ role: "user", content: "hi" }])).finishReason).toBe("error");
  });

  it("defaults content to '' and usage to zero when the response is sparse", async () => {
    const { client } = makeFakeClient({
      response: { done: true, done_reason: "stop" } as Partial<ChatResponse>,
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.content).toBe("");
    expect(result.usage).toEqual({ input: 0, output: 0, total: 0 });
    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toBeUndefined();
  });

  it("extracts multiple tool calls and defaults missing arguments to {}", async () => {
    const { client } = makeFakeClient({
      response: {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "getWeather", arguments: { city: "Cairo" } } },
            { function: { name: "noArgs" } as { name: string; arguments: Record<string, never> } },
          ],
        },
        done: true,
        done_reason: "stop",
      },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "getWeather", name: "getWeather", input: { city: "Cairo" } },
      { id: "noArgs", name: "noArgs", input: {} },
    ]);
  });

  it("treats an empty tool_calls array as no tool calls", async () => {
    const { client } = makeFakeClient({
      response: {
        message: { role: "assistant", content: "plain", tool_calls: [] },
        done: true,
        done_reason: "stop",
      },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toBeUndefined();
  });

  it("omits native format when type is object but properties is not an object", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "object", properties: "nope" as unknown as Record<string, unknown> },
    });

    expect(calls[0].format).toBeUndefined();
  });

  it("omits native format when no responseSchema is supplied", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0].format).toBeUndefined();
  });

  it("maps a daemon-down connection error to ProviderError", async () => {
    const { client } = makeFakeClient({
      throws: { name: "TypeError", message: "fetch failed", cause: { code: "ECONNREFUSED" } },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await expect(model.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});

describe("OllamaModel capabilities (cost-truth)", () => {
  it("reports promptCaching / audio / pdf as false (Ollama supports none)", () => {
    const { client } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    expect(model.capabilities.promptCaching).toBe(false);
    expect(model.capabilities.audio).toBe(false);
    expect(model.capabilities.pdf).toBe(false);
  });

  it("infers reasoning=true for thinking families, false otherwise", () => {
    const { client } = makeFakeClient({ response: baseResponse });

    expect(new OllamaModel(client, { name: "deepseek-r1:7b" }).capabilities.reasoning).toBe(true);
    expect(new OllamaModel(client, { name: "qwq:32b" }).capabilities.reasoning).toBe(true);
    expect(new OllamaModel(client, { name: "llama3.1" }).capabilities.reasoning).toBe(false);
  });

  it("honors an explicit reasoning override over inference", () => {
    const { client } = makeFakeClient({ response: baseResponse });

    expect(
      new OllamaModel(client, { name: "llama3.1", reasoning: true }).capabilities.reasoning,
    ).toBe(true);
    expect(
      new OllamaModel(client, { name: "deepseek-r1:7b", reasoning: false }).capabilities.reasoning,
    ).toBe(false);
  });
});

describe("OllamaModel reasoning → think mapping", () => {
  it("maps reasoning.effort to Ollama's think literal on a reasoning model", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "high" } });

    expect(calls[0].think).toBe("high");
  });

  it("maps an effort-less reasoning hint to think: true", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    // maxTokens (thinking budget) has no Ollama equivalent — only the
    // on/off signal survives.
    await model.complete([{ role: "user", content: "hi" }], { reasoning: { maxTokens: 2048 } });

    expect(calls[0].think).toBe(true);
  });

  it("maps effort 'none' to think: false (explicit reasoning-off)", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "none" },
    });

    expect(calls[0].think).toBe(false);
  });

  it("does not send think to a non-reasoning model even when reasoning is requested", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "high" } });

    expect(calls[0].think).toBeUndefined();
  });

  it("omits think when no reasoning option is supplied", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0].think).toBeUndefined();
  });

  it("treats cacheControl as a no-op (Ollama has no prompt cache)", async () => {
    const { client, calls } = makeFakeClient({ response: baseResponse });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    await model.complete([{ role: "user", content: "hi" }], {
      cacheControl: { breakpoints: 2 },
    });

    // No native field is added and usage carries no cache accounting.
    expect((calls[0] as unknown as Record<string, unknown>).cache_control).toBeUndefined();
  });

  it("never reports cachedTokens / reasoningTokens (no provider counts)", async () => {
    const { client } = makeFakeClient({
      response: {
        message: { role: "assistant", content: "answer", thinking: "let me think..." },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 20,
      },
    });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.usage).toEqual({ input: 10, output: 20, total: 30 });
    expect(result.usage.cachedTokens).toBeUndefined();
    expect(result.usage.reasoningTokens).toBeUndefined();
  });
});

describe("OllamaModel.stream()", () => {
  it("yields content deltas then a terminal done with mapped finish + usage", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "Hel" } },
        { message: { role: "assistant", content: "lo" } },
        {
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 9,
          eval_count: 4,
        },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const types: string[] = [];
    let done: { finishReason: string; usage: unknown } | undefined;

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      types.push(event.type);

      if (event.type === "done") {
        done = { finishReason: event.finishReason, usage: event.usage };
      }
    }

    expect(types).toEqual(["delta", "delta", "done"]);
    expect(done).toEqual({ finishReason: "stop", usage: { input: 9, output: 4, total: 13 } });
  });

  it("emits a tool-call chunk and finishes as tool_calls", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "getWeather", arguments: { city: "Cairo" } } }],
          },
        },
        {
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 2,
          eval_count: 7,
        },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "tool-call") {
        toolCalls.push({ id: event.id, name: event.name, input: event.input });
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(toolCalls).toEqual([{ id: "getWeather", name: "getWeather", input: { city: "Cairo" } }]);
    expect(finishReason).toBe("tool_calls");
  });

  it("aborts the stream when an already-aborted signal is supplied", async () => {
    const { client, wasAborted } = makeFakeClient({
      streamChunks: [{ message: { role: "assistant", content: "x" }, done: true, done_reason: "stop" }],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });
    const controller = new AbortController();
    controller.abort();

    for await (const _event of model.stream([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    })) {
      void _event;
    }

    expect(wasAborted()).toBe(true);
  });

  it("rethrows a wrapped typed error when the stream request fails", async () => {
    const { client } = makeFakeClient({
      throws: { name: "ResponseError", status_code: 403, message: "denied" },
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    await expect(async () => {
      for await (const _event of model.stream([{ role: "user", content: "hi" }])) {
        void _event;
      }
    }).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });

  it("forwards model, messages, tools, options, and format on the stream request", async () => {
    const { client, calls } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "x" }, done: true, done_reason: "stop" },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1", temperature: 0.3 });

    for await (const _event of model.stream(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      {
        maxTokens: 128,
        responseSchema: { type: "object", properties: { a: { type: "string" } } },
      },
    )) {
      void _event;
    }

    expect(calls[0].model).toBe("llama3.1");
    expect(calls[0].messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
    expect(calls[0].options).toEqual({ temperature: 0.3, num_predict: 128 });
    expect(calls[0].format).toEqual({ type: "object", properties: { a: { type: "string" } } });
    expect(calls[0].stream).toBe(true);
  });

  it("forwards the think flag on the stream request for a reasoning model", async () => {
    const { client, calls } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "x" }, done: true, done_reason: "stop" },
      ],
    });
    const model = new OllamaModel(client, { name: "deepseek-r1:7b" });

    for await (const _event of model.stream([{ role: "user", content: "hi" }], {
      reasoning: { effort: "low" },
    })) {
      void _event;
    }

    expect(calls[0].think).toBe("low");
  });

  it("does not emit a delta for empty / missing content chunks", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "" } },
        { message: { role: "assistant" } as ChatResponse["message"] },
        { message: { role: "assistant", content: "real" } },
        { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const deltas: string[] = [];

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "delta") {
        deltas.push(event.content);
      }
    }

    expect(deltas).toEqual(["real"]);
  });

  it("maps a 'length' stream done reason and defaults absent usage to zero", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "cut" } },
        { message: { role: "assistant", content: "" }, done: true, done_reason: "length" },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    let done: { finishReason: string; usage: unknown } | undefined;

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        done = { finishReason: event.finishReason, usage: event.usage };
      }
    }

    expect(done).toEqual({ finishReason: "length", usage: { input: 0, output: 0, total: 0 } });
  });

  it("maps an unknown stream done reason to 'error'", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        { message: { role: "assistant", content: "x" }, done: true, done_reason: "load" },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(finishReason).toBe("error");
  });

  it("emits multiple tool-call chunks within a single stream", async () => {
    const { client } = makeFakeClient({
      streamChunks: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "a", arguments: { x: 1 } } },
              { function: { name: "b" } as { name: string; arguments: Record<string, never> } },
            ],
          },
        },
        { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
      ],
    });
    const model = new OllamaModel(client, { name: "llama3.1" });

    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "tool-call") {
        toolCalls.push({ id: event.id, name: event.name, input: event.input });
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(toolCalls).toEqual([
      { id: "a", name: "a", input: { x: 1 } },
      { id: "b", name: "b", input: {} },
    ]);
    expect(finishReason).toBe("tool_calls");
  });

  it("aborts the stream when a later-arriving abort fires mid-iteration", async () => {
    const controller = new AbortController();
    let aborted = false;

    const chat = async (request: ChatRequest) => {
      void request;

      return {
        abort: () => {
          aborted = true;
        },
        async *[Symbol.asyncIterator]() {
          yield { message: { role: "assistant", content: "one" } } as ChatResponse;
          // Listener is registered by now; fire the abort before the next chunk.
          controller.abort();
          yield {
            message: { role: "assistant", content: "" },
            done: true,
            done_reason: "stop",
          } as ChatResponse;
        },
      };
    };
    const client = { chat } as unknown as Ollama;
    const model = new OllamaModel(client, { name: "llama3.1" });

    for await (const _event of model.stream([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    })) {
      void _event;
    }

    expect(aborted).toBe(true);
  });

  it("wraps an error thrown mid-iteration into a typed AIError", async () => {
    const chat = async (request: ChatRequest) => {
      void request;

      return {
        abort: () => {},
        async *[Symbol.asyncIterator]() {
          yield { message: { role: "assistant", content: "partial" } } as ChatResponse;

          throw { name: "ResponseError", status_code: 429, message: "slow down" };
        },
      };
    };
    const client = { chat } as unknown as Ollama;
    const model = new OllamaModel(client, { name: "llama3.1" });

    await expect(async () => {
      for await (const _event of model.stream([{ role: "user", content: "hi" }])) {
        void _event;
      }
    }).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
  });
});
