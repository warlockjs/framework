import type OpenAI from "openai";
import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { OpenAIModel } from "./model";
import { OpenAIResponsesModel } from "./responses-model";

const messages: Message[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "hi" },
];

function setup() {
  const create = vi.fn(async (request: Record<string, unknown>, _options?: unknown) => {
    if (request.stream && request.messages)
      return (async function* () {
        yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };
      })();
    if (request.stream)
      return (async function* () {
        yield {
          type: "response.completed",
          response: {
            status: "completed",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        };
      })();
    return {
      id: "r1",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    };
  });
  const count = vi.fn(async (_request: unknown, _options?: unknown) => ({ input_tokens: 456 }));
  const client = {
    chat: { completions: { create } },
    responses: { create, inputTokens: { count } },
  } as unknown as OpenAI;
  return { client, create, count };
}

describe("OpenAI provider options and native Responses counts", () => {
  it("counts the exact Responses input, instructions, tools and input-shaping options", async () => {
    const { client, create, count } = setup();
    const model = new OpenAIResponsesModel(client, { name: "gpt-5" });
    const signal = new AbortController().signal;
    const options = {
      signal,
      tools: [{ name: "lookup", description: "Look up data", execute: async () => "ok" }],
      reasoning: { effort: "high" as const },
      responseSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
      providerOptions: {
        openai: {
          body: { parallel_tool_calls: false, truncation: "auto", service_tier: "default" },
        },
      },
    };
    await model.complete(messages, options);
    expect(await model.countTokens(messages, options)).toBe(456);
    const request = create.mock.calls[0]?.[0];
    expect(count).toHaveBeenCalledWith(
      {
        model: model.name,
        input: request?.input,
        instructions: request?.instructions,
        tools: request?.tools,
        tool_choice: request?.tool_choice,
        reasoning: request?.reasoning,
        text: request?.text,
        parallel_tool_calls: false,
        truncation: "auto",
      },
      { signal },
    );
    expect(request?.service_tier).toBe("default");
    for await (const chunk of model.stream(messages, options)) void chunk;
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      parallel_tool_calls: false,
      service_tier: "default",
      stream: true,
    });
  });

  it("merges Chat body options for completion and stream, ignoring other providers", async () => {
    const { client, create } = setup();
    const model = new OpenAIModel(client, { name: "gpt-4o-mini" });
    const options = {
      providerOptions: { openai: { body: { top_p: 0.8 } }, anthropic: { body: { messages: [] } } },
    };
    await model.complete(messages, options);
    for await (const chunk of model.stream(messages, options)) void chunk;
    expect(create.mock.calls[0]?.[0].top_p).toBe(0.8);
    expect(create.mock.calls[1]?.[0]).toMatchObject({ top_p: 0.8, stream: true });
    expect("countTokens" in model).toBe(false);
  });

  it("refuses protected request fields in Chat and Responses", async () => {
    const { client, create, count } = setup();
    for (const model of [
      new OpenAIModel(client, { name: "gpt-4o-mini" }),
      new OpenAIResponsesModel(client, { name: "gpt-4o-mini" }),
    ]) {
      for (const field of [
        "model",
        "messages",
        "input",
        "instructions",
        "tools",
        "stream",
        "stream_options",
        "previous_response_id",
        "conversation",
        "store",
        "include",
      ]) {
        await expect(
          model.complete(messages, { providerOptions: { openai: { body: { [field]: [] } } } }),
        ).rejects.toThrow(InvalidRequestError);
      }
    }
    expect(create).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
