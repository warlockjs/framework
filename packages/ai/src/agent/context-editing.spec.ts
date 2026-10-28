import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import { AgentExecutionError } from "../errors";
import { MockSDK } from "../mock/mock-sdk";
import { tool } from "../tool/tool";
import { agent } from "./agent";
import { clearOldToolResults } from "./context-editing";
import { DEFAULT_CLEARED_TOOL_RESULT } from "./context-editing.type";

const anyInput: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: (value ?? {}) as Record<string, unknown> }),
  },
};

function history(count: number): Message[] {
  const messages: Message[] = [{ role: "user", content: "go" }];

  for (let index = 0; index < count; index++) {
    messages.push(
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: `c${index}`, name: index % 2 ? "plan" : "read", input: {} }],
      },
      { role: "tool", toolCallId: `c${index}`, content: `result-${index}-${"x".repeat(200)}` },
    );
  }

  return messages;
}

describe("clearOldToolResults", () => {
  it("keeps the newest results and replaces older ones in place", async () => {
    const messages = history(5);

    const record = await clearOldToolResults({ keep: 2 }, messages, {}, 3);
    const tools = messages.filter((message) => message.role === "tool");

    expect(record).toMatchObject({ tripIndex: 3, clearedResults: 3 });
    expect(tools.map((message) => message.content)).toEqual([
      DEFAULT_CLEARED_TOOL_RESULT,
      DEFAULT_CLEARED_TOOL_RESULT,
      DEFAULT_CLEARED_TOOL_RESULT,
      expect.stringContaining("result-3"),
      expect.stringContaining("result-4"),
    ]);
    // Every call still has its result, so pairing stays valid.
    expect(tools.map((message) => message.toolCallId)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("skips excluded tools and a custom placeholder applies", async () => {
    const messages = history(4);

    await clearOldToolResults(
      { keep: 1, exclude: ["plan"], placeholder: "[gone]" },
      messages,
      {},
      0,
    );

    const tools = messages.filter((message) => message.role === "tool");

    expect(tools.map((message) => message.content)).toEqual([
      "[gone]",
      expect.stringContaining("result-1"),
      "[gone]",
      expect.stringContaining("result-3"),
    ]);
  });

  it("waits for afterTokens", async () => {
    const messages = history(5);

    expect(
      await clearOldToolResults({ keep: 1, afterTokens: 100_000 }, messages, {}, 0),
    ).toBeUndefined();
    expect(messages.some((message) => message.content === DEFAULT_CLEARED_TOOL_RESULT)).toBe(false);

    const record = await clearOldToolResults({ keep: 1, afterTokens: 50 }, messages, {}, 0);

    expect(record?.clearedResults).toBe(4);
  });

  it("uses a custom token counter", async () => {
    const messages = history(3);
    const never = await clearOldToolResults(
      { keep: 0, afterTokens: 10, countTokens: () => 5 },
      messages,
      {},
      0,
    );
    const always = await clearOldToolResults(
      { keep: 0, afterTokens: 10, countTokens: () => 50 },
      messages,
      {},
      0,
    );

    expect(never).toBeUndefined();
    expect(always?.clearedResults).toBe(3);
  });

  it("does nothing a second time", async () => {
    const messages = history(4);

    await clearOldToolResults({ keep: 1 }, messages, {}, 0);

    expect(await clearOldToolResults({ keep: 1 }, messages, {}, 1)).toBeUndefined();
  });
});

describe("agent contextEditing", () => {
  function lookup() {
    return tool<Record<string, unknown>, string>({
      name: "lookup",
      description: "Looks something up.",
      input: anyInput,
      execute: async () => "big-result-".repeat(40),
    });
  }

  function script() {
    return MockSDK({
      responses: [
        ...[1, 2, 3, 4].map((id) => ({
          content: "",
          toolCalls: [{ id: `t${id}`, name: "lookup", input: {} }],
        })),
        { content: "done" },
      ],
    });
  }

  it("clears old tool results client-side before later trips", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({
      model,
      tools: [lookup()],
      contextEditing: { clearToolResults: { keep: 1 } },
    }).execute("go");

    expect(result.error).toBeUndefined();

    const lastCall = model.callHistory.at(-1)!;
    const sent = lastCall.messages.filter((message) => message.role === "tool");

    expect(sent).toHaveLength(4);
    expect(sent.slice(0, 3).every((m) => m.content === DEFAULT_CLEARED_TOOL_RESULT)).toBe(true);
    expect(sent[3]?.content).toContain("big-result-");
    expect(lastCall.options?.contextEditing).toBeUndefined();
  });

  it("passes the rule to a model with native support instead of editing", async () => {
    const model = MockSDK({
      capabilities: { nativeContextEditing: true },
      responses: [
        { content: "", toolCalls: [{ id: "t1", name: "lookup", input: {} }] },
        { content: "", toolCalls: [{ id: "t2", name: "lookup", input: {} }] },
        { content: "done" },
      ],
    }).model({ name: "m" });

    await agent({
      model,
      tools: [lookup()],
      contextEditing: { clearToolResults: { keep: 1, afterTokens: 500, exclude: ["plan"] } },
    }).execute("go");

    const lastCall = model.callHistory.at(-1)!;

    expect(lastCall.options?.contextEditing).toEqual({
      clearToolResults: { keep: 1, afterTokens: 500, exclude: ["plan"] },
    });
    expect(
      lastCall.messages
        .filter((m) => m.role === "tool")
        .every((m) => String(m.content).includes("big-result-")),
    ).toBe(true);
  });

  it("native: false edits on the client even when the model supports it", async () => {
    const model = MockSDK({
      capabilities: { nativeContextEditing: true },
      responses: [
        { content: "", toolCalls: [{ id: "t1", name: "lookup", input: {} }] },
        { content: "", toolCalls: [{ id: "t2", name: "lookup", input: {} }] },
        { content: "done" },
      ],
    }).model({ name: "m" });

    await agent({
      model,
      tools: [lookup()],
      contextEditing: { native: false, clearToolResults: { keep: 1 } },
    }).execute("go");

    const lastCall = model.callHistory.at(-1)!;

    expect(lastCall.options?.contextEditing).toBeUndefined();
    expect(lastCall.messages.find((m) => m.role === "tool")?.content).toBe(
      DEFAULT_CLEARED_TOOL_RESULT,
    );
  });

  it("rejects an invalid rule when the agent is created", () => {
    const model = MockSDK({ responses: [{ content: "x" }] }).model({ name: "m" });

    expect(() => agent({ model, contextEditing: { clearToolResults: { keep: -1 } } })).toThrow(
      AgentExecutionError,
    );
  });
});
