import {
  ConverseCommand,
  ConverseStreamCommand,
  type BedrockRuntimeClient,
  type ConverseResponse,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { BedrockModel } from "./model";

type AnyCommand = ConverseCommand | ConverseStreamCommand;

function makeFakeClient(options: {
  converse?: ConverseResponse;
  streamEvents?: ConverseStreamOutput[];
  /** When set, omit the `stream` property from the stream response entirely. */
  noStream?: boolean;
  throws?: unknown;
  /** When set, the async stream generator throws this after yielding its events. */
  throwsMidStream?: unknown;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const sendOptions: Array<unknown> = [];

  const send = async (command: AnyCommand, opts?: unknown) => {
    calls.push(command.input as unknown as Record<string, unknown>);
    sendOptions.push(opts);

    if (options.throws) {
      throw options.throws;
    }

    if (command instanceof ConverseStreamCommand) {
      if (options.noStream) {
        return {};
      }

      return {
        stream: (async function* () {
          for (const event of options.streamEvents ?? []) {
            yield event;
          }

          if (options.throwsMidStream) {
            throw options.throwsMidStream;
          }
        })(),
      };
    }

    return options.converse;
  };

  const client = { send } as unknown as BedrockRuntimeClient;

  return { client, calls, sendOptions };
}

/** Drain a stream into an array of chunks. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

const baseConverse: ConverseResponse = {
  output: { message: { role: "assistant", content: [{ text: "hello" }] } },
  stopReason: "end_turn",
  usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  metrics: { latencyMs: 1 },
};

describe("BedrockModel.complete()", () => {
  it("forwards modelId, mapped messages, hoisted system, and inference config", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      temperature: 0.4,
      maxTokens: 512,
    });

    await model.complete([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hi" },
    ]);

    expect(calls[0].modelId).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(calls[0].system).toEqual([{ text: "Be concise." }]);
    expect(calls[0].messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
    expect(calls[0].inferenceConfig).toEqual({ maxTokens: 512, temperature: 0.4 });
  });

  it("omits unset inference params and per-call options override config", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }]);
    expect(calls[0].inferenceConfig).toEqual({});

    await model.complete([{ role: "user", content: "hi" }], { maxTokens: 64, temperature: 0.9 });
    expect(calls[1].inferenceConfig).toEqual({ maxTokens: 64, temperature: 0.9 });
  });

  it("normalizes a text response into ModelResponse shape", async () => {
    const { client } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      content: "hello",
      finishReason: "stop",
      usage: { input: 5, output: 3, total: 8 },
      toolCalls: undefined,
    });
  });

  it("extracts toolUse blocks into neutral tool calls", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        stopReason: "tool_use",
        output: {
          message: {
            role: "assistant",
            content: [
              { text: "checking" },
              { toolUse: { toolUseId: "tu_1", name: "getWeather", input: { city: "Cairo" } } },
            ],
          },
        },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.content).toBe("checking");
    expect(result.toolCalls).toEqual([
      { id: "tu_1", name: "getWeather", input: { city: "Cairo" } },
    ]);
  });

  it("surfaces cacheReadInputTokens as cachedTokens", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadInputTokens: 6 },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 10,
      output: 4,
      total: 14,
      cachedTokens: 6,
    });
  });

  it("emits native outputConfig for an object schema; omits otherwise", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });

    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });
    const schema = { type: "object", properties: { summary: { type: "string" } } };
    await model.complete([{ role: "user", content: "hi" }], { responseSchema: schema });

    expect(calls[0].outputConfig).toEqual({
      textFormat: {
        type: "json_schema",
        structure: { jsonSchema: { name: "response", schema: JSON.stringify(schema) } },
      },
    });

    await model.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "array", items: { type: "string" } },
    });
    expect(calls[1].outputConfig).toBeUndefined();

    const noStruct = new BedrockModel(client, {
      name: "amazon.nova-pro-v1:0",
      structuredOutput: false,
    });
    await noStruct.complete([{ role: "user", content: "hi" }], {
      responseSchema: { type: "object", properties: {} },
    });
    expect(calls[2].outputConfig).toBeUndefined();
  });

  it("rethrows a wrapped typed error on failure", async () => {
    const { client } = makeFakeClient({
      throws: { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await expect(model.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
    });
  });

  it("returns an empty response when the model output is missing", async () => {
    const { client } = makeFakeClient({ converse: { stopReason: "end_turn" } });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const result = await model.complete([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      content: "",
      finishReason: "stop",
      usage: { input: 0, output: 0, total: 0 },
      toolCalls: undefined,
    });
  });

  it("concatenates multiple text blocks into a single content string", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Hello, " }, { text: "world" }, { text: "!" }],
          },
        },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).content).toBe("Hello, world!");
  });

  it("ignores non-text blocks when extracting content", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        output: {
          message: {
            role: "assistant",
            content: [{ text: "answer" }, { toolUse: { toolUseId: "t", name: "n", input: {} } }],
          },
        },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).content).toBe("answer");
  });

  it("falls back total to input + output when totalTokens is absent", async () => {
    const { client } = makeFakeClient({
      converse: { ...baseConverse, usage: { inputTokens: 7, outputTokens: 5 } },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 7,
      output: 5,
      total: 12,
    });
  });

  it("treats partial usage fields as zero", async () => {
    const { client } = makeFakeClient({
      converse: { ...baseConverse, usage: { outputTokens: 4 } },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 0,
      output: 4,
      total: 4,
    });
  });

  it("does not surface cachedTokens when cacheReadInputTokens is zero", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadInputTokens: 0 },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const usage = (await model.complete([{ role: "user", content: "hi" }])).usage;

    expect(usage).toEqual({ input: 10, output: 4, total: 14 });
    expect(usage).not.toHaveProperty("cachedTokens");
  });

  it("defaults missing toolUse id / name / input fields", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        stopReason: "tool_use",
        output: { message: { role: "assistant", content: [{ toolUse: {} }] } },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).toolCalls).toEqual([
      { id: "", name: "", input: {} },
    ]);
  });

  it("extracts several tool calls in document order", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        stopReason: "tool_use",
        output: {
          message: {
            role: "assistant",
            content: [
              { toolUse: { toolUseId: "a", name: "first", input: { x: 1 } } },
              { toolUse: { toolUseId: "b", name: "second", input: { y: 2 } } },
            ],
          },
        },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).toolCalls).toEqual([
      { id: "a", name: "first", input: { x: 1 } },
      { id: "b", name: "second", input: { y: 2 } },
    ]);
  });

  it("forwards a toolConfig built from supplied tools", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }], {
      tools: [
        {
          name: "getWeather",
          description: "weather",
          input: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: (value: unknown) => ({ value }),
              jsonSchema: {
                input: () => ({ type: "object", properties: { city: { type: "string" } } }),
              },
            },
          } as never,
          execute: async (value: unknown) => value,
        },
      ],
    });

    expect(calls[0].toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: "getWeather",
            description: "weather",
            inputSchema: { json: { type: "object", properties: { city: { type: "string" } } } },
          },
        },
      ],
    });
  });

  it("omits toolConfig entirely when no tools are supplied", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0]).not.toHaveProperty("toolConfig");
  });

  it("omits the system key when there is no system message", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(calls[0]).not.toHaveProperty("system");
  });

  it("passes the abort signal through to client.send", async () => {
    const { client, sendOptions } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });
    const controller = new AbortController();

    await model.complete([{ role: "user", content: "hi" }], { signal: controller.signal });

    expect(sendOptions[0]).toEqual({ abortSignal: controller.signal });
  });

  it("passes undefined send options when no signal is supplied", async () => {
    const { client, sendOptions } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }]);

    expect(sendOptions[0]).toBeUndefined();
  });
});

describe("BedrockModel.stream()", () => {
  it("yields text deltas then a terminal done with mapped finish + usage", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { messageStart: { role: "assistant" } },
        { contentBlockDelta: { delta: { text: "Hel" }, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { text: "lo" }, contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
        {
          metadata: {
            usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
            metrics: { latencyMs: 1 },
          },
        },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

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

  it("accumulates toolUse input and emits one tool-call at contentBlockStop", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { messageStart: { role: "assistant" } },
        {
          contentBlockStart: {
            start: { toolUse: { toolUseId: "tu_1", name: "getWeather" } },
            contentBlockIndex: 0,
          },
        },
        { contentBlockDelta: { delta: { toolUse: { input: '{"city":' } }, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { toolUse: { input: '"Cairo"}' } }, contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
        {
          metadata: {
            usage: { inputTokens: 2, outputTokens: 7, totalTokens: 9 },
            metrics: { latencyMs: 1 },
          },
        },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let finishReason = "";

    for await (const event of model.stream([{ role: "user", content: "hi" }])) {
      if (event.type === "tool-call") {
        toolCalls.push({ id: event.id, name: event.name, input: event.input });
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }

    expect(toolCalls).toEqual([{ id: "tu_1", name: "getWeather", input: { city: "Cairo" } }]);
    expect(finishReason).toBe("tool_calls");
  });

  it("rethrows a wrapped typed error when the stream request fails", async () => {
    const { client } = makeFakeClient({
      throws: { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await expect(async () => {
      for await (const _event of model.stream([{ role: "user", content: "hi" }])) {
        void _event;
      }
    }).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });

  it("yields only a terminal done with zero usage when the response has no stream", async () => {
    const { client } = makeFakeClient({ noStream: true });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks).toEqual([
      { type: "done", finishReason: "error", usage: { input: 0, output: 0, total: 0 } },
    ]);
  });

  it("surfaces cacheReadInputTokens from stream metadata as cachedTokens", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: { text: "hi" }, contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
        {
          metadata: {
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              cacheReadInputTokens: 6,
            },
          },
        },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));
    const done = chunks.at(-1);

    expect(done).toEqual({
      type: "done",
      finishReason: "stop",
      usage: { input: 10, output: 4, total: 14, cachedTokens: 6 },
    });
  });

  it("does not surface cachedTokens from stream metadata when zero", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { messageStop: { stopReason: "end_turn" } },
        {
          metadata: {
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadInputTokens: 0 },
          },
        },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const done = (await collect(model.stream([{ role: "user", content: "hi" }]))).at(-1);

    expect(done).toEqual({
      type: "done",
      finishReason: "stop",
      usage: { input: 1, output: 2, total: 3 },
    });
  });

  it("falls back stream total to input + output when totalTokens is absent", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { messageStop: { stopReason: "end_turn" } },
        { metadata: { usage: { inputTokens: 8, outputTokens: 5 } } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const done = (await collect(model.stream([{ role: "user", content: "hi" }]))).at(-1);

    expect(done).toMatchObject({ usage: { input: 8, output: 5, total: 13 } });
  });

  it("recovers a malformed accumulated tool-input JSON to an empty object", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        {
          contentBlockStart: {
            start: { toolUse: { toolUseId: "tu_1", name: "getWeather" } },
            contentBlockIndex: 0,
          },
        },
        { contentBlockDelta: { delta: { toolUse: { input: "{not json" } }, contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));
    const toolCall = chunks.find((c) => c.type === "tool-call");

    expect(toolCall).toEqual({ type: "tool-call", id: "tu_1", name: "getWeather", input: {} });
  });

  it("defaults a streamed toolUse id / name to empty strings when omitted", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockStart: { start: { toolUse: {} }, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { toolUse: { input: "{}" } }, contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const toolCall = (await collect(model.stream([{ role: "user", content: "hi" }]))).find(
      (c) => c.type === "tool-call",
    );

    expect(toolCall).toEqual({ type: "tool-call", id: "", name: "", input: {} });
  });

  it("accumulates and emits two parallel tool blocks at distinct indices", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        {
          contentBlockStart: {
            start: { toolUse: { toolUseId: "tu_a", name: "first" } },
            contentBlockIndex: 0,
          },
        },
        {
          contentBlockStart: {
            start: { toolUse: { toolUseId: "tu_b", name: "second" } },
            contentBlockIndex: 1,
          },
        },
        { contentBlockDelta: { delta: { toolUse: { input: '{"a":1}' } }, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { toolUse: { input: '{"b":2}' } }, contentBlockIndex: 1 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 1 } },
        { messageStop: { stopReason: "tool_use" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const toolCalls = (await collect(model.stream([{ role: "user", content: "hi" }]))).filter(
      (c) => c.type === "tool-call",
    );

    expect(toolCalls).toEqual([
      { type: "tool-call", id: "tu_a", name: "first", input: { a: 1 } },
      { type: "tool-call", id: "tu_b", name: "second", input: { b: 2 } },
    ]);
  });

  it("interleaves text deltas with a tool call in emission order", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: { text: "Let me check. " }, contentBlockIndex: 0 } },
        {
          contentBlockStart: {
            start: { toolUse: { toolUseId: "tu_1", name: "getWeather" } },
            contentBlockIndex: 1,
          },
        },
        {
          contentBlockDelta: {
            delta: { toolUse: { input: '{"city":"Cairo"}' } },
            contentBlockIndex: 1,
          },
        },
        { contentBlockStop: { contentBlockIndex: 1 } },
        { messageStop: { stopReason: "tool_use" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks).toEqual([
      { type: "delta", content: "Let me check. " },
      { type: "tool-call", id: "tu_1", name: "getWeather", input: { city: "Cairo" } },
      { type: "done", finishReason: "tool_calls", usage: { input: 0, output: 0, total: 0 } },
    ]);
  });

  it("ignores a contentBlockStart that is not a toolUse", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockStart: { start: {}, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { text: "ok" }, contentBlockIndex: 0 } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks.map((c) => c.type)).toEqual(["delta", "done"]);
  });

  it("drops a toolUse delta with no matching open block", async () => {
    // A delta arriving for an index that was never opened must not crash;
    // it is silently ignored and produces no tool-call.
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: { toolUse: { input: '{"x":1}' } }, contentBlockIndex: 7 } },
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks.some((c) => c.type === "tool-call")).toBe(false);
    expect(chunks.map((c) => c.type)).toEqual(["done"]);
  });

  it("emits no tool-call when a contentBlockStop has no matching accumulator", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockStop: { contentBlockIndex: 3 } },
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks).toEqual([
      { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } },
    ]);
  });

  it("defaults missing contentBlock indices to 0 across start/delta/stop", async () => {
    // None of the events carry contentBlockIndex; the adapter treats them
    // all as index 0, so the tool block round-trips end to end.
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockStart: { start: { toolUse: { toolUseId: "tu_1", name: "n" } } } },
        { contentBlockDelta: { delta: { toolUse: { input: '{"k":1}' } } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: "tool_use" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const toolCall = (await collect(model.stream([{ role: "user", content: "hi" }]))).find(
      (c) => c.type === "tool-call",
    );

    expect(toolCall).toEqual({ type: "tool-call", id: "tu_1", name: "n", input: { k: 1 } });
  });

  it("wraps an error thrown mid-iteration of the stream", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: { text: "partial" }, contentBlockIndex: 0 } },
      ] as unknown as ConverseStreamOutput[],
      throwsMidStream: { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const seen: string[] = [];

    await expect(async () => {
      for await (const event of model.stream([{ role: "user", content: "hi" }])) {
        seen.push(event.type);
      }
    }).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });

    // The text delta before the failure was still yielded.
    expect(seen).toEqual(["delta"]);
  });

  it("ignores a contentBlockDelta with neither text nor toolUse", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: {}, contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const chunks = await collect(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks).toEqual([
      { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } },
    ]);
  });

  it("passes the abort signal through to the stream send call", async () => {
    const { client, sendOptions } = makeFakeClient({
      streamEvents: [
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });
    const controller = new AbortController();

    await collect(model.stream([{ role: "user", content: "hi" }], { signal: controller.signal }));

    expect(sendOptions[0]).toEqual({ abortSignal: controller.signal });
  });

  it("builds the same request shape for stream as for complete", async () => {
    const { client, calls } = makeFakeClient({
      streamEvents: [
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, {
      name: "amazon.nova-pro-v1:0",
      temperature: 0.3,
      maxTokens: 100,
    });

    await collect(
      model.stream([
        { role: "system", content: "S" },
        { role: "user", content: "hi" },
      ]),
    );

    expect(calls[0].modelId).toBe("amazon.nova-pro-v1:0");
    expect(calls[0].system).toEqual([{ text: "S" }]);
    expect(calls[0].messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
    expect(calls[0].inferenceConfig).toEqual({ maxTokens: 100, temperature: 0.3 });
  });
});

describe("BedrockModel capabilities", () => {
  it("infers reasoning / promptCaching / pdf from the model family and defaults audio off", () => {
    const { client } = makeFakeClient({ converse: baseConverse });
    const claude = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    expect(claude.capabilities).toEqual({
      structuredOutput: true,
      vision: true,
      reasoning: true,
      promptCaching: true,
      pdf: true,
      audio: false,
    });
  });

  it("infers all cost-truth flags off for a text-only family", () => {
    const { client } = makeFakeClient({ converse: baseConverse });
    const llama = new BedrockModel(client, { name: "meta.llama3-1-8b-instruct-v1:0" });

    expect(llama.capabilities).toMatchObject({
      reasoning: false,
      promptCaching: false,
      pdf: false,
      audio: false,
    });
  });

  it("lets explicit config override every inferred capability flag", () => {
    const { client } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      reasoning: false,
      promptCaching: false,
      pdf: false,
      audio: true,
    });

    expect(model.capabilities).toMatchObject({
      reasoning: false,
      promptCaching: false,
      pdf: false,
      audio: true,
    });
  });
});

describe("BedrockModel cost-truth — cacheWriteTokens", () => {
  it("surfaces cacheWriteInputTokens as cacheWriteTokens on complete()", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          cacheReadInputTokens: 6,
          cacheWriteInputTokens: 64,
        },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    expect((await model.complete([{ role: "user", content: "hi" }])).usage).toEqual({
      input: 10,
      output: 4,
      total: 14,
      cachedTokens: 6,
      cacheWriteTokens: 64,
    });
  });

  it("does not surface cacheWriteTokens when cacheWriteInputTokens is zero / absent", async () => {
    const { client } = makeFakeClient({
      converse: {
        ...baseConverse,
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, cacheWriteInputTokens: 0 },
      },
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const usage = (await model.complete([{ role: "user", content: "hi" }])).usage;

    expect(usage).toEqual({ input: 5, output: 3, total: 8 });
    expect(usage).not.toHaveProperty("cacheWriteTokens");
  });

  it("surfaces cacheWriteInputTokens from stream metadata as cacheWriteTokens", async () => {
    const { client } = makeFakeClient({
      streamEvents: [
        { contentBlockDelta: { delta: { text: "hi" }, contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
        {
          metadata: {
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              cacheReadInputTokens: 6,
              cacheWriteInputTokens: 32,
            },
          },
        },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    const done = (await collect(model.stream([{ role: "user", content: "hi" }]))).at(-1);

    expect(done).toEqual({
      type: "done",
      finishReason: "stop",
      usage: { input: 10, output: 4, total: 14, cachedTokens: 6, cacheWriteTokens: 32 },
    });
  });
});

describe("BedrockModel cost-truth — cacheControl breakpoints", () => {
  it("appends a cachePoint block to the last message for a caching-capable model", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], { cacheControl: { breakpoints: 1 } });

    expect(calls[0].messages).toEqual([
      { role: "user", content: [{ text: "hi" }, { cachePoint: { type: "default" } }] },
    ]);
  });

  it("no-ops the cachePoint when the model is not caching-capable", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "meta.llama3-1-8b-instruct-v1:0" });

    await model.complete([{ role: "user", content: "hi" }], { cacheControl: { breakpoints: 1 } });

    expect(calls[0].messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
  });

  it("no-ops the cachePoint when breakpoints is absent or zero", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }]);
    expect(calls[0].messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);

    await model.complete([{ role: "user", content: "hi" }], { cacheControl: { breakpoints: 0 } });
    expect(calls[1].messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
  });

  it("marks the trailing message only, leaving earlier turns untouched", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    await model.complete(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      { cacheControl: { breakpoints: 1 } },
    );

    expect(calls[0].messages).toEqual([
      { role: "user", content: [{ text: "first" }] },
      { role: "assistant", content: [{ text: "reply" }] },
      { role: "user", content: [{ text: "second" }, { cachePoint: { type: "default" } }] },
    ]);
  });
});

describe("BedrockModel cost-truth — reasoning / thinking", () => {
  it("maps an explicit reasoning.maxTokens budget to additionalModelRequestFields.thinking", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-3-7-sonnet-20250219-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { maxTokens: 2048 } });

    expect(calls[0].additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
  });

  it("maps a reasoning.effort tier to a conventional thinking budget when no maxTokens is given", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-3-7-sonnet-20250219-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { effort: "high" } });

    expect(calls[0].additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 16384 },
    });
  });

  it("prefers an explicit maxTokens over the effort tier", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-3-7-sonnet-20250219-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "low", maxTokens: 9000 },
    });

    expect(calls[0].additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 9000 },
    });
  });

  it("no-ops reasoning for a non-reasoning-capable model", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, { name: "amazon.nova-pro-v1:0" });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: { maxTokens: 2048 } });

    expect(calls[0]).not.toHaveProperty("additionalModelRequestFields");
  });

  it("no-ops when reasoning is supplied with neither effort nor maxTokens", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-3-7-sonnet-20250219-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], { reasoning: {} });

    expect(calls[0]).not.toHaveProperty("additionalModelRequestFields");
  });

  it("no-ops when effort is 'none' (explicit reasoning-off, thinking omitted)", async () => {
    const { client, calls } = makeFakeClient({ converse: baseConverse });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-3-7-sonnet-20250219-v1:0",
    });

    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "none" },
    });

    expect(calls[0]).not.toHaveProperty("additionalModelRequestFields");
  });

  it("forwards thinking on the stream request path too", async () => {
    const { client, calls } = makeFakeClient({
      streamEvents: [
        { messageStop: { stopReason: "end_turn" } },
      ] as unknown as ConverseStreamOutput[],
    });
    const model = new BedrockModel(client, {
      name: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    await collect(
      model.stream([{ role: "user", content: "hi" }], { reasoning: { effort: "medium" } }),
    );

    expect(calls[0].additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
  });
});
