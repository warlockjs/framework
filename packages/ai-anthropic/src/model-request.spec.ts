import type Anthropic from "@anthropic-ai/sdk";
import { InvalidRequestError, type Message, type ModelCallOptions } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import {
  AnthropicModel,
  fromProviderBlocks,
  toAnthropicMessages,
  toAnthropicTools,
  toProviderBlocks,
} from "./index";

function setup() {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    if (body.stream) {
      return (async function* () {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hello" },
        };
        yield {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        };
      })();
    }
    return {
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  });
  const betaCreate = vi.fn(create);
  const client = {
    messages: { create },
    beta: { messages: { create: betaCreate } },
  } as unknown as Anthropic;
  return {
    model: new AnthropicModel(client, { name: "claude-opus-5-5", promptCaching: true }),
    create,
    betaCreate,
  };
}

const messages: Message[] = [
  { role: "system", content: "system" },
  { role: "user", content: "hi" },
];

describe("Anthropic built requests", () => {
  it("builds without network calls and sends the identical completion body", async () => {
    const { model, create } = setup();
    const request = model.buildRequest(messages, {
      reasoning: { effort: "high" },
      cacheControl: { ttl: "1h", breakpoints: 1 },
    });
    expect(create).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      endpoint: "messages",
      betas: [],
      body: {
        stream: false,
        thinking: { type: "adaptive" },
        system: [{ cache_control: { type: "ephemeral", ttl: "1h" } }],
      },
    });
    const serialized = JSON.stringify(request.body);
    const response = await model.send(request);
    expect(JSON.stringify(create.mock.calls[0]?.[0])).toBe(serialized);
    expect(response.content).toBe("hello");
    await model.complete(messages, {
      reasoning: { effort: "high" },
      cacheControl: { ttl: "1h", breakpoints: 1 },
    });
    expect(create.mock.calls[1]?.[0]).toEqual(request.body);
  });

  it("complete always selects a non-streaming body even with an indexed stream option", async () => {
    const { model, create } = setup();
    const options: ModelCallOptions = { stream: true };
    const response = await model.complete(messages, options);
    expect(response.content).toBe("hello");
    expect(response.finishReason).toBe("stop");
    expect(create.mock.calls[0]?.[0].stream).toBe(false);
  });

  it("snapshots beta options and merged tool results before source inputs change", async () => {
    const { model, betaCreate } = setup();
    const history: Message[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "lookup", input: {} },
          { id: "b", name: "lookup", input: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "first" },
      { role: "tool", toolCallId: "b", content: "second" },
    ];
    const options: ModelCallOptions = {
      providerOptions: {
        anthropic: {
          betas: ["compact-2026-01-12"],
          body: { context_management: { edits: [{ type: "compact_20260112" }] } },
        },
      },
    };
    const request = model.buildRequest(history, options);
    const serialized = JSON.stringify(request.body);
    const first = history[0];
    if (first) first.content = "changed";
    const anthropic = options.providerOptions?.anthropic as {
      betas: string[];
      body: { context_management: { edits: unknown[] } };
    };
    anthropic.betas.push("later");
    anthropic.body.context_management.edits.push({ type: "later" });
    await model.send(request);
    expect(request.endpoint).toBe("beta.messages");
    expect(request.betas).toEqual(["compact-2026-01-12"]);
    expect(JSON.stringify(request.body)).toBe(serialized);
    expect(betaCreate.mock.calls[0]?.[0]).toEqual({ ...request.body, betas: request.betas });
    expect(request.body.messages).toMatchObject([
      {},
      {},
      { role: "user", content: [{ tool_use_id: "a" }, { tool_use_id: "b" }] },
    ]);
  });

  it("sends built streaming requests and forwards cancellation separately", async () => {
    const { model, create } = setup();
    const request = model.buildRequest(messages, { stream: true });
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of model.send(request, { signal: controller.signal }))
      chunks.push(chunk);
    expect(chunks).toContainEqual({ type: "delta", content: "hello" });
    expect(create).toHaveBeenCalledWith(request.body, { signal: controller.signal });
    const direct = [];
    for await (const chunk of model.stream(messages)) direct.push(chunk);
    expect(direct).toEqual(chunks);
    expect(create.mock.calls[1]?.[0]).toEqual(request.body);
  });

  it("retains reserved-field validation during dry runs", () => {
    const { model, create } = setup();
    expect(() =>
      model.buildRequest(messages, { providerOptions: { anthropic: { body: { messages: [] } } } }),
    ).toThrow(InvalidRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("exports converters with the assistant-block replay security checks", () => {
    const thinking = { type: "thinking", thinking: "", signature: "signed" };
    const blocks = toProviderBlocks([thinking]);
    expect(fromProviderBlocks(blocks, undefined)).toEqual([
      { type: "thinking", thinking: "", signature: "signed" },
    ]);
    expect(
      fromProviderBlocks(
        [{ provider: "anthropic", type: "image", data: { type: "image" } }],
        undefined,
      ),
    ).toBeUndefined();
    expect(toAnthropicMessages(messages).system).toBe("system");
    expect(toAnthropicTools([])).toBeUndefined();
  });
});
