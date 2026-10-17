import type Anthropic from "@anthropic-ai/sdk";
import {
  InvalidRequestError,
  type Message,
  type ModelCallOptions,
  type ProviderContentBlock,
} from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { AnthropicCallOptions, AnthropicModelConfig } from "./config.type";
import { AnthropicModel } from "./model";
import { inferPreservedThinking } from "./thinking-mode";

function makeClient(options: { message?: Partial<Anthropic.Message>; streamEvents?: unknown[] }) {
  const endpoint = {
    create: async (body: Record<string, unknown>) => {
      if (body.stream) {
        return (async function* () {
          for (const event of options.streamEvents ?? []) yield event;
        })();
      }

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
        ...options.message,
      };
    },
  };

  return { messages: endpoint, beta: { messages: endpoint } } as unknown as Anthropic;
}

function model(config: Partial<AnthropicModelConfig> = {}) {
  return new AnthropicModel(makeClient({}), { name: "claude-opus-5-5", ...config });
}

function request(
  anthropic: AnthropicCallOptions,
  options: ModelCallOptions = {},
  config: Partial<AnthropicModelConfig> = {},
  messages: Message[] = [{ role: "user", content: "hi" }],
) {
  return model(config).buildRequest(messages, {
    ...options,
    providerOptions: { anthropic: anthropic as Record<string, unknown> },
  });
}

describe("typed context management", () => {
  it("builds clear_tool_uses and clear_thinking edits, thinking first, with the beta", () => {
    const built = request({
      contextManagement: {
        clearToolUses: {
          trigger: { inputTokens: 80_000 },
          keep: 5,
          clearAtLeast: 10_000,
          excludeTools: ["memory"],
          clearToolInputs: ["search"],
        },
        clearThinking: { keep: 2 },
      },
    });

    expect(built.endpoint).toBe("beta.messages");
    expect(built.betas).toEqual(["context-management-2025-06-27"]);
    expect(built.body.context_management).toEqual({
      edits: [
        { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
        {
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 80_000 },
          keep: { type: "tool_uses", value: 5 },
          clear_at_least: { type: "input_tokens", value: 10_000 },
          exclude_tools: ["memory"],
          clear_tool_inputs: ["search"],
        },
      ],
    });
  });

  it("uses API defaults for `true`, a tool-use trigger and keep all thinking", () => {
    expect(request({ contextManagement: { clearToolUses: true } }).body.context_management).toEqual(
      { edits: [{ type: "clear_tool_uses_20250919" }] },
    );
    expect(
      request({
        contextManagement: {
          clearToolUses: { trigger: { toolUses: 30 } },
          clearThinking: { keep: "all" },
        },
      }).body.context_management,
    ).toEqual({
      edits: [
        { type: "clear_thinking_20251015", keep: "all" },
        { type: "clear_tool_uses_20250919", trigger: { type: "tool_uses", value: 30 } },
      ],
    });
  });

  it("adds server-side compaction with its own beta, last in the edits", () => {
    expect(request({ serverCompaction: true }).body.context_management).toEqual({
      edits: [{ type: "compact_20260112" }],
    });

    const built = request({
      betas: ["compact-2026-01-12", "server-side-fallback-2026-07-01"],
      serverCompaction: { triggerTokens: 120_000, instructions: "Keep file paths." },
      contextManagement: { clearToolUses: true },
    });

    expect(built.betas).toEqual([
      "compact-2026-01-12",
      "server-side-fallback-2026-07-01",
      "context-management-2025-06-27",
    ]);
    expect(built.body.context_management).toEqual({
      edits: [
        { type: "clear_tool_uses_20250919" },
        {
          type: "compact_20260112",
          trigger: { type: "input_tokens", value: 120_000 },
          instructions: "Keep file paths.",
        },
      ],
    });
  });

  it("sends nothing extra when the options are off", () => {
    const built = request({ serverCompaction: false, contextManagement: {} });

    expect(built.endpoint).toBe("messages");
    expect(built.body).not.toHaveProperty("context_management");
  });

  it("rejects invalid values and a second context_management in body", () => {
    expect(() => request({ serverCompaction: { triggerTokens: 10_000 } })).toThrow(
      /at least 50000/,
    );
    expect(() => request({ contextManagement: { clearThinking: { keep: 0 } } })).toThrow(
      InvalidRequestError,
    );
    expect(() => request({ contextManagement: { clearToolUses: { keep: -1 } } })).toThrow(/keep/);
    expect(() =>
      request({
        serverCompaction: true,
        body: { context_management: { edits: [] } },
      }),
    ).toThrow(/cannot be combined/);
  });
});

describe("usage with server-side compaction", () => {
  const iterations = [
    {
      type: "compaction",
      input_tokens: 180_000,
      output_tokens: 3_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
    },
    {
      type: "message",
      input_tokens: 23_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
    },
  ];

  it("adds compaction iterations to the totals of a completion", async () => {
    const client = makeClient({
      message: {
        usage: {
          input_tokens: 23_000,
          output_tokens: 1_000,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: 500,
          iterations,
        } as unknown as Anthropic.Usage,
      },
    });
    const response = await new AnthropicModel(client, { name: "claude-opus-5-5" }).complete(
      [{ role: "user", content: "hi" }],
      { providerOptions: { anthropic: { serverCompaction: true } } },
    );

    expect(response.usage).toEqual({
      input: 203_000,
      output: 4_000,
      total: 207_000,
      cachedTokens: 500,
      inputIncludesCache: false,
      cost: expect.any(Object),
    });
  });

  it("adds them from the final message_delta of a stream", async () => {
    const client = makeClient({
      streamEvents: [
        {
          type: "message_start",
          message: { usage: { input_tokens: 23_000, output_tokens: 0 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1_000, iterations },
        },
      ],
    });
    const chunks: Array<{ type: string; usage?: unknown }> = [];

    for await (const chunk of new AnthropicModel(client, { name: "claude-opus-5-5" }).stream([
      { role: "user", content: "hi" },
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)?.usage).toEqual({
      input: 203_000,
      output: 4_000,
      total: 207_000,
      inputIncludesCache: false,
      cost: expect.any(Object),
    });
  });
});

const signedTurn: Message = {
  role: "assistant",
  content: "",
  toolCalls: [{ id: "tu_1", name: "lookup", input: {} }],
  blocks: [
    {
      provider: "anthropic",
      type: "thinking",
      data: { type: "thinking", thinking: "", signature: "sig" },
    },
    {
      provider: "anthropic",
      type: "tool_use",
      data: { type: "tool_use", id: "tu_1", name: "lookup", input: {} },
    },
  ] satisfies ProviderContentBlock[],
};

const compacted: Message[] = [
  { role: "user", content: "task" },
  { role: "user", content: "Summary of earlier conversation:\nmemo", compaction: "summary" },
  { ...signedTurn, compaction: "retained" },
  { role: "tool", toolCallId: "tu_1", content: "42" },
];

function assistantContent(built: { body: Record<string, unknown> }) {
  const messages = built.body.messages as Anthropic.MessageParam[];

  return messages.find((message) => message.role === "assistant")?.content;
}

describe("preserved thinking after client-side compaction", () => {
  it("replays a retained turn without its thinking on models that check the conversation", () => {
    const built = request({}, { reasoning: { effort: "high" } }, {}, compacted);

    expect(assistantContent(built)).toEqual([
      { type: "tool_use", id: "tu_1", name: "lookup", input: {} },
    ]);
  });

  it("keeps the thinking on models without the check, and on unmarked turns", () => {
    for (const name of ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-4-6"]) {
      const built = request({}, { reasoning: { effort: "high" } }, { name }, compacted);

      expect((assistantContent(built) as Array<{ type: string }>)[0]?.type).toBe("thinking");
    }

    const unmarked = request({}, {}, {}, [
      { role: "user", content: "task" },
      signedTurn,
      { role: "tool", toolCallId: "tu_1", content: "42" },
    ]);
    expect((assistantContent(unmarked) as Array<{ type: string }>)[0]?.type).toBe("thinking");
  });

  it("honors the preservedThinking override", () => {
    const kept = request({}, {}, { preservedThinking: false }, compacted);
    const dropped = request(
      {},
      {},
      { name: "my-gateway-model", preservedThinking: true },
      compacted,
    );

    expect((assistantContent(kept) as Array<{ type: string }>)[0]?.type).toBe("thinking");
    expect((assistantContent(dropped) as Array<{ type: string }>)[0]?.type).toBe("tool_use");
  });

  it("drops thinking stored on tool-call metadata too", () => {
    const legacy: Message[] = [
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "",
        compaction: "retained",
        toolCalls: [
          {
            id: "tu_1",
            name: "lookup",
            input: {},
            providerMetadata: {
              anthropic: { thinkingBlocks: [{ type: "thinking", thinking: "", signature: "s" }] },
            },
          },
        ],
      },
      { role: "tool", toolCallId: "tu_1", content: "42" },
    ];

    expect(assistantContent(request({}, {}, {}, legacy))).toEqual([
      { type: "tool_use", id: "tu_1", name: "lookup", input: {} },
    ]);
  });

  it("thinkingBlockBinding lets the API decide: block_binding, the beta, blocks kept", () => {
    const built = request(
      { thinkingBlockBinding: "drop_block" },
      { reasoning: { effort: "high" } },
      {},
      compacted,
    );

    expect(built.betas).toEqual(["thinking-binding-controls-2026-08-01"]);
    expect(built.body.thinking).toEqual({
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    expect((assistantContent(built) as Array<{ type: string }>)[0]?.type).toBe("thinking");
  });

  it("sends adaptive thinking explicitly for block binding when thinking is omitted on a preserved-thinking model", () => {
    expect(request({ thinkingBlockBinding: "error" }).body.thinking).toEqual({
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "error" },
    });
  });

  it("skips block binding when the request's thinking cannot carry it", () => {
    const off = request(
      { thinkingBlockBinding: "drop_block" },
      { reasoning: { effort: "none" } },
      { name: "claude-sonnet-5-5" },
    );
    expect(off.body.thinking).toEqual({ type: "between_tools" });
    expect(off.betas).toEqual([]);

    const omitted = request(
      { thinkingBlockBinding: "drop_block" },
      {},
      { name: "claude-opus-4-8" },
    );
    expect(omitted.body).not.toHaveProperty("thinking");
  });

  it("infers which models run the conversation check", () => {
    expect(
      Object.fromEntries(
        [
          "claude-fable-5-1",
          "claude-opus-5-5",
          "claude-sonnet-5-5",
          "claude-haiku-5-5",
          "anthropic.claude-opus-5-5",
          "claude-opus-5-5-20261001",
          "claude-mythos-5-1",
          "claude-fable-5",
          "claude-opus-5",
          "claude-sonnet-5",
          "claude-opus-4-8",
          "claude-haiku-4-5",
          "claude-3-7-sonnet-latest",
          "claude-opus-9",
        ].map((name) => [name, inferPreservedThinking(name)]),
      ),
    ).toEqual({
      "claude-fable-5-1": true,
      "claude-opus-5-5": true,
      "claude-sonnet-5-5": true,
      "claude-haiku-5-5": true,
      "anthropic.claude-opus-5-5": true,
      "claude-opus-5-5-20261001": true,
      "claude-mythos-5-1": false,
      "claude-fable-5": false,
      "claude-opus-5": false,
      "claude-sonnet-5": false,
      "claude-opus-4-8": false,
      "claude-haiku-4-5": false,
      "claude-3-7-sonnet-latest": false,
      "claude-opus-9": true,
    });
  });
});
