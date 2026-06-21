import type { ToolConfig } from "@warlock.js/ai";
import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { GoogleModel } from "./model";

function makeFakeAI(options: {
  response?: Partial<GenerateContentResponse>;
  streamChunks?: Array<Partial<GenerateContentResponse>>;
  throws?: unknown;
}) {
  const calls: Array<Record<string, unknown>> = [];

  const generateContent = async (params: Record<string, unknown>) => {
    calls.push(params);

    if (options.throws) {
      throw options.throws;
    }

    return options.response as GenerateContentResponse;
  };

  const generateContentStream = async (params: Record<string, unknown>) => {
    calls.push(params);

    if (options.throws) {
      throw options.throws;
    }

    return (async function* () {
      for (const chunk of options.streamChunks ?? []) {
        yield chunk as GenerateContentResponse;
      }
    })();
  };

  const ai = { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI;

  return { ai, calls };
}

const baseResponse: Partial<GenerateContentResponse> = {
  text: "hello",
  candidates: [{ finishReason: "STOP" as never }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
};

describe("GoogleModel capabilities", () => {
  it("reports reasoning, promptCaching, audio, and pdf truthfully for a multimodal model", () => {
    const { ai } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect(model.capabilities).toEqual({
      structuredOutput: true,
      vision: true,
      reasoning: true,
      promptCaching: true,
      audio: true,
      pdf: true,
    });
  });

  it("mirrors the (false) vision inference onto audio/pdf for a text-only model, keeping promptCaching on", () => {
    const { ai } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-1.0-pro" });

    expect(model.capabilities).toMatchObject({
      vision: false,
      audio: false,
      pdf: false,
      reasoning: true,
      promptCaching: true,
    });
  });

  it("honors explicit reasoning / audio / pdf overrides", () => {
    const { ai } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, {
      name: "gemini-2.5-flash",
      reasoning: false,
      audio: false,
      pdf: true,
    });

    expect(model.capabilities).toMatchObject({
      reasoning: false,
      audio: false,
      pdf: true,
      promptCaching: true,
    });
  });
});

describe("GoogleModel.complete()", () => {
  it("forwards model, mapped contents, system instruction, inference config", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, {
      name: "gemini-2.5-flash",
      temperature: 0.4,
      maxTokens: 256,
    });

    await model.complete([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hi" },
    ]);

    expect(calls[0].model).toBe("gemini-2.5-flash");
    expect(calls[0].contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
    expect(calls[0].config).toMatchObject({
      systemInstruction: "Be concise.",
      temperature: 0.4,
      maxOutputTokens: 256,
    });
  });

  it("normalizes a text response into ModelResponse shape", async () => {
    const { ai } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      content: "hello",
      finishReason: "stop",
      usage: { input: 5, output: 3, total: 8 },
      toolCalls: undefined,
    });
  });

  it("overrides finishReason to tool_calls and round-trips thoughtSignature", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "",
        candidates: [
          {
            finishReason: "STOP" as never,
            content: {
              role: "model",
              parts: [
                {
                  thoughtSignature: "sig-abc",
                  functionCall: { id: "fc_1", name: "getWeather", args: { city: "Cairo" } },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "fc_1",
        name: "getWeather",
        input: { city: "Cairo" },
        providerMetadata: { thoughtSignature: "sig-abc" },
      },
    ]);
  });

  it("surfaces thoughtsTokenCount as reasoningTokens", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "x",
        candidates: [{ finishReason: "STOP" as never }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 50,
          thoughtsTokenCount: 28,
        },
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 10,
      output: 40,
      total: 50,
      reasoningTokens: 28,
    });
  });

  it("surfaces cachedContentTokenCount and thoughtsTokenCount together", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "x",
        candidates: [{ finishReason: "STOP" as never }],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 30,
          totalTokenCount: 50,
          cachedContentTokenCount: 7,
          thoughtsTokenCount: 12,
        },
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 20,
      output: 30,
      total: 50,
      cachedTokens: 7,
      reasoningTokens: 12,
    });
  });

  it("omits reasoningTokens when thoughtsTokenCount is zero or absent", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "x",
        candidates: [{ finishReason: "STOP" as never }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
          thoughtsTokenCount: 0,
        },
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const usage = (await model.complete([{ role: "user", content: "hi" }])).usage;
    expect("reasoningTokens" in usage).toBe(false);
  });

  it("maps reasoning.maxTokens to thinkingConfig.thinkingBudget", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { maxTokens: 4096 },
    });

    expect(calls[0].config).toMatchObject({ thinkingConfig: { thinkingBudget: 4096 } });
  });

  it("buckets reasoning.effort into a thinkingBudget; maxTokens wins when both set", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "low" } });
    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "medium" } });
    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "high" } });
    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "low", maxTokens: 9999 },
    });

    expect((calls[0].config as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 1024,
    });
    expect((calls[1].config as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 8192,
    });
    expect((calls[2].config as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 24576,
    });
    // explicit maxTokens overrides the effort bucket
    expect((calls[3].config as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 9999,
    });
  });

  it("omits thinkingConfig when reasoning is absent or carries neither field", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await model.complete([{ role: "user", content: "hi" }]);
    await model.complete([{ role: "user", content: "hi" }], { reasoning: {} });

    expect("thinkingConfig" in (calls[0].config as Record<string, unknown>)).toBe(false);
    expect("thinkingConfig" in (calls[1].config as Record<string, unknown>)).toBe(false);
  });

  it("drops thinkingConfig when the model is not reasoning-capable", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash", reasoning: false });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { maxTokens: 2048 } });

    expect("thinkingConfig" in (calls[0].config as Record<string, unknown>)).toBe(false);
  });

  it("surfaces cachedContentTokenCount as cachedTokens", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "x",
        candidates: [{ finishReason: "STOP" as never }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 4,
          totalTokenCount: 14,
          cachedContentTokenCount: 6,
        },
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 10,
      output: 4,
      total: 14,
      cachedTokens: 6,
    });
  });

  it("emits native responseJsonSchema for an object schema; omits otherwise", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });

    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });
    const schema = { type: "object", properties: { summary: { type: "string" } } };
    await model.complete([{ role: "user", content: "hi" }], { responseSchema: schema });

    expect(calls[0].config).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });

    await model.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "array" },
    });
    expect((calls[1].config as Record<string, unknown>).responseJsonSchema).toBeUndefined();

    const noStruct = new GoogleModel(ai, { name: "gemini-2.5-flash", structuredOutput: false });
    await noStruct.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "object", properties: {} },
    });
    expect((calls[2].config as Record<string, unknown>).responseJsonSchema).toBeUndefined();
  });

  it("falls back to empty content when the response carries no text", async () => {
    const { ai } = makeFakeAI({
      response: { candidates: [{ finishReason: "STOP" as never }] },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.content).toBe("");
    expect(result.usage).toEqual({ input: 0, output: 0, total: 0 });
    expect(result.finishReason).toBe("stop");
  });

  it("maps MAX_TOKENS to a 'length' finish reason", async () => {
    const { ai } = makeFakeAI({
      response: { text: "truncated", candidates: [{ finishReason: "MAX_TOKENS" as never }] },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).finishReason).toBe("length");
  });

  it("maps an unknown / safety finish reason to 'error'", async () => {
    const { ai } = makeFakeAI({
      response: { text: "", candidates: [{ finishReason: "SAFETY" as never }] },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).finishReason).toBe("error");
  });

  it("falls back the tool-call id to the function name when Gemini omits the id", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "",
        candidates: [
          {
            finishReason: "STOP" as never,
            content: {
              role: "model",
              parts: [{ functionCall: { name: "getWeather", args: { city: "Cairo" } } }],
            },
          },
        ],
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "getWeather", name: "getWeather", input: { city: "Cairo" } },
    ]);
  });

  it("returns multiple tool calls in part order and omits absent thoughtSignatures", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "",
        candidates: [
          {
            finishReason: "STOP" as never,
            content: {
              role: "model",
              parts: [
                { text: "thinking" },
                { functionCall: { id: "a", name: "first", args: {} } },
                { functionCall: { id: "b", name: "second", args: { n: 1 } } },
              ],
            },
          },
        ],
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.toolCalls).toEqual([
      { id: "a", name: "first", input: {} },
      { id: "b", name: "second", input: { n: 1 } },
    ]);
    // No providerMetadata key emitted when the part had no thoughtSignature.
    expect(result.toolCalls?.every((call) => !("providerMetadata" in call))).toBe(true);
  });

  it("defaults tool-call input to an empty object when args are missing", async () => {
    const { ai } = makeFakeAI({
      response: {
        text: "",
        candidates: [
          {
            finishReason: "STOP" as never,
            content: { role: "model", parts: [{ functionCall: { name: "ping" } }] },
          },
        ],
      },
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    expect((await model.complete([{ role: "user", content: "hi" }])).toolCalls).toEqual([
      { id: "ping", name: "ping", input: {} },
    ]);
  });

  it("forwards mapped tools, abort signal, and per-call inference overrides", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, {
      name: "gemini-2.5-flash",
      temperature: 0.1,
      maxTokens: 100,
    });
    const controller = new AbortController();
    const tool: ToolConfig<unknown, unknown> = {
      name: "search",
      description: "search tool",
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
          jsonSchema: { input: () => ({ type: "object", properties: {} }) },
        },
      } as unknown as ToolConfig<unknown, unknown>["input"],
      execute: async (value: unknown) => value,
    };

    await model.complete([{ role: "user", content: "hi" }], {
      temperature: 0.9,
      maxTokens: 42,
      signal: controller.signal,
      tools: [tool],
    });

    const config = calls[0].config as Record<string, unknown>;
    expect(config.temperature).toBe(0.9);
    expect(config.maxOutputTokens).toBe(42);
    expect(config.abortSignal).toBe(controller.signal);
    expect(config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "search",
            description: "search tool",
            parametersJsonSchema: { type: "object", properties: {} },
          },
        ],
      },
    ]);
  });

  it("omits temperature / maxOutputTokens entirely when neither config nor options set them", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await model.complete([{ role: "user", content: "hi" }]);

    const config = calls[0].config as Record<string, unknown>;
    expect("temperature" in config).toBe(false);
    expect("maxOutputTokens" in config).toBe(false);
    expect("abortSignal" in config).toBe(false);
    expect("tools" in config).toBe(false);
  });

  it("omits structured output when the object schema has no properties object", async () => {
    const { ai, calls } = makeFakeAI({ response: baseResponse });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await model.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "object" },
    });

    const config = calls[0].config as Record<string, unknown>;
    expect("responseJsonSchema" in config).toBe(false);
    expect("responseMimeType" in config).toBe(false);
  });

  it("rethrows a wrapped typed error on failure", async () => {
    const { ai } = makeFakeAI({ throws: { name: "ApiError", status: 429, message: "slow" } });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await expect(model.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
    });
  });
});

describe("GoogleModel.stream()", () => {
  it("yields text deltas then a terminal done with mapped finish + usage", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        { text: "Hel" },
        { text: "lo" },
        {
          candidates: [{ finishReason: "STOP" as never }],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 },
        },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

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

  it("emits a tool-call chunk (with thoughtSignature) and finishes as tool_calls", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    thoughtSignature: "sig-xyz",
                    functionCall: { id: "fc_1", name: "getWeather", args: { city: "Cairo" } },
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [{ finishReason: "STOP" as never }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 7, totalTokenCount: 9 },
        },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const toolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: Record<string, unknown>;
    }> = [];
    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "tool-call") {
        toolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input,
          providerMetadata: event.providerMetadata,
        });
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(toolCalls).toEqual([
      {
        id: "fc_1",
        name: "getWeather",
        input: { city: "Cairo" },
        providerMetadata: { thoughtSignature: "sig-xyz" },
      },
    ]);
    expect(finishReason).toBe("tool_calls");
  });

  it("emits a single done with zero usage and 'error' finish for an empty stream", async () => {
    const { ai } = makeFakeAI({ streamChunks: [] });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const events: Array<{ type: string }> = [];

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "done", finishReason: "error", usage: { input: 0, output: 0, total: 0 } },
    ]);
  });

  it("derives total from input + output when the chunk omits totalTokenCount", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        { text: "x" },
        {
          candidates: [{ finishReason: "STOP" as never }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 },
        },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    let usage: unknown;

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        usage = event.usage;
      }
    }

    expect(usage).toEqual({ input: 6, output: 4, total: 10 });
  });

  it("surfaces cachedContentTokenCount on the streamed usage", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        {
          candidates: [{ finishReason: "STOP" as never }],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 3,
            totalTokenCount: 15,
            cachedContentTokenCount: 8,
          },
        },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    let usage: unknown;

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        usage = event.usage;
      }
    }

    expect(usage).toEqual({ input: 12, output: 3, total: 15, cachedTokens: 8 });
  });

  it("surfaces thoughtsTokenCount as reasoningTokens on the streamed usage", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        {
          candidates: [{ finishReason: "STOP" as never }],
          usageMetadata: {
            promptTokenCount: 11,
            candidatesTokenCount: 50,
            totalTokenCount: 61,
            cachedContentTokenCount: 4,
            thoughtsTokenCount: 33,
          },
        },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    let usage: unknown;

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        usage = event.usage;
      }
    }

    expect(usage).toEqual({
      input: 11,
      output: 50,
      total: 61,
      cachedTokens: 4,
      reasoningTokens: 33,
    });
  });

  it("forwards thinkingConfig on the stream request when reasoning is set", async () => {
    const { ai, calls } = makeFakeAI({ streamChunks: [{ text: "ok" }] });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    for await (const _event of model.stream([{ role: "user", content: "hi" }], {
      reasoning: { effort: "high" },
    })) {
      void _event;
    }

    expect(calls[0].config).toMatchObject({ thinkingConfig: { thinkingBudget: 24576 } });
  });

  it("interleaves text deltas with a tool-call lacking a thoughtSignature", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        { text: "let me check " },
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "getWeather", args: { city: "Cairo" } } }],
              },
            },
          ],
        },
        { candidates: [{ finishReason: "STOP" as never }] },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const events: Array<Record<string, unknown>> = [];

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      events.push(event as unknown as Record<string, unknown>);
    }

    expect(events[0]).toEqual({ type: "delta", content: "let me check " });
    expect(events[1]).toEqual({
      type: "tool-call",
      id: "getWeather",
      name: "getWeather",
      input: { city: "Cairo" },
    });
    expect(events[1]).not.toHaveProperty("providerMetadata");
    expect(events[2]).toEqual({
      type: "done",
      finishReason: "tool_calls",
      usage: { input: 0, output: 0, total: 0 },
    });
  });

  it("keeps the last finish reason when multiple chunks report one (no tool calls)", async () => {
    const { ai } = makeFakeAI({
      streamChunks: [
        { text: "partial", candidates: [{ finishReason: "STOP" as never }] },
        { candidates: [{ finishReason: "MAX_TOKENS" as never }] },
      ],
    });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(finishReason).toBe("length");
  });

  it("forwards system instruction and structured output on the stream request", async () => {
    const { ai, calls } = makeFakeAI({ streamChunks: [{ text: "ok" }] });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });
    const schema = { type: "object", properties: { answer: { type: "string" } } };

    for await (const _event of model.stream(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { responseSchema: schema },
    )) {
      void _event;
    }

    expect(calls[0].config).toMatchObject({
      systemInstruction: "be terse",
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });
  });

  it("rethrows a wrapped typed error when the stream request fails", async () => {
    const { ai } = makeFakeAI({ throws: { name: "ApiError", status: 403, message: "denied" } });
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    await expect(async () => {
      for await (const _event of model.stream([{ role: "user", content: "hi" }])) {
        void _event;
      }
    }).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });

  it("wraps an error thrown mid-iteration (after the request succeeded)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const generateContentStream = async (params: Record<string, unknown>) => {
      calls.push(params);

      return (async function* () {
        yield { text: "partial" } as GenerateContentResponse;
        throw { name: "ApiError", status: 500, message: "stream blew up" };
      })();
    };
    const ai = {
      models: { generateContentStream },
    } as unknown as GoogleGenAI;
    const model = new GoogleModel(ai, { name: "gemini-2.5-flash" });

    const seen: string[] = [];

    await expect(async () => {
      for await (const event of model.stream([{ role: "user", content: "hi" }])) {
        seen.push(event.type);
      }
    }).rejects.toMatchObject({ code: "PROVIDER_ERROR" });

    // The pre-error delta was still yielded before the throw propagated.
    expect(seen).toEqual(["delta"]);
  });
});
