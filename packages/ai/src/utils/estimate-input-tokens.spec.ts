import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ToolConfig } from "../contracts/tool.contract";
import { countInputTokens, estimateInputTokens, toolSchemaJson } from "./estimate-input-tokens";

function schemaOf(jsonSchema: Record<string, unknown>): StandardSchemaV1<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  } as unknown as StandardSchemaV1<unknown>;
}

const searchTool: ToolConfig<unknown, unknown> = {
  name: "search",
  description: "Search the catalog",
  input: schemaOf({ type: "object", properties: { query: { type: "string" } } }),
  execute: async () => "ok",
};

describe("estimateInputTokens", () => {
  it("counts text at 4 characters per token plus a per-message allowance", () => {
    const messages: Message[] = [
      { role: "system", content: "a".repeat(40) },
      { role: "user", content: [{ type: "text", text: "b".repeat(40) }] },
    ];

    expect(estimateInputTokens(messages)).toBe(20 + 2 * 4);
    expect(estimateInputTokens(messages, { charsPerToken: 2, perMessageTokens: 0 })).toBe(40);
  });

  it("charges a fixed allowance per attachment instead of reading base64 length", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { base64: "x".repeat(100_000), mediaType: "image/png" } },
          { type: "pdf", source: { url: "https://example.com/a.pdf" } },
        ],
      },
    ];

    expect(estimateInputTokens(messages, { perMessageTokens: 0 })).toBe(2_000);
    expect(estimateInputTokens(messages, { perMessageTokens: 0, attachmentTokens: 10 })).toBe(20);
  });

  it("includes tool-call arguments, tool schemas and the response schema", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "search", input: { query: "warlock" } }],
      },
    ];
    const responseSchema = { type: "object", properties: { answer: { type: "string" } } };
    const expectedChars =
      "search".length +
      JSON.stringify({ query: "warlock" }).length +
      toolSchemaJson(searchTool).length +
      JSON.stringify(responseSchema).length;

    expect(
      estimateInputTokens(messages, {
        tools: [searchTool],
        responseSchema,
        perMessageTokens: 0,
        charsPerToken: 1,
      }),
    ).toBe(expectedChars);
  });

  it("ignores invalid tuning values", () => {
    const messages: Message[] = [{ role: "user", content: "abcd" }];

    expect(estimateInputTokens(messages, { charsPerToken: 0, perMessageTokens: -1 })).toBe(1 + 4);
  });
});

describe("countInputTokens", () => {
  const messages: Message[] = [{ role: "user", content: "hello world!" }];

  it("uses the model's native count when it has one", async () => {
    const countTokens = vi.fn(async () => 42);

    const result = await countInputTokens({ countTokens }, messages, { tools: [searchTool] });

    expect(result).toEqual({ tokens: 42, source: "native" });
    expect(countTokens).toHaveBeenCalledWith(messages, { tools: [searchTool] });
  });

  it("falls back to the estimate, flagged as such", async () => {
    const result = await countInputTokens({}, messages, { estimate: { perMessageTokens: 0 } });

    expect(result).toEqual({ tokens: 3, source: "estimate" });
  });
});
