import { describe, expect, it } from "vitest";
import { agent } from "../agent/agent";
import { MockSDK } from "../mock/mock-sdk";
import { isToolResultContent, toolResultText, TOOL_RESULT_IMAGE_PLACEHOLDER } from "./tool-result-content";
import { tool } from "./tool";
import type { StandardSchemaV1 } from "@standard-schema/spec";

const png = { type: "image", source: { base64: "AAAA", mediaType: "image/png" } } as const;

const anyInput: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: (value ?? {}) as Record<string, unknown> }),
  },
};

describe("isToolResultContent", () => {
  it("accepts an object whose only key is a non-empty array of valid parts", () => {
    expect(isToolResultContent({ content: [{ type: "text", text: "hi" }, png] })).toBe(true);
  });

  it("rejects ordinary objects that happen to have a content key", () => {
    expect(isToolResultContent({ content: [png], extra: 1 })).toBe(false);
    expect(isToolResultContent({ content: "text" })).toBe(false);
    expect(isToolResultContent({ content: [] })).toBe(false);
    expect(isToolResultContent({ content: [{ type: "text" }] })).toBe(false);
    expect(
      isToolResultContent({ content: [{ type: "image", source: { base64: "A", mediaType: "image/bmp" } }] }),
    ).toBe(false);
    expect(isToolResultContent([png])).toBe(false);
    expect(isToolResultContent(null)).toBe(false);
  });
});

describe("toolResultText", () => {
  it("joins text and replaces images with the placeholder", () => {
    expect(toolResultText([{ type: "text", text: "a" }, png])).toBe(
      `a\n${TOOL_RESULT_IMAGE_PLACEHOLDER}`,
    );
    expect(toolResultText("plain")).toBe("plain");
  });
});

describe("agent tool result content", () => {
  it("carries content parts on the tool message and keeps JSON for plain values", async () => {
    const shot = tool({
      name: "shot",
      description: "screenshot",
      input: anyInput,
      async execute() {
        return { content: [{ type: "text" as const, text: "ok" }, png] };
      },
    });
    const plain = tool({
      name: "plain",
      description: "plain",
      input: anyInput,
      async execute() {
        return { content: "not parts", other: 1 };
      },
    });

    const model = MockSDK({
      responses: [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            { id: "c1", name: "shot", input: {} },
            { id: "c2", name: "plain", input: {} },
          ],
        },
        { content: "done", finishReason: "stop" },
      ],
    }).model({ name: "mock" });
    const result = await agent({ model, tools: [shot, plain] }).execute("go");

    expect(result.error).toBeUndefined();

    const secondCall = model.callHistory[1]!;
    const toolMessages = secondCall.messages.filter((message) => message.role === "tool");

    expect(toolMessages[0]?.content).toEqual([{ type: "text", text: "ok" }, png]);
    expect(toolMessages[1]?.content).toBe(JSON.stringify({ content: "not parts", other: 1 }));
  });
});
