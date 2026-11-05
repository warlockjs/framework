import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ToolConfig } from "../contracts/tool.contract";
import { MockSDK } from "../mock/mock-sdk";
import { tool } from "../tool/tool";
import { agent } from "./agent";
import { computePromptFingerprint, PromptFingerprintTracker } from "./prompt-fingerprint";

const anyInput: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: (value ?? {}) as Record<string, unknown> }),
  },
};

const messages: Message[] = [
  { role: "system", content: "You are a coach." },
  { role: "user", content: "hi" },
];

const toolFor = (description: string) =>
  ({ name: "lookup", description, input: anyInput }) as unknown as ToolConfig<unknown, unknown>;

describe("computePromptFingerprint", () => {
  it("is equal for an identical prefix", () => {
    const tools = [toolFor("Finds things.")];

    expect(computePromptFingerprint(messages, { tools })).toEqual(
      computePromptFingerprint([...messages], { tools: [toolFor("Finds things.")] }),
    );
  });

  it("changes only `tools` when one tool description changes", () => {
    const before = computePromptFingerprint(messages, { tools: [toolFor("Finds things.")] });
    const after = computePromptFingerprint(messages, { tools: [toolFor("Finds more things.")] });

    expect(after.system).toBe(before.system);
    expect(after.messagesPrefix).toBe(before.messagesPrefix);
    expect(after.tools).not.toBe(before.tools);
  });

  it("changes only `system` when the system prompt changes", () => {
    const before = computePromptFingerprint(messages);
    const after = computePromptFingerprint([{ role: "system", content: "Other." }, messages[1]!]);

    expect(after.system).not.toBe(before.system);
    expect(after.tools).toBe(before.tools);
    expect(after.messagesPrefix).toBe(before.messagesPrefix);
  });

  it("limits the prefix hash to the first N messages", () => {
    const longer = [...messages, { role: "assistant", content: "hello" } as Message];

    expect(computePromptFingerprint(longer, undefined, 1).messagesPrefix).toBe(
      computePromptFingerprint(messages).messagesPrefix,
    );
  });
});

describe("PromptFingerprintTracker", () => {
  const run = (tracker: PromptFingerprintTracker, list: Message[], cachedTokens: number) => {
    tracker.begin(list, {});

    return tracker.finish({ input: 10, output: 1, total: 11, cachedTokens });
  };

  it("does not report a miss on a cold first trip", () => {
    const outcome = run(new PromptFingerprintTracker("m"), messages, 0);

    expect(outcome?.cacheMiss).toBeUndefined();
    expect(outcome?.fingerprint.system).toBeTypeOf("string");
  });

  it("names `system` when the system prompt differs and the cache was lost", () => {
    const tracker = new PromptFingerprintTracker("m");

    run(tracker, messages, 1000);

    const outcome = run(tracker, [{ role: "system", content: "Other." }, messages[1]!], 0);

    expect(outcome?.cacheMiss).toEqual({
      segments: ["system"],
      cachedTokens: 0,
      expectedCachedTokens: 1000,
    });
  });

  it("names `messages` when earlier history was rewritten", () => {
    const tracker = new PromptFingerprintTracker("m");

    run(tracker, messages, 1000);

    const outcome = run(tracker, [messages[0]!, { role: "user", content: "changed" }], 0);

    expect(outcome?.cacheMiss?.segments).toEqual(["messages"]);
  });

  it("stays quiet when the cache was kept, or when nothing changed", () => {
    const tracker = new PromptFingerprintTracker("m");

    run(tracker, messages, 1000);
    expect(run(tracker, messages, 900)?.cacheMiss).toBeUndefined();
    expect(run(tracker, messages, 0)?.cacheMiss).toBeUndefined();
  });
});

describe("agent diagnostics.cacheFingerprint", () => {
  const lookup = (description: string) =>
    tool<Record<string, unknown>, { ok: boolean }>({
      name: "lookup",
      description,
      input: anyInput,
      execute: async () => ({ ok: true }),
    });

  const responses = [
    {
      content: "calling",
      toolCalls: [{ id: "c1", name: "lookup", input: {} }],
      usage: { input: 10, output: 2, cachedTokens: 1000 },
    },
    { content: "done", finishReason: "stop" as const, usage: { input: 10, output: 2 } },
  ];

  it("is off by default", async () => {
    const result = await agent({
      model: MockSDK({ responses }).model({ name: "m" }),
      tools: [lookup("Finds things.")],
    }).execute("hi");

    expect(result.report.promptFingerprint).toBeUndefined();
    expect(result.report.trips[0]?.promptFingerprint).toBeUndefined();
  });

  it("records a fingerprint per trip and reports the last on the report", async () => {
    const onMiss = vi.fn();
    const result = await agent({
      model: MockSDK({ responses }).model({ name: "m" }),
      tools: [lookup("Finds things.")],
      diagnostics: { cacheFingerprint: true },
      on: { "agent.trip.cache-miss-cause": onMiss },
    }).execute("hi");

    const [first, second] = result.report.trips;

    expect(first?.promptFingerprint?.tools).toBe(second?.promptFingerprint?.tools);
    expect(result.report.promptFingerprint).toEqual(second?.promptFingerprint);
    expect(onMiss).not.toHaveBeenCalled();
  });

  it("emits agent.trip.cache-miss-cause naming the rewritten history", async () => {
    const onMiss = vi.fn();

    await agent({
      model: MockSDK({ responses }).model({ name: "m" }),
      tools: [lookup("Finds things.")],
      diagnostics: { cacheFingerprint: true },
      middleware: [
        {
          name: "rewrite",
          trip: {
            before(context) {
              if (context.tripIndex === 1) {
                (context.messages as Message[]).splice(0, 1, { role: "user", content: "rewritten" });
              }

              return undefined;
            },
          },
        },
      ],
      on: { "agent.trip.cache-miss-cause": onMiss },
    }).execute("hi");

    expect(onMiss).toHaveBeenCalledTimes(1);
    expect(onMiss.mock.calls[0]![0]).toMatchObject({
      tripIndex: 1,
      segments: ["messages"],
      cachedTokens: 0,
      expectedCachedTokens: 1000,
    });
  });
});
