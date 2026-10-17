import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  Message,
  ModelCallOptions,
  ModelContract,
  ModelResponse,
  AgentSnapshot,
  CompactionResult,
} from "../contracts";
import { AgentDriftError, AgentExecutionError } from "../errors";
import { memory as snapshotMemory } from "../snapshot/memory";
import { tool } from "../tool/tool";
import { describe, expect, it, vi } from "vitest";
import { agent } from "./agent";
import type { AgentCompactionConfig } from "./compaction.type";

function summarize(history: Message[]): CompactionResult {
  return {
    summary: { role: "assistant", content: "memo" },
    replacesFromIndex: 0,
    replacesToIndex: history.length - 1,
  };
}

const history: Message[] = [
  { role: "user", content: "old request ".repeat(100) },
  { role: "assistant", content: "old reply ".repeat(100) },
  { role: "user", content: "more history ".repeat(100) },
  { role: "assistant", content: "more reply ".repeat(100) },
];

function modelFixture(responses?: Partial<ModelResponse>[]) {
  const calls: { messages: Message[]; options?: ModelCallOptions }[] = [];
  const scripted = responses ?? [{ content: "done", finishReason: "stop" }];
  function respond(messages: Message[], options?: ModelCallOptions): ModelResponse {
    const index = calls.length;
    calls.push({ messages: structuredClone(messages), options });
    return {
      content: "done",
      finishReason: "stop",
      usage: { input: 10, output: 2, total: 12 },
      ...scripted[index],
    };
  }
  const model: ModelContract = {
    name: "mock",
    provider: "mock",
    complete: async (messages, options) => respond(messages, options),
    async *stream(messages, options) {
      const response = respond(messages, options);
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

const echo = tool({
  name: "echo",
  description: "echo",
  execute: async () => "tool result ".repeat(100),
});
const count = (messages: Message[]) => JSON.stringify(messages).length;

function policy(overrides: Partial<AgentCompactionConfig> = {}): AgentCompactionConfig {
  return { afterTokens: 200, keep: 2, summarize, countTokens: count, ...overrides };
}

describe("agent automatic compaction", () => {
  it("is disabled by default and does not change reports or messages below threshold", async () => {
    const { model, calls } = modelFixture();
    const disabled = await agent({ model }).execute("go", { history });
    expect(disabled.report).not.toHaveProperty("compactions");
    expect(calls[0]?.messages).toEqual([...history, { role: "user", content: "go" }]);
    const summarizeSpy = vi.fn(summarize);
    const below = await agent({
      model,
      compaction: policy({ afterTokens: 1_000_000, summarize: summarizeSpy }),
    }).execute("go", { history });
    expect(below.report).not.toHaveProperty("compactions");
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it("compacts old history and preserves system/current input, exact generation options and caller history", async () => {
    const { model, calls } = modelFixture();
    const input = structuredClone(history);
    const countTokens = vi.fn((messages: Message[], options: ModelCallOptions) => {
      expect(options.tools?.map((item) => item.name)).toEqual(["echo"]);
      expect(options.providerOptions).toEqual({ openai: { body: { top_p: 0.8 } } });
      return count(messages);
    });
    const result = await agent({
      model,
      systemPrompt: "keep rules",
      tools: [echo],
      captureMessages: true,
      modelOptions: { providerOptions: { openai: { body: { top_p: 0.8 } } } },
      compaction: policy({ countTokens }),
    }).execute("current input", { history: input });
    expect(result.error).toBeUndefined();
    expect(input).toEqual(history);
    expect(calls[0]?.messages[0]).toEqual({ role: "system", content: "keep rules" });
    expect(calls[0]?.messages.at(-1)).toEqual({ role: "user", content: "current input" });
    expect(
      calls[0]?.messages.some(
        (message) => typeof message.content === "string" && message.content.endsWith("memo"),
      ),
    ).toBe(true);
    expect(result.report.compactions?.[0]).toMatchObject({
      type: "applied",
      counting: "custom",
      tripIndex: 0,
    });
    expect(
      result.report.messages?.some(
        (message) => typeof message.content === "string" && message.content.endsWith("memo"),
      ),
    ).toBe(true);
    expect(countTokens).toHaveBeenCalledTimes(2);
  });

  for (const mode of ["execute", "stream"] as const) {
    it(`preserves complete parallel tool groups while compacting repeated ${mode} trips`, async () => {
      const group = (prefix: string): Partial<ModelResponse> => ({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          { id: `${prefix}a`, name: "echo", input: {} },
          { id: `${prefix}b`, name: "echo", input: {} },
        ],
      });
      const { model, calls } = modelFixture([
        group("one"),
        group("two"),
        group("three"),
        { content: "done", finishReason: "stop" },
      ]);
      const worker = agent({ model, tools: [echo], compaction: policy(), maxTrips: 5 });
      const run =
        mode === "execute"
          ? await worker.execute("keep input")
          : await worker.stream("keep input").result;
      expect(run.error).toBeUndefined();
      expect(calls).toHaveLength(4);
      for (const call of calls) {
        expect(call.messages.find((message) => message.role === "user")?.content).toBe(
          "keep input",
        );
        const ids = new Set(
          call.messages.flatMap((message) => message.toolCalls?.map((request) => request.id) ?? []),
        );
        const results = new Set(
          call.messages
            .filter((message) => message.role === "tool")
            .map((message) => message.toolCallId),
        );
        expect(results).toEqual(ids);
      }
      expect(
        run.report.compactions?.filter((entry) => entry.type === "applied").length,
      ).toBeGreaterThanOrEqual(2);
      expect(run.report.trips).toHaveLength(4);
      expect(run.usage.total).toBe(48);
    });
  }

  it("marks the offline threshold as an estimate including schemas and does not guess model windows", async () => {
    const { model } = modelFixture();
    const summarizeSpy = vi.fn(summarize);
    const result = await agent({
      model,
      tools: [echo],
      compaction: { afterTokens: 10, keep: 1, summarize: summarizeSpy },
    }).execute("go", { history });
    expect(result.report.compactions?.[0]).toMatchObject({ type: "applied", counting: "estimate" });
    expect(summarizeSpy.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it("compacts before retained replay data, keeping its blocks/signatures verbatim and marking the turn", async () => {
    for (const replay of [
      {
        blocks: [
          {
            provider: "anthropic",
            type: "thinking",
            data: { type: "thinking", signature: "signed" },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "signed",
            name: "echo",
            input: {},
            providerMetadata: { google: { thoughtSignature: "signed" } },
          },
        ],
      },
    ]) {
      const { model, calls } = modelFixture();
      const summarizeSpy = vi.fn(summarize);
      const retained: Message = { role: "assistant", content: "retained", ...replay };
      const historyWithReplay: Message[] = [
        ...history,
        retained,
        ...(retained.toolCalls
          ? [{ role: "tool" as const, toolCallId: "signed", content: "ok" }]
          : []),
      ];
      const result = await agent({
        model,
        compaction: policy({ keep: 2, summarize: summarizeSpy }),
      }).execute("go", { history: historyWithReplay });
      expect(result.report.compactions?.[0]).toMatchObject({ type: "applied" });
      expect(summarizeSpy).toHaveBeenCalledOnce();
      const sent = calls[0]?.messages ?? [];
      // The summary is user context so the kept assistant turn still leads with its reasoning.
      expect(sent[0]).toEqual({
        role: "user",
        content: "Summary of earlier conversation:\nmemo",
        compaction: "summary",
      });
      expect(sent[1]).toEqual({ ...retained, compaction: "retained" });
      expect(sent.at(-1)).toEqual({ role: "user", content: "go" });
      expect(historyWithReplay[4]).toEqual(retained);
    }
  });

  it("keeps final provider blocks on the trip after compaction and requires the captured transcript for replay", async () => {
    const blocks = [
      {
        provider: "anthropic",
        type: "thinking",
        data: { type: "thinking", signature: "signed against compacted history" },
      },
    ];
    const { model } = modelFixture([{ content: "done", finishReason: "stop", blocks }]);
    const result = await agent({ model, captureMessages: true, compaction: policy() }).execute(
      "go",
      { history },
    );
    expect(result.blocks).toBeUndefined();
    expect(result.report.trips[0]?.blocks).toEqual(blocks);
    expect(
      result.report.messages?.some(
        (message) => typeof message.content === "string" && message.content.endsWith("memo"),
      ),
    ).toBe(true);
  });

  it("skips non-shrinking/invalid summaries and callback/count errors without altering the live input", async () => {
    for (const overrides of [
      {
        summarize: (slice: Message[]) => ({
          ...summarize(slice),
          summary: { role: "assistant" as const, content: "oversized".repeat(5_000) },
        }),
      },
      { summarize: (slice: Message[]) => ({ ...summarize(slice), replacesToIndex: -1 }) },
      {
        summarize: (slice: Message[]) => {
          const first = slice[0];
          if (first) first.content = "mutated";
          throw new Error("summary unavailable");
        },
      },
      {
        countTokens: () => {
          throw new Error("counter unavailable");
        },
      },
      { countTokens: () => Number.NaN },
    ]) {
      const { model, calls } = modelFixture();
      const result = await agent({ model, compaction: policy(overrides) }).execute("go", {
        history,
      });
      expect(result.error).toBeUndefined();
      expect(result.report.compactions?.[0]?.type).toBe("skipped");
      if ("countTokens" in overrides)
        expect(result.report.compactions?.[0]?.inputTokens).toBeUndefined();
      expect(calls[0]?.messages).toEqual([...history, { role: "user", content: "go" }]);
    }
  });

  it("preserves embedded system messages and skips unsafe incomplete tool groups", async () => {
    const cases: Message[][] = [
      [{ role: "user", content: "old" }, { role: "system", content: "pinned system" }, ...history],
      [
        { role: "assistant", content: "", toolCalls: [{ id: "missing", name: "echo", input: {} }] },
        ...history,
      ],
    ];
    for (const prior of cases) {
      const { model, calls } = modelFixture();
      const result = await agent({
        model,
        compaction: policy({ afterTokens: 1, keep: 1 }),
      }).execute("go", { history: prior });
      expect(result.report.compactions?.[0]).toMatchObject({
        type: "skipped",
        reason: "no-safe-range",
      });
      expect(calls[0]?.messages).toEqual([...prior, { role: "user", content: "go" }]);
    }
  });

  it("honors cancellation while the summary callback runs, before generation", async () => {
    const { model, calls } = modelFixture();
    const controller = new AbortController();
    const result = await agent({
      model,
      compaction: policy({
        summarize: (slice, context) => {
          expect(context.signal).toBe(controller.signal);
          controller.abort();
          return summarize(slice);
        },
      }),
    }).execute("go", { history, signal: controller.signal });
    expect(result.error?.code).toBe("AGENT_CANCELLED");
    expect(calls).toHaveLength(0);
  });

  it("stores compaction decisions and the compacted conversation in durable snapshots", async () => {
    const { model, calls } = modelFixture();
    const store = snapshotMemory<AgentSnapshot>();
    const worker = agent({ name: "durable", model, compaction: policy(), durable: { store } });
    const result = await worker.execute("go", { history, runId: "compact-run" });
    const saved = await store.load("compact-run");
    expect(saved?.compactions).toEqual(result.report.compactions);
    expect(
      saved?.messages.some(
        (message) => typeof message.content === "string" && message.content.endsWith("memo"),
      ),
    ).toBe(true);
    const resumed = await worker.resume("compact-run");
    expect(resumed.report.compactions).toEqual(result.report.compactions);
    expect(calls).toHaveLength(1);
    const changed = agent({
      name: "durable",
      model,
      compaction: policy({ afterTokens: 201 }),
      durable: { store },
    });
    await expect(changed.resume("compact-run")).rejects.toThrow(AgentDriftError);
  });

  for (const mode of ["execute", "stream"] as const) {
    it(`preserves the original input when ${mode} enters a repair trip after tool history`, async () => {
      const { model, calls } = modelFixture([
        ...["one", "two", "three"].map((id) => ({
          content: "",
          finishReason: "tool_calls" as const,
          toolCalls: [{ id, name: "echo", input: {} }],
        })),
        { content: "invalid", finishReason: "stop" },
        { content: '{"ok":true}', finishReason: "stop" },
      ]);
      const worker = agent({
        model,
        tools: [echo],
        output: validOutput,
        maxTrips: 6,
        compaction: policy({ countTokens: repairOnlyCount }),
      });
      const result =
        mode === "execute"
          ? await worker.execute("original task verbatim", { repair: { maxAttempts: 1 } })
          : await worker.stream("original task verbatim", { repair: { maxAttempts: 1 } }).result;
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ ok: true });
      expect(
        result.report.compactions?.some(
          (record) => record.type === "applied" && record.tripIndex === 4,
        ),
      ).toBe(true);
      expect(calls[4]?.messages).toContainEqual({
        role: "user",
        content: "original task verbatim",
      });
      expect(calls[4]?.messages.at(-1)?.content).toContain("previous response failed validation");
      expect(calls[4]?.messages.filter((message) => message.role === "tool")).toHaveLength(0);
    });
  }

  it.each(["persisted", "legacy", "missing", "ambiguous"] as const)(
    "preserves input provenance across failed-run resume (%s)",
    async (provenance) => {
      const { model, calls } = modelFixture([
        ...["one", "two", "three"].map((id) => ({
          content: "",
          finishReason: "tool_calls" as const,
          toolCalls: [{ id, name: "echo", input: {} }],
        })),
        { content: "invalid", finishReason: "stop" },
        { content: '{"ok":true}', finishReason: "stop" },
      ]);
      const complete = model.complete.bind(model);
      let interrupted = false;
      model.complete = async (messages, options) => {
        if (!interrupted && calls.length === 3) {
          interrupted = true;
          throw new Error("interrupted before final response");
        }
        return complete(messages, options);
      };
      const store = snapshotMemory<AgentSnapshot>();
      const worker = agent({
        name: "repair-resume",
        model,
        tools: [echo],
        output: validOutput,
        maxTrips: 7,
        durable: { store },
        compaction: policy({
          countTokens: (messages) =>
            calls.length === 0 ? count(messages) : repairOnlyCount(messages),
        }),
      });
      const first = await worker.execute("persisted task", { history, runId: "repair-run" });
      expect(first.error).toBeDefined();
      const saved = (await store.load("repair-run"))!;
      expect(saved.inputMessageIndex).toBe(3); // system, memo, retained history, original input
      expect(saved.messages[saved.inputMessageIndex!]).toEqual({
        role: "user",
        content: "persisted task",
      });
      if (provenance !== "persisted") {
        if (provenance === "missing") saved.messages.splice(saved.inputMessageIndex!, 1);
        if (provenance === "ambiguous")
          saved.messages.splice(
            saved.inputMessageIndex! + 1,
            0,
            structuredClone(saved.messages[saved.inputMessageIndex!]!),
          );
        delete saved.inputMessageIndex;
        await store.save(saved);
      }
      const resumed = await worker.resume("repair-run", { repair: { maxAttempts: 1 } });
      expect(resumed.error).toBeUndefined();
      expect(resumed.data).toEqual({ ok: true });
      if (provenance === "persisted" || provenance === "legacy") {
        expect(calls.at(-1)?.messages).toContainEqual({ role: "user", content: "persisted task" });
        expect(
          resumed.report.compactions?.some(
            (record) => record.type === "applied" && record.tripIndex === 5,
          ),
        ).toBe(true);
      } else {
        expect(resumed.report.compactions?.find((record) => record.tripIndex === 5)).toMatchObject({
          type: "skipped",
          reason: "no-safe-range",
        });
      }
    },
  );

  it("rejects invalid policies at authoring time", () => {
    const { model } = modelFixture();
    for (const afterTokens of [0, -1, Infinity, Number.NaN, 0.5]) {
      expect(() => agent({ model, compaction: policy({ afterTokens }) })).toThrow(
        AgentExecutionError,
      );
    }
    for (const keep of [0, -1, Infinity, 0.5]) {
      expect(() => agent({ model, compaction: policy({ keep }) })).toThrow(AgentExecutionError);
    }
    for (const invalid of [
      { ...policy(), summarize: undefined },
      { ...policy(), countTokens: 3 },
    ]) {
      expect(() =>
        agent({ model, compaction: invalid as unknown as AgentCompactionConfig }),
      ).toThrow(AgentExecutionError);
    }
  });
});

const validOutput: StandardSchemaV1<{ ok: true }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      return value && typeof value === "object" && "ok" in value && value.ok === true
        ? { value: { ok: true } }
        : { issues: [{ message: "expected ok" }] };
    },
  },
};

function repairOnlyCount(messages: Message[]): number {
  const latest = messages.at(-1);
  return latest?.role === "user" &&
    typeof latest.content === "string" &&
    latest.content.includes("previous response failed validation")
    ? count(messages)
    : 0;
}
