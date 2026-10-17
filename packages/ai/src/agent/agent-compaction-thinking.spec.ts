import type {
  Message,
  ModelCallOptions,
  ModelContract,
  ModelResponse,
  ProviderContentBlock,
} from "../contracts";
import { tool } from "../tool/tool";
import { describe, expect, it, vi } from "vitest";
import { agent } from "./agent";
import { summarizeCompaction } from "./compaction-summarizer";

const thinking = (signature: string): ProviderContentBlock[] => [
  { provider: "anthropic", type: "thinking", data: { type: "thinking", thinking: "", signature } },
  {
    provider: "anthropic",
    type: "tool_use",
    data: { type: "tool_use", id: `call-${signature}`, name: "echo", input: {} },
  },
];

function toolTrip(signature: string): Partial<ModelResponse> {
  return {
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: `call-${signature}`, name: "echo", input: {} }],
    blocks: thinking(signature),
  };
}

function scriptedModel(responses: Partial<ModelResponse>[]) {
  const calls: Message[][] = [];
  function respond(messages: Message[]): ModelResponse {
    const index = calls.length;
    calls.push(structuredClone(messages));
    return {
      content: "done",
      finishReason: "stop",
      usage: { input: 1, output: 1, total: 2 },
      ...responses[index],
    };
  }
  const model: ModelContract = {
    name: "mock",
    provider: "mock",
    complete: async (messages) => respond(messages),
    async *stream(messages) {
      const response = respond(messages);
      if (response.content) yield { type: "delta", content: response.content };
      for (const call of response.toolCalls ?? []) yield { type: "tool-call", ...call };
      yield {
        type: "done",
        finishReason: response.finishReason,
        usage: response.usage,
        blocks: response.blocks,
      };
    },
  };
  return { model, calls };
}

const echo = tool({ name: "echo", description: "echo", execute: async () => "result" });

/** One "token" per message keeps the threshold arithmetic readable. */
const countMessages = (messages: Message[]) => messages.length * 100;

describe("agent compaction with signed thinking", () => {
  for (const mode of ["execute", "stream"] as const) {
    it(`summarizes before the open tool round and replays that round's thinking intact (${mode})`, async () => {
      const { model, calls } = scriptedModel([
        toolTrip("t0"),
        toolTrip("t1"),
        { content: "final", finishReason: "stop", blocks: thinking("t2").slice(0, 1) },
      ]);
      const summarize = vi.fn((history: Message[]) => ({
        summary: { role: "assistant" as const, content: "first round done" },
        replacesFromIndex: 0,
        replacesToIndex: history.length - 1,
      }));
      const worker = agent({
        model,
        tools: [echo],
        captureMessages: true,
        compaction: { afterTokens: 350, keep: 1, summarize, countTokens: countMessages },
      });
      const result =
        mode === "execute" ? await worker.execute("task") : await worker.stream("task").result;

      expect(result.error).toBeUndefined();
      expect(result.report.compactions).toEqual([
        expect.objectContaining({
          type: "applied",
          tripIndex: 2,
          compaction: expect.objectContaining({ replacesFromIndex: 1, replacesToIndex: 2 }),
        }),
      ]);

      // The summarizer sees the settled first round, signed blocks included.
      const slice = summarize.mock.calls[0]?.[0] ?? [];
      expect(slice.map((message) => message.role)).toEqual(["assistant", "tool"]);
      expect(slice[0]?.blocks).toEqual(thinking("t0"));

      // The third request: input, user-framed summary, then the open round verbatim.
      const sent = calls[2] ?? [];
      expect(sent).toHaveLength(4);
      expect(sent[0]).toEqual({ role: "user", content: "task" });
      expect(sent[1]).toEqual({
        role: "user",
        content: "Summary of earlier conversation:\nfirst round done",
        compaction: "summary",
      });
      expect(sent[2]).toMatchObject({
        role: "assistant",
        blocks: thinking("t1"),
        toolCalls: [{ id: "call-t1" }],
        compaction: "retained",
      });
      expect(sent[3]).toMatchObject({ role: "tool", toolCallId: "call-t1" });

      // The captured transcript keeps the markers for later replay.
      expect(result.report.messages?.map((message) => message.compaction)).toEqual([
        undefined,
        "summary",
        "retained",
        undefined,
      ]);
    });
  }

  it("works with the built-in summarizer", async () => {
    const { model, calls } = scriptedModel([
      toolTrip("t0"),
      toolTrip("t1"),
      { content: "final", finishReason: "stop" },
    ]);
    const summaryModel: ModelContract = {
      name: "summary",
      provider: "mock",
      complete: vi.fn(async (_messages: Message[], _options?: ModelCallOptions) => ({
        content: "<summary>Called echo once; it returned result.</summary>",
        finishReason: "stop" as const,
        usage: { input: 5, output: 5, total: 10 },
      })),
      async *stream() {
        yield { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
      },
    };
    const result = await agent({
      model,
      tools: [echo],
      compaction: {
        afterTokens: 350,
        keep: 1,
        countTokens: countMessages,
        summarize: summarizeCompaction({ model: summaryModel }),
      },
    }).execute("task");

    expect(result.report.compactions?.[0]?.type).toBe("applied");
    expect(calls[2]?.[1]?.content).toBe(
      "Summary of earlier conversation:\nCalled echo once; it returned result.",
    );
    // The summary model's usage is not billed to the agent run.
    expect(result.usage.total).toBe(6);
  });
});
