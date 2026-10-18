import { createCollector, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachAiSource, summarizeAiTrace } from "../src/sources/ai-source";
import type { DevtoolsAiSource } from "../src/sources/ai-source";

const context = vi.hoisted(() => ({ requestId: undefined as string | undefined }));
vi.mock("../src/current-request-id", () => ({ currentRequestId: () => context.requestId }));
type Report = Parameters<ReturnType<typeof createCollector>["collect"]>[0];

function report(id: string): Report {
  return {
    runId: id,
    rootRunId: id,
    sessionId: "conversation",
    name: "assistant",
    type: "agent",
    status: "completed",
    startedAt: "2026-10-19T10:00:00.000Z",
    endedAt: "2026-10-19T10:00:00.100Z",
    duration: 100,
    usage: {
      input: 10,
      output: 5,
      total: 15,
      cachedTokens: 4,
      cost: { input: 0.01, output: 0.02, cacheWrite: 0.03, serverTools: { webSearch: 0.04 } },
    },
    children: [],
  };
}

let source: DevtoolsAiSource | undefined;
afterEach(() => {
  source?.dispose();
  source = undefined;
  context.requestId = undefined;
});

describe("Panoptic source", () => {
  it("links traces before exporter dispatch, keeps session identity, and leaves other stores intact", async () => {
    source = await attachAiSource(2);
    if (!source.available) throw new Error(source.message);
    const exported = createInMemoryTraceStore();
    const collector = createCollector().use(exported);
    const listener = vi.fn();
    const detach = source.subscribe(listener);
    context.requestId = "http-a";
    const first = collector.collect(report("run-a"));
    context.requestId = "http-b";
    const second = collector.collect(report("run-b"));
    context.requestId = undefined;
    await Promise.all([first, second]);
    expect(source.store.query({ requestId: "http-a" }).map((trace) => trace.traceId)).toEqual([
      "run-a",
    ]);
    expect(source.store.query({ requestId: "http-b" })).toHaveLength(1);
    expect(source.store.aggregate({ requestId: "http-a" }).usage.total).toBe(15);
    expect(source.store.get("run-a")?.sessionId).toBe("conversation");
    expect(exported.get("run-a")?.requestId).toBeUndefined();
    const saved = source.store.get("run-a");
    if (!saved) throw new Error("Expected collected trace");
    expect(source.summarize(saved).cost).toBeCloseTo(0.1);
    expect(listener).toHaveBeenCalledWith({ traceId: "run-a", requestId: "http-a" });
    detach();
    await collector.collect(report("background"));
    expect(source.store.size).toBe(2);
    expect(source.store.get("run-a")).toBeUndefined();
    expect(source.store.get("background")?.requestId).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    source.dispose();
    await collector.collect(report("after-shutdown"));
    expect(source.store.size).toBe(0);
    expect(exported.size).toBe(4);
  });

  it("retains independent metadata without captured content", async () => {
    source = await attachAiSource(10);
    if (!source.available) throw new Error(source.message);
    const collector = createCollector({ captureContent: true });
    const base = report("parent");
    const extended = {
      ...base,
      model: { name: "test-model", provider: "test-provider" },
      children: [
        {
          ...report("tool"),
          rootRunId: "parent",
          parentRunId: "parent",
          type: "tool" as const,
          input: "private args",
          output: "private result",
        },
      ],
      trips: [{ input: "private prompt", output: "private answer" }],
    };
    await collector.collect(extended);
    const saved = source.store.get("parent");
    expect(JSON.stringify(saved)).not.toContain("private");
    base.usage.input = 999;
    expect(saved?.usage.input).toBe(10);
    expect(saved?.root.children[0]?.duration).toBe(100);
    expect(saved?.root.attributes?.["agent.model.name"]).toBe("test-model");
    expect(saved?.root.input).toBeUndefined();
    expect(saved?.root.children[0]?.input).toBeUndefined();
  });

  it("summarizes nested diagnostics without summing rolled-up usage twice", () => {
    const trace = createCollector().toTrace(report("parent"));
    trace.root.children = [
      {
        ...trace.root,
        spanId: "tool",
        type: "tool",
        status: "incomplete",
        error: { type: "AgentIncompleteError", message: "cut off" },
        attributes: { retries: 2 },
        children: [],
      },
    ];
    trace.root.attributes = {
      "agent.cacheHits": 1,
      "agent.truncatedTrips": 1,
      "agent.providerCompactions": 1,
      "agent.compactions": [{ type: "applied" }, { type: "skipped" }],
    };
    expect(summarizeAiTrace(trace)).toMatchObject({
      toolCalls: 1,
      retries: 2,
      cacheHits: 1,
      truncatedTrips: 1,
      incomplete: true,
      compactions: 1,
      skippedCompactions: 1,
      providerCompactions: 1,
      usage: { input: 10, output: 5, total: 15 },
    });
    trace.root.children[0].status = "failed";
    expect(summarizeAiTrace(trace).incomplete).toBe(true);
    trace.root.children[0].error = { type: "AGENT_INCOMPLETE", message: "cut off" };
    expect(summarizeAiTrace(trace).incomplete).toBe(true);
    delete trace.root.attributes["agent.cacheHits"];
    expect(summarizeAiTrace(trace).cacheHits).toBeUndefined();
  });
});
