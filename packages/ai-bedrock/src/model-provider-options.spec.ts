import {
  ConverseStreamCommand,
  CountTokensCommand,
  type BedrockRuntimeClient,
} from "@aws-sdk/client-bedrock-runtime";
import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { BedrockModel } from "./model";

const messages: Message[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "hi" },
];

function setup() {
  const send = vi.fn(async (command: unknown, _options?: unknown) => {
    if (command instanceof CountTokensCommand) return { inputTokens: 321 };
    if (command instanceof ConverseStreamCommand) return { stream: (async function* () {})() };
    return {
      output: { message: { content: [{ text: "ok" }] } },
      stopReason: "end_turn",
      usage: {},
    };
  });
  return {
    model: new BedrockModel({ send } as unknown as BedrockRuntimeClient, {
      name: "anthropic.claude-sonnet-4-5",
    }),
    send,
  };
}

describe("Bedrock provider options and native counts", () => {
  it("counts identical Converse messages, system, tools and additional fields", async () => {
    const { model, send } = setup();
    const signal = new AbortController().signal;
    const options = {
      signal,
      tools: [{ name: "lookup", description: "Look up data", execute: async () => "ok" }],
      providerOptions: { bedrock: { body: { additionalModelRequestFields: { top_k: 4 } } } },
    };
    await model.complete(messages, options);
    expect(await model.countTokens(messages, options)).toBe(321);
    const request = (send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CountTokensCommand);
    expect((send.mock.calls[1]?.[0] as CountTokensCommand).input).toEqual({
      modelId: model.name,
      input: {
        converse: {
          messages: request.messages,
          system: request.system,
          toolConfig: request.toolConfig,
          additionalModelRequestFields: { top_k: 4 },
        },
      },
    });
    expect(send.mock.calls[1]?.[1]).toEqual({ abortSignal: signal });
    for await (const chunk of model.stream(messages, options)) void chunk;
    expect(
      (send.mock.calls[2]?.[0] as ConverseStreamCommand).input.additionalModelRequestFields,
    ).toEqual({ top_k: 4 });
  });

  it("ignores other providers and refuses protected conversation fields", async () => {
    const { model, send } = setup();
    await model.complete(messages, { providerOptions: { openai: { body: { modelId: "other" } } } });
    for (const field of ["modelId", "messages", "system", "toolConfig"]) {
      await expect(
        model.countTokens(messages, { providerOptions: { bedrock: { body: { [field]: [] } } } }),
      ).rejects.toThrow(InvalidRequestError);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });
});
