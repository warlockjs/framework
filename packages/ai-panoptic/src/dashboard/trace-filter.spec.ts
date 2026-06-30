import { describe, expect, it } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import {
  NO_PROMPT_KEY,
  NO_SESSION_KEY,
  NO_TYPE_KEY,
  aggregateByType,
  filterTraces,
  groupByPrompt,
  groupBySession,
  groupByType,
  heatIntensity,
  matchesFilter,
  maxNodeCost,
  percentile,
  rollupCost,
  traceCost,
  tracePromptKey,
} from "./trace-filter";

describe("matchesFilter", () => {
  it("matches every trace under an empty filter", () => {
    const trace = makeTrace({ traceId: "t1" });

    expect(matchesFilter(trace, {})).toBe(true);
  });

  it("filters by a single root status", () => {
    const ok = makeTrace({ traceId: "ok", status: "completed" });
    const bad = makeTrace({ traceId: "bad", status: "failed" });

    expect(matchesFilter(ok, { statuses: ["completed"] })).toBe(true);
    expect(matchesFilter(bad, { statuses: ["completed"] })).toBe(false);
  });

  it("treats an empty statuses array as don't-care", () => {
    const bad = makeTrace({ status: "failed" });

    expect(matchesFilter(bad, { statuses: [] })).toBe(true);
  });

  it("filters by root type", () => {
    const trace = makeTrace({ traceId: "t1" }); // root type is "agent"

    expect(matchesFilter(trace, { types: ["agent"] })).toBe(true);
    expect(matchesFilter(trace, { types: ["tool"] })).toBe(false);
  });

  it("filters by exact sessionId", () => {
    const a = makeTrace({ traceId: "a", sessionId: "s1" });
    const b = makeTrace({ traceId: "b", sessionId: "s2" });

    expect(matchesFilter(a, { sessionId: "s1" })).toBe(true);
    expect(matchesFilter(b, { sessionId: "s1" })).toBe(false);
  });

  it("matches free text case-insensitively across name and session", () => {
    const trace = makeTrace({ traceId: "t1", name: "Billing Agent", sessionId: "checkout-42" });

    expect(matchesFilter(trace, { text: "billing" })).toBe(true);
    expect(matchesFilter(trace, { text: "CHECKOUT" })).toBe(true);
    expect(matchesFilter(trace, { text: "nope" })).toBe(false);
  });

  it("treats a blank text needle as don't-care", () => {
    const trace = makeTrace({ name: "x" });

    expect(matchesFilter(trace, { text: "   " })).toBe(true);
  });

  it("keeps only failed/cancelled under errorsOnly", () => {
    const ok = makeTrace({ traceId: "ok", status: "completed" });
    const failed = makeTrace({ traceId: "f", status: "failed" });
    const cancelled = makeTrace({ traceId: "c", status: "cancelled" });

    expect(matchesFilter(ok, { errorsOnly: true })).toBe(false);
    expect(matchesFilter(failed, { errorsOnly: true })).toBe(true);
    expect(matchesFilter(cancelled, { errorsOnly: true })).toBe(true);
  });

  it("ANDs every active dimension", () => {
    const trace = makeTrace({
      traceId: "t1",
      name: "Search Agent",
      sessionId: "s1",
      status: "failed",
    });

    expect(
      matchesFilter(trace, {
        statuses: ["failed"],
        types: ["agent"],
        sessionId: "s1",
        text: "search",
        errorsOnly: true,
      }),
    ).toBe(true);

    // One mismatched dimension (sessionId) excludes it.
    expect(
      matchesFilter(trace, {
        statuses: ["failed"],
        sessionId: "other",
      }),
    ).toBe(false);
  });

  it("filters by exact prompt key (name@version)", () => {
    const v2 = makeTrace({ traceId: "v2", promptName: "support", promptVersion: "2" });
    const v3 = makeTrace({ traceId: "v3", promptName: "support", promptVersion: "3" });
    const none = makeTrace({ traceId: "none" });

    expect(matchesFilter(v2, { promptKey: "support@2" })).toBe(true);
    expect(matchesFilter(v3, { promptKey: "support@2" })).toBe(false);
    expect(matchesFilter(none, { promptKey: "support@2" })).toBe(false);
  });

  it("treats an absent prompt key as don't-care", () => {
    const none = makeTrace({ traceId: "none" });

    expect(matchesFilter(none, {})).toBe(true);
    expect(matchesFilter(none, { promptKey: "" })).toBe(true);
  });
});

describe("tracePromptKey", () => {
  it("derives name@version from the root span's linkage attributes", () => {
    const trace = makeTrace({ promptName: "support", promptVersion: "2" });

    expect(tracePromptKey(trace)).toBe("support@2");
  });

  it("defaults the version to 1 when only a name is present", () => {
    const trace = makeTrace({ promptName: "greeter" });

    expect(tracePromptKey(trace)).toBe("greeter@1");
  });

  it("returns undefined for a run with no named prompt", () => {
    expect(tracePromptKey(makeTrace({ traceId: "x" }))).toBeUndefined();
  });
});

describe("filterTraces", () => {
  it("narrows the list and preserves order", () => {
    const traces = [
      makeTrace({ traceId: "a", status: "completed" }),
      makeTrace({ traceId: "b", status: "failed" }),
      makeTrace({ traceId: "c", status: "failed" }),
    ];

    const result = filterTraces(traces, { statuses: ["failed"] });

    expect(result.map((t) => t.traceId)).toEqual(["b", "c"]);
  });
});

describe("groupBySession", () => {
  it("buckets traces by session preserving first-seen order", () => {
    const traces = [
      makeTrace({ traceId: "a", sessionId: "s1" }),
      makeTrace({ traceId: "b", sessionId: "s2" }),
      makeTrace({ traceId: "c", sessionId: "s1" }),
    ];

    const groups = groupBySession(traces);

    expect(groups.map((g) => g.sessionId)).toEqual(["s1", "s2"]);
    expect(groups[0].traces.map((t) => t.traceId)).toEqual(["a", "c"]);
    expect(groups[1].traces.map((t) => t.traceId)).toEqual(["b"]);
  });

  it("collapses sessionless traces under the no-session key", () => {
    const traces = [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })];

    const groups = groupBySession(traces);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe(NO_SESSION_KEY);
    expect(groups[0].traces.map((t) => t.traceId)).toEqual(["a", "b"]);
  });
});

describe("groupByPrompt", () => {
  it("buckets traces by prompt version preserving first-seen order", () => {
    const traces = [
      makeTrace({ traceId: "a", promptName: "support", promptVersion: "2" }),
      makeTrace({ traceId: "b", promptName: "support", promptVersion: "3" }),
      makeTrace({ traceId: "c", promptName: "support", promptVersion: "2" }),
    ];

    const groups = groupByPrompt(traces);

    expect(groups.map((g) => g.promptKey)).toEqual(["support@2", "support@3"]);
    expect(groups[0].traces.map((t) => t.traceId)).toEqual(["a", "c"]);
    expect(groups[1].traces.map((t) => t.traceId)).toEqual(["b"]);
  });

  it("separates same-name runs across different versions", () => {
    const traces = [
      makeTrace({ traceId: "old", promptName: "agent", promptVersion: "1" }),
      makeTrace({ traceId: "new", promptName: "agent", promptVersion: "2" }),
    ];

    const groups = groupByPrompt(traces);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.promptKey)).toEqual(["agent@1", "agent@2"]);
  });

  it("collapses runs with no named prompt under the no-prompt key", () => {
    const traces = [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })];

    const groups = groupByPrompt(traces);

    expect(groups).toHaveLength(1);
    expect(groups[0].promptKey).toBe(NO_PROMPT_KEY);
    expect(groups[0].traces.map((t) => t.traceId)).toEqual(["a", "b"]);
  });
});

describe("groupByType", () => {
  it("buckets traces by root type preserving first-seen order", () => {
    const traces = [
      makeTrace({ traceId: "a", type: "agent" }),
      makeTrace({ traceId: "w", type: "workflow" }),
      makeTrace({ traceId: "a2", type: "agent" }),
      makeTrace({ traceId: "p", type: "planner" }),
    ];

    const groups = groupByType(traces);

    expect(groups.map((g) => g.type)).toEqual(["agent", "workflow", "planner"]);
    expect(groups[0].traces.map((t) => t.traceId)).toEqual(["a", "a2"]);
    expect(groups[1].traces.map((t) => t.traceId)).toEqual(["w"]);
    expect(groups[2].traces.map((t) => t.traceId)).toEqual(["p"]);
  });

  it("collapses a single-type flood into one bucket (the benchmark case)", () => {
    const traces = [
      makeTrace({ traceId: "a", type: "agent" }),
      makeTrace({ traceId: "b", type: "agent" }),
      makeTrace({ traceId: "c", type: "agent" }),
    ];

    const groups = groupByType(traces);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("agent");
    expect(groups[0].traces).toHaveLength(3);
  });

  it("returns no groups for an empty list", () => {
    expect(groupByType([])).toEqual([]);
  });

  it("falls back to the no-type key for a malformed root with no type", () => {
    const trace = makeTrace({ traceId: "x" });
    (trace.root as { type?: string }).type = undefined;

    const groups = groupByType([trace]);

    expect(groups[0].type).toBe(NO_TYPE_KEY);
  });
});

describe("percentile", () => {
  it("returns 0 for an empty list", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("computes nearest-rank p50 / p95 over a known set", () => {
    const xs = [100, 200, 300, 400];
    // nearest-rank: p50 → ceil(0.5·4)-1 = idx 1 → 200; p95 → ceil(0.95·4)-1 = idx 3 → 400
    expect(percentile(xs, 50)).toBe(200);
    expect(percentile(xs, 95)).toBe(400);
    expect(percentile(xs, 100)).toBe(400);
  });

  it("does not mutate the input array", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("aggregateByType", () => {
  it("returns one row per type in first-seen order", () => {
    const traces = [
      makeTrace({ traceId: "a1", type: "agent", duration: 100 }),
      makeTrace({ traceId: "w1", type: "workflow", duration: 200 }),
      makeTrace({ traceId: "a2", type: "agent", duration: 300 }),
    ];

    const stats = aggregateByType(traces);

    expect(stats.map((s) => s.type)).toEqual(["agent", "workflow"]);
    expect(stats[0].count).toBe(2);
    expect(stats[1].count).toBe(1);
  });

  it("counts failed + cancelled toward the failure rate (ERROR_STATUSES parity)", () => {
    const traces = [
      makeTrace({ traceId: "ok", type: "agent", status: "completed" }),
      makeTrace({ traceId: "f", type: "agent", status: "failed" }),
      makeTrace({ traceId: "c", type: "agent", status: "cancelled" }),
      makeTrace({ traceId: "ok2", type: "agent", status: "completed" }),
    ];

    const [agentStat] = aggregateByType(traces);

    expect(agentStat.count).toBe(4);
    expect(agentStat.failed).toBe(2);
    expect(agentStat.failRate).toBe(0.5);
  });

  it("computes p50 / p95 latency per type from each trace's root duration", () => {
    const traces = [100, 200, 300, 400].map((d, i) =>
      makeTrace({ traceId: "t" + i, type: "agent", duration: d }),
    );

    const [agentStat] = aggregateByType(traces);

    expect(agentStat.p50).toBe(200);
    expect(agentStat.p95).toBe(400);
  });

  it("sums tokens (usage.total) and cost (per-trace traceCost) per type", () => {
    const traces = [
      makeTrace({ traceId: "a", type: "agent", usage: { input: 10, output: 5, total: 15, cost: { input: 0.01, output: 0.02 } } }),
      makeTrace({ traceId: "b", type: "agent", usage: { input: 20, output: 10, total: 30, cost: { input: 0.03, output: 0.04 } } }),
    ];

    const [agentStat] = aggregateByType(traces);

    expect(agentStat.tokens).toBe(45);
    expect(agentStat.cost).toBeCloseTo(traceCost(traces[0]) + traceCost(traces[1]), 10);
    expect(agentStat.cost).toBeCloseTo(0.1, 10);
  });

  it("returns no rows for an empty list", () => {
    expect(aggregateByType([])).toEqual([]);
  });
});

describe("rollupCost / maxNodeCost / heatIntensity", () => {
  it("uses a node's own cost when present", () => {
    const trace = makeTrace({
      traceId: "t1",
      usage: { input: 100, output: 50, total: 150, cost: { input: 0.2, output: 0.3 } },
    });

    expect(rollupCost(trace.root)).toBeCloseTo(0.5);
  });

  it("descends to children when a wrapper node carries no cost", () => {
    const child = makeSpan({
      spanId: "child",
      traceId: "t1",
      usage: { input: 10, output: 5, total: 15, cost: { input: 0.1, output: 0.1 } },
    });
    const trace = makeTrace({
      traceId: "t1",
      usage: { input: 10, output: 5, total: 15 }, // no cost on the wrapper root
      children: [child],
    });

    expect(rollupCost(trace.root)).toBeCloseTo(0.2);
  });

  it("finds the most expensive node for the heatmap denominator", () => {
    const cheap = makeSpan({
      spanId: "cheap",
      traceId: "t1",
      usage: { input: 1, output: 1, total: 2, cost: { input: 0.01, output: 0.01 } },
    });
    const pricey = makeSpan({
      spanId: "pricey",
      traceId: "t1",
      usage: { input: 1, output: 1, total: 2, cost: { input: 0.5, output: 0.5 } },
    });
    const trace = makeTrace({
      traceId: "t1",
      usage: { input: 2, output: 2, total: 4 }, // wrapper root carries no own cost
      children: [cheap, pricey],
    });

    // The root has no own cost, so its rollup sums its children
    // (0.02 + 1.0 = 1.02) — and that aggregate IS the largest node value,
    // which is exactly the denominator we want (the root saturates).
    expect(maxNodeCost(trace.root)).toBeCloseTo(1.02);
    expect(rollupCost(pricey)).toBeCloseTo(1);
  });

  it("uses the priced node itself as the max when the root carries own cost", () => {
    const child = makeSpan({
      spanId: "child",
      traceId: "t1",
      usage: { input: 1, output: 1, total: 2, cost: { input: 0.1, output: 0.1 } },
    });
    const trace = makeTrace({
      traceId: "t1",
      // Root carries its own (already-rolled-up) cost, so rollupCost stops
      // at the root and does NOT double-count the child.
      usage: { input: 3, output: 3, total: 6, cost: { input: 0.3, output: 0.3 } },
      children: [child],
    });

    expect(rollupCost(trace.root)).toBeCloseTo(0.6);
    expect(maxNodeCost(trace.root)).toBeCloseTo(0.6);
  });

  it("scales heat intensity into [0, 1] and clamps", () => {
    expect(heatIntensity(0.5, 1)).toBeCloseTo(0.5);
    expect(heatIntensity(2, 1)).toBe(1);
    expect(heatIntensity(0, 1)).toBe(0);
  });

  it("stays cold for a free trace (max cost 0) without dividing by zero", () => {
    expect(heatIntensity(0, 0)).toBe(0);
    expect(Number.isFinite(heatIntensity(0, 0))).toBe(true);
  });
});
