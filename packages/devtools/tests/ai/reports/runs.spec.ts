import { describe, expect, it } from "vitest";
import { listAiRuns, recentAiFailures, toAiRunRow } from "../../../src/ai/reports/runs";

const helpers = {
  filterTraces: (traces: any[], f: any) =>
    traces.filter(
      (t) =>
        (!f.statuses || f.statuses.includes(t.root.status)) &&
        (!f.text || t.root.name.includes(f.text)),
    ),
  groupBySession: (traces: any[]) =>
    [...Map.groupBy(traces, (t: any) => t.sessionId ?? "(no session)")].map(
      ([sessionId, traces]) => ({ sessionId, traces }),
    ),
  groupByPrompt: (traces: any[]) => [{ promptKey: "(no prompt)", traces }],
  groupByType: (traces: any[]) => [{ type: "agent", traces }],
  percentile: (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * values.length) - 1)] ?? 0,
  tracePromptKey: (t: any) => t.root.attributes?.promptKey,
} as never;
const totalCost = (usage: any) => usage.cost;

function span(over: Record<string, any> = {}): any {
  return {
    spanId: "s",
    traceId: "t",
    name: "support",
    type: "agent",
    status: "completed",
    startedAt: "2026-03-10T10:00:00Z",
    endedAt: "2026-03-10T10:00:02Z",
    duration: 2000,
    usage: { input: 1, output: 1, total: 2 },
    children: [],
    ...over,
  };
}
function trace(id: string, root: any, over: Record<string, any> = {}): any {
  return {
    traceId: id,
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    duration: root.duration,
    usage: root.usage,
    root,
    ...over,
  };
}

describe("toAiRunRow", () => {
  it("maps a content-free trace", () => {
    const root = span({
      usage: { input: 10, output: 5, total: 15, cachedTokens: 2, cost: 0.25 },
      attributes: {
        "agent.model.name": "gpt-4o",
        "agent.model.provider": "openai",
        promptKey: "p@1",
        retries: 2,
      },
      children: [span({ type: "tool", name: "t", usage: { input: 0, output: 0, total: 0 } })],
    });
    const row = toAiRunRow(trace("t1", root, { requestId: "req" }), { totalCost, helpers });

    expect(row).toMatchObject({
      traceId: "t1",
      requestId: "req",
      sessionId: null,
      type: "agent",
      cost: 0.25,
      models: ["openai/gpt-4o"],
      promptKey: "p@1",
      toolCalls: 1,
      retries: 2,
      incomplete: false,
      usage: {
        input: 10,
        output: 5,
        total: 15,
        cachedTokens: 2,
        cacheWriteTokens: null,
        inputIncludesCache: null,
      },
    });
  });

  it("has null cost when nothing is priced", () => {
    expect(toAiRunRow(trace("t", span()), { totalCost, helpers }).cost).toBeNull();
  });
});

describe("listAiRuns", () => {
  const traces = [
    trace(
      "a",
      span({
        startedAt: "2026-03-10T10:00:00Z",
        usage: { input: 1, output: 1, total: 2, cost: 1 },
        duration: 100,
      }),
      { sessionId: "s1" },
    ),
    trace("b", span({ startedAt: "2026-03-10T11:00:00Z", status: "failed", duration: 300 }), {
      sessionId: "s1",
    }),
    trace("c", span({ startedAt: "2026-03-10T12:00:00Z", name: "other", duration: 200 })),
  ];
  const options = { totalCost, capacity: 500, helpers };

  it("lists newest first with stats", () => {
    const view = listAiRuns(traces, {}, options);

    expect(view.runs.map((r) => r.traceId)).toEqual(["c", "b", "a"]);
    expect(view.stats).toMatchObject({
      count: 3,
      failed: 1,
      estimatedCostUsd: 1,
      unpricedRuns: 2,
      p50Ms: 200,
      p95Ms: 300,
    });
    expect(view.groups).toBeNull();
    expect(view.capacity).toBe(500);
  });

  it("filters by an exact HTTP request id", () => {
    const withRequest = [...traces, trace("d", span(), { requestId: "req-1" })];

    expect(
      listAiRuns(withRequest, { requestId: "req-1" }, options).runs.map((r) => r.traceId),
    ).toEqual(["d"]);
    expect(listAiRuns(withRequest, { requestId: "req" }, options).runs).toEqual([]);
  });

  it("filters, limits and groups", () => {
    expect(listAiRuns(traces, { status: "failed" }, options).runs.map((r) => r.traceId)).toEqual([
      "b",
    ]);
    expect(listAiRuns(traces, { limit: "1" }, options).runs).toHaveLength(1);

    const grouped = listAiRuns(traces, { groupBy: "session" }, options);
    expect(grouped.groups?.find((g) => g.key === "s1")).toMatchObject({
      runs: 2,
      failed: 1,
      estimatedCostUsd: 1,
      traceIds: ["b", "a"],
    });
  });

  it("input.invalid for a bad limit, groupBy or status", () => {
    for (const query of [
      { limit: "0" },
      { limit: "abc" },
      { limit: "1001" },
      { groupBy: "x" },
      { status: "bogus" },
      { type: "bogus" },
    ] as never[]) {
      expect(() => listAiRuns(traces, query, options)).toThrowError(
        expect.objectContaining({ code: "input.invalid" }),
      );
    }
  });
});

describe("recentAiFailures", () => {
  it("returns failed agent spans newest first with a cut message", () => {
    const failed = (id: string, endedAt: string, message: string) =>
      trace(
        id,
        span({
          status: "failed",
          endedAt,
          attributes: { "agent.model.name": "m", "agent.model.provider": "p" },
          error: { type: "PROVIDER_RATE_LIMIT", message },
        }),
        { requestId: "r" },
      );
    const result = recentAiFailures(
      [
        failed("old", "2026-03-10T10:00:00Z", "x".repeat(500)),
        failed("new", "2026-03-10T11:00:00Z", "boom"),
        trace("ok", span()),
      ],
      10,
    );

    expect(result.map((r) => r.traceId)).toEqual(["new", "old"]);
    expect(result[0]).toMatchObject({
      agent: "support",
      model: "p/m",
      category: "rate-limit",
      code: "PROVIDER_RATE_LIMIT",
      message: "boom",
      requestId: "r",
    });
    expect(result[1]?.message).toHaveLength(300);
    expect(recentAiFailures([failed("a", "2026-03-10T10:00:00Z", "m")], 0)).toEqual([]);
  });

  it("lists every failed model span (not only agents) and applies the page's range and filters", () => {
    const at = Date.parse("2026-03-10T10:30:00Z");
    const failedSpan = (name: string, type: string, model: string | null, endedAt: string) =>
      span({
        name,
        type: type as never,
        status: "failed",
        endedAt,
        attributes: model ? { "agent.model.name": model, "agent.model.provider": "p" } : {},
        error: { type: "PROVIDER_ERROR", message: "x" },
      });
    const traces = [
      trace("img", failedSpan("draw", "image", "dall-e", "2026-03-10T10:30:00Z")),
      trace("agent", failedSpan("support", "agent", "m", "2026-03-10T10:40:00Z")),
      trace("old", failedSpan("support", "agent", "m", "2026-03-09T10:40:00Z")),
    ];

    expect(recentAiFailures(traces, 10).map((run) => run.traceId)).toEqual(["agent", "img", "old"]);

    const scoped = recentAiFailures(traces, 10, {
      from: at - 3_600_000,
      to: at + 3_600_000,
      model: { provider: "p", model: "m" },
    });

    expect(scoped.map((run) => run.traceId)).toEqual(["agent"]);
    expect(
      recentAiFailures(traces, 10, { from: 0, to: Number.MAX_SAFE_INTEGER, agent: "draw" }).map(
        (run) => run.model,
      ),
    ).toEqual(["p/dall-e"]);
  });
});
