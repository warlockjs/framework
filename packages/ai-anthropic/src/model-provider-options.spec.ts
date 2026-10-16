import type Anthropic from "@anthropic-ai/sdk";
import { InvalidRequestError, type Message, type ReasoningEffort } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { AnthropicModel } from "./model";

type Recorded = { api: "messages" | "beta"; method: string; body: Record<string, unknown> };

/**
 * Fake client exposing both `messages` and `beta.messages`, each with
 * `create` and `countTokens`, recording which endpoint received what.
 */
function makeClient(options: {
  message?: Partial<Anthropic.Message>;
  streamEvents?: unknown[];
  inputTokens?: number;
}) {
  const calls: Recorded[] = [];

  const endpoint = (api: Recorded["api"]) => ({
    create: async (body: Record<string, unknown>) => {
      calls.push({ api, method: "create", body });

      if (body.stream) {
        return (async function* () {
          for (const event of options.streamEvents ?? []) {
            yield event;
          }
        })();
      }

      return message(options.message);
    },
    countTokens: async (body: Record<string, unknown>) => {
      calls.push({ api, method: "countTokens", body });

      return { input_tokens: options.inputTokens ?? 0 };
    },
  });

  const client = {
    messages: endpoint("messages"),
    beta: { messages: endpoint("beta") },
  } as unknown as Anthropic;

  return { client, calls };
}

function message(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    container: null,
    model: "claude-opus-5-5",
    role: "assistant",
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    content: [{ type: "text", text: "hello", citations: null }],
    usage: {
      input_tokens: 5,
      output_tokens: 3,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...overrides,
  } as Anthropic.Message;
}

function only<T>(items: readonly T[]): T {
  const [first] = items;

  if (first === undefined) throw new Error("expected a recorded call");

  return first;
}

async function drain(iterable: AsyncIterable<{ type: string }>) {
  const chunks: Array<Record<string, unknown>> = [];

  for await (const chunk of iterable) {
    chunks.push(chunk as unknown as Record<string, unknown>);
  }

  return chunks;
}

const thinkingBlock = { type: "thinking", thinking: "", signature: "sig_1" };
const toolUseBlock = { type: "tool_use", id: "tu_1", name: "lookup", input: { q: "x" } };

describe("AnthropicModel provider blocks", () => {
  it("returns the ordered content blocks when the turn has a non-neutral block", async () => {
    const { client } = makeClient({
      message: {
        stop_reason: "tool_use",
        content: [thinkingBlock, toolUseBlock] as unknown as Anthropic.ContentBlock[],
      },
    });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const response = await model.complete([{ role: "user", content: "hi" }]);

    expect(response.blocks).toEqual([
      { provider: "anthropic", type: "thinking", data: thinkingBlock },
      { provider: "anthropic", type: "tool_use", data: toolUseBlock },
    ]);
  });

  it("omits blocks for a plain text turn", async () => {
    const { client } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const response = await model.complete([{ role: "user", content: "hi" }]);

    expect(response.blocks).toBeUndefined();
  });

  it("replays an assistant turn verbatim from its blocks, compaction included", async () => {
    const compaction = { type: "compaction", content: "summary", encrypted_content: "enc" };
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    await model.complete([
      { role: "user", content: "long history" },
      {
        role: "assistant",
        content: "answer",
        blocks: [
          { provider: "anthropic", type: "compaction", data: compaction },
          { provider: "anthropic", type: "text", data: { type: "text", text: "answer" } },
        ],
      },
      { role: "user", content: "next" },
    ]);

    expect(only(calls).body.messages).toEqual([
      { role: "user", content: "long history" },
      { role: "assistant", content: [compaction, { type: "text", text: "answer" }] },
      { role: "user", content: "next" },
    ]);
  });

  it("round-trips a tool-use turn through complete() and the next request", async () => {
    const { client, calls } = makeClient({
      message: {
        stop_reason: "tool_use",
        content: [thinkingBlock, toolUseBlock] as unknown as Anthropic.ContentBlock[],
      },
    });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const response = await model.complete([{ role: "user", content: "hi" }]);

    await model.complete([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        blocks: response.blocks,
      },
      { role: "tool", toolCallId: "tu_1", content: "result" },
    ]);

    expect(calls[1]?.body.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [thinkingBlock, toolUseBlock] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "result" }] },
    ]);
  });

  it("falls back to content + toolCalls when blocks belong to another provider or no longer match", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const foreign: Message = {
      role: "assistant",
      content: "plain",
      blocks: [{ provider: "openai", type: "reasoning", data: { id: "rs_1" } }],
    };
    const edited: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tu_2", name: "lookup", input: {} }],
      blocks: [{ provider: "anthropic", type: "tool_use", data: toolUseBlock }],
    };

    await model.complete([{ role: "user", content: "hi" }, foreign]);
    await model.complete([
      { role: "user", content: "hi" },
      edited,
      { role: "tool", toolCallId: "tu_2", content: "r" },
    ]);

    expect((calls[0]?.body.messages as unknown[])[1]).toEqual({
      role: "assistant",
      content: "plain",
    });
    expect((calls[1]?.body.messages as unknown[])[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "tu_2", name: "lookup", input: {} }],
    });
  });

  it("assembles every streamed block, including server tools and beta compaction", async () => {
    const { client } = makeClient({
      streamEvents: [
        { type: "message_start", message: { usage: { input_tokens: 2 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"query":' },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"warlock"}' },
        },
        { type: "content_block_stop", index: 1 },
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "compaction", content: null, encrypted_content: null },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: { type: "compaction_delta", content: "summary", encrypted_content: "enc" },
        },
        { type: "content_block_stop", index: 2 },
        { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index: 3 },
        {
          type: "message_delta",
          delta: { stop_reason: "pause_turn" },
          usage: { output_tokens: 4 },
        },
        { type: "message_stop" },
      ],
    });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const chunks = await drain(model.stream([{ role: "user", content: "hi" }]));
    const done = chunks.at(-1) as { finishReason: string; blocks: Array<{ data: unknown }> };

    expect(done.finishReason).toBe("pause_turn");
    expect(done.blocks.map((block) => block.data)).toEqual([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "warlock" } },
      { type: "compaction", content: "summary", encrypted_content: "enc" },
      { type: "text", text: "Hi" },
    ]);
  });

  it("omits blocks on the done chunk for a plain text stream", async () => {
    const { client } = makeClient({
      streamEvents: [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      ],
    });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    const chunks = await drain(model.stream([{ role: "user", content: "hi" }]));

    expect(chunks.at(-1)).not.toHaveProperty("blocks");
  });
});

describe("AnthropicModel tool results", () => {
  it("groups the results of one parallel tool-use turn into a single user message", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    await model.complete([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "lookup", input: {} },
          { id: "b", name: "lookup", input: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "ra" },
      { role: "tool", toolCallId: "b", content: "rb" },
      { role: "user", content: "thanks" },
    ]);

    expect((only(calls).body.messages as unknown[]).slice(2)).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "ra" },
          { type: "tool_result", tool_use_id: "b", content: "rb" },
        ],
      },
      { role: "user", content: "thanks" },
    ]);
  });
});

describe("AnthropicModel provider options", () => {
  it("routes through beta.messages with the beta flags and merges body fields last", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    await model.complete([{ role: "user", content: "hi" }], {
      maxTokens: 100,
      providerOptions: {
        anthropic: {
          betas: ["compact-2026-01-12"],
          body: {
            context_management: { edits: [{ type: "compact_20260112" }] },
            max_tokens: 200,
          },
        },
      },
    });

    const call = only(calls);

    expect(call.api).toBe("beta");
    expect(call.body.betas).toEqual(["compact-2026-01-12"]);
    expect(call.body.context_management).toEqual({ edits: [{ type: "compact_20260112" }] });
    expect(call.body.max_tokens).toBe(200);
  });

  it("refuses body fields that would replace the conversation, model or tools", async () => {
    for (const field of ["model", "messages", "system", "tools", "mcp_servers", "stream"]) {
      const { client, calls } = makeClient({});
      const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

      const attempt = model.complete([{ role: "user", content: "hi" }], {
        providerOptions: { anthropic: { body: { [field]: "override", inference_geo: "us" } } },
      });

      await expect(attempt, field).rejects.toBeInstanceOf(InvalidRequestError);
      await expect(attempt, field).rejects.toThrow(`"${field}"`);
      expect(calls, field).toHaveLength(0);
    }
  });

  it("refuses reserved body fields on the streaming and token-counting paths too", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });
    const options = { providerOptions: { anthropic: { body: { messages: [] } } } };

    await expect(
      drain(model.stream([{ role: "user", content: "hi" }], options)),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      model.countTokens([{ role: "user", content: "hi" }], options),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });

  it("stays on messages.create without betas and ignores other providers' options", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    await model.complete([{ role: "user", content: "hi" }], {
      providerOptions: { openai: { store: true }, anthropic: { body: { inference_geo: "us" } } },
    });

    const call = only(calls);

    expect(call.api).toBe("messages");
    expect(call.body.inference_geo).toBe("us");
    expect(call.body).not.toHaveProperty("store");
    expect(call.body).not.toHaveProperty("providerOptions");
  });

  it("applies thinking.display when thinking is sent to an adaptive model", async () => {
    const { client, calls } = makeClient({});
    const adaptive = new AnthropicModel(client, { name: "claude-opus-5-5" });
    const budget = new AnthropicModel(client, { name: "claude-haiku-4-5" });
    const anthropic = { thinkingDisplay: "summarized" as const };

    await adaptive.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "high" },
      providerOptions: { anthropic },
    });
    await adaptive.complete([{ role: "user", content: "hi" }], { providerOptions: { anthropic } });
    await budget.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "low" },
      providerOptions: { anthropic },
    });

    expect(calls[0]?.body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(calls[1]?.body).not.toHaveProperty("thinking");
    expect(calls[2]?.body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("lets a per-call cacheControl.ttl override the model's promptCacheTtl", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, {
      name: "claude-opus-5-5",
      promptCaching: true,
      promptCacheTtl: "5m",
    });

    await model.complete([{ role: "user", content: "hi" }], { cacheControl: { ttl: "1h" } });
    await model.complete(
      [
        { role: "system", content: "stable" },
        { role: "user", content: "hi" },
      ],
      { cacheControl: { breakpoints: 1, ttl: "1h" } },
    );

    expect(calls[0]?.body.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(calls[1]?.body.system).toEqual([
      { type: "text", text: "stable", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
  });

  it("counts tokens through messages.countTokens with only the accepted fields", async () => {
    const { client, calls } = makeClient({ inputTokens: 321 });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5", temperature: 1 });

    const tokens = await model.countTokens(
      [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
      { reasoning: { effort: "low" } },
    );

    const call = only(calls);

    expect(tokens).toBe(321);
    expect(call.method).toBe("countTokens");
    expect(call.api).toBe("messages");
    expect(call.body).toEqual({
      model: "claude-opus-5-5",
      messages: [{ role: "user", content: "hi" }],
      system: "Be brief.",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
  });

  it("counts tokens through the beta endpoint when betas are set", async () => {
    const { client, calls } = makeClient({ inputTokens: 7 });
    const model = new AnthropicModel(client, { name: "claude-opus-5-5" });

    await model.countTokens([{ role: "user", content: "hi" }], {
      providerOptions: { anthropic: { betas: ["compact-2026-01-12"] } },
    });

    expect(only(calls).api).toBe("beta");
    expect(only(calls).body.betas).toEqual(["compact-2026-01-12"]);
  });
});

describe("AnthropicModel Claude 5-family thinking", () => {
  const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"] as const;

  /** Expected `output_config.effort` for each effort that keeps thinking on. */
  const thinkingOn: Array<[ReasoningEffort | undefined, string]> = [
    [undefined, "medium"],
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ];

  const cases = models.flatMap((name) =>
    thinkingOn.map(([effort, wire]) => [name, effort, wire] as const),
  );

  it.each(cases)(
    "%s with effort %s sends adaptive thinking at output effort %s",
    async (name, effort, wire) => {
      const { client, calls } = makeClient({});
      const model = new AnthropicModel(client, { name, temperature: 0.3 });

      await model.complete([{ role: "user", content: "hi" }], {
        reasoning: { effort, maxTokens: 20000 },
      });

      const { body } = only(calls);

      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toEqual({ effort: wire });
      expect(JSON.stringify(body)).not.toContain("budget_tokens");
      expect(body).not.toHaveProperty("temperature");
    },
  );

  it("turns thinking off on Sonnet 5.5 for effort 'none' with between_tools alone", async () => {
    const { client, calls } = makeClient({});
    const model = new AnthropicModel(client, { name: "claude-sonnet-5-5" });

    await model.complete([{ role: "user", content: "hi" }], {
      reasoning: { effort: "none", maxTokens: 20000 },
      providerOptions: { anthropic: { thinkingDisplay: "summarized" } },
    });

    const { body } = only(calls);

    // `between_tools` takes no other field, and needs effort `high` or
    // below: the model default (`high`) applies when output_config is absent.
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body).not.toHaveProperty("output_config");
  });

  it.each(["claude-opus-5-5", "claude-fable-5-1"])(
    "%s has no thinking-off form, so effort 'none' sends no thinking field",
    async (name) => {
      const { client, calls } = makeClient({});
      const model = new AnthropicModel(client, { name });

      await model.complete([{ role: "user", content: "hi" }], {
        reasoning: { effort: "none", maxTokens: 20000 },
      });

      const { body } = only(calls);

      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("output_config");
      expect(JSON.stringify(body)).not.toContain("disabled");
    },
  );

  it("sends between_tools on a streaming Sonnet 5.5 request and by Bedrock id", async () => {
    const { client, calls } = makeClient({ streamEvents: [] });

    for (const name of ["claude-sonnet-5-5", "anthropic.claude-sonnet-5-5"]) {
      const model = new AnthropicModel(client, { name });

      await drain(
        model.stream([{ role: "user", content: "hi" }], { reasoning: { effort: "none" } }),
      );
    }

    expect(calls.map((call) => call.body.thinking)).toEqual([
      { type: "between_tools" },
      { type: "between_tools" },
    ]);
  });
});
