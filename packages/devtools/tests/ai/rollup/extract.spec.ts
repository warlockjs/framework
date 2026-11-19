import { describe, expect, it } from "vitest";
import {
  addRollupCounters,
  emptyRollupDelta,
  rollupId,
  traceToRollupDeltas,
} from "../../../src/ai/rollup/extract";
import { agentSpan, HOUR, HOUR_START, noPrice, priceOf, span, T0, traceOf, usage } from "./helpers";

describe("traceToRollupDeltas", () => {
  it("turns a single agent into one delta", () => {
    const root = agentSpan("support", "gpt-4o", "openai", {
      usage: usage(1000, 500, { cachedTokens: 200, reasoningTokens: 30 }),
      duration: 1800,
    });
    const [delta, ...rest] = traceToRollupDeltas(traceOf(root), priceOf);

    expect(rest).toEqual([]);
    expect(delta).toMatchObject({
      hour: HOUR_START,
      agent: "support",
      model: "gpt-4o",
      provider: "openai",
      runs: 1,
      completed: 1,
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 200,
      reasoningTokens: 30,
      pricedRuns: 1,
      unpricedRuns: 0,
      latencyCount: 1,
      latencySumMs: 1800,
    });
    expect(delta.costUsd).toBeCloseTo(2);
    expect(delta.latency[3]).toBe(1);
  });

  it("counts an agent used as a tool once, as itself", () => {
    const inner = agentSpan("researcher", "claude-x", "anthropic", { usage: usage(300, 100) });
    const outer = agentSpan("writer", "gpt-4o", "openai", {
      usage: usage(1000, 400),
      children: [span("tool", { type: "tool", children: [inner] })],
    });
    const deltas = traceToRollupDeltas(traceOf(outer), priceOf);
    const byAgent = Object.fromEntries(deltas.map((delta) => [delta.agent, delta]));

    expect(deltas).toHaveLength(2);
    expect(byAgent.writer).toMatchObject({ inputTokens: 700, outputTokens: 300 });
    expect(byAgent.researcher).toMatchObject({ inputTokens: 300, outputTokens: 100 });
    expect(byAgent.writer.costUsd + byAgent.researcher.costUsd).toBeCloseTo(priceOf(outer.usage)!);
    expect(deltas.reduce((sum, delta) => sum + delta.runs, 0)).toBe(2);
  });

  it("counts every agent of a workflow with its own model", () => {
    const root = span("flow", {
      type: "workflow",
      usage: usage(500, 250),
      children: [
        agentSpan("a", "m1", "p1", { usage: usage(200, 100) }),
        agentSpan("b", "m2", "p2", { usage: usage(300, 150) }),
      ],
    });
    const deltas = traceToRollupDeltas(traceOf(root), priceOf);

    expect(deltas.map((delta) => [delta.agent, delta.model, delta.inputTokens])).toEqual([
      ["a", "m1", 200],
      ["b", "m2", 300],
    ]);
  });

  it("books leftover root usage under (unknown)", () => {
    const root = span("flow", {
      type: "workflow",
      usage: usage(500, 250),
      children: [agentSpan("a", "m1", "p1", { usage: usage(200, 100) })],
    });
    const deltas = traceToRollupDeltas(traceOf(root), priceOf);
    const leftover = deltas.find((delta) => delta.model === "(unknown)")!;

    expect(leftover).toMatchObject({
      agent: "flow",
      provider: "(unknown)",
      runs: 1,
      inputTokens: 300,
      outputTokens: 150,
    });
    expect(leftover.latencyCount).toBe(0);
  });

  it("adds nothing for a trace without tokens or model spans", () => {
    expect(traceToRollupDeltas(traceOf(span("flow", { type: "workflow" })), priceOf)).toEqual([]);
  });

  it("normalises Anthropic-style usage into the whole prompt", () => {
    const root = agentSpan("a", "claude-x", "anthropic", {
      usage: usage(100, 500, {
        cachedTokens: 50_000,
        cacheWriteTokens: 20_000,
        inputIncludesCache: false,
      }),
    });
    const [delta] = traceToRollupDeltas(traceOf(root), priceOf);

    expect(delta.inputTokens).toBe(70_100);
    expect(delta.cachedTokens).toBe(50_000);
    expect(delta.cacheWriteTokens).toBe(20_000);
  });

  it("flags priced, unpriced and token-less runs", () => {
    const priced = traceToRollupDeltas(
      traceOf(agentSpan("a", "m", "p", { usage: usage(10, 5) })),
      priceOf,
    )[0];
    const unpriced = traceToRollupDeltas(
      traceOf(agentSpan("a", "m", "p", { usage: usage(10, 5) })),
      noPrice,
    )[0];
    const empty = traceToRollupDeltas(traceOf(agentSpan("a", "m", "p")), noPrice)[0];

    expect(priced).toMatchObject({ pricedRuns: 1, unpricedRuns: 0, unpricedTokens: 0 });
    expect(unpriced).toMatchObject({
      pricedRuns: 0,
      unpricedRuns: 1,
      unpricedTokens: 15,
      costUsd: 0,
    });
    expect(empty).toMatchObject({ pricedRuns: 0, unpricedRuns: 0, unpricedTokens: 0, runs: 1 });
  });

  it("counts a rate-limited failure as a failed run and one rate-limit error", () => {
    const root = agentSpan("a", "m", "p", {
      status: "failed",
      error: { type: "PROVIDER_RATE_LIMIT", message: "slow down" },
    });
    const [delta] = traceToRollupDeltas(traceOf(root), priceOf);

    expect(delta).toMatchObject({ failed: 1, completed: 0 });
    expect(delta.errors["rate-limit"]).toBe(1);
    expect(Object.values(delta.errors).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("counts incomplete and max-iterations as incomplete errors", () => {
    for (const status of ["incomplete", "max-iterations"] as const) {
      const [delta] = traceToRollupDeltas(traceOf(agentSpan("a", "m", "p", { status })), priceOf);

      expect(delta).toMatchObject({ incomplete: 1, failed: 0 });
      expect(delta.errors.incomplete).toBe(1);
    }
  });

  it("counts a cancelled run without an error", () => {
    const [delta] = traceToRollupDeltas(
      traceOf(agentSpan("a", "m", "p", { status: "cancelled" })),
      priceOf,
    );

    expect(delta).toMatchObject({ runs: 1, cancelled: 1 });
    expect(Object.values(delta.errors).every((count) => count === 0)).toBe(true);
  });

  it("counts a run waiting for input in runs only", () => {
    const [delta] = traceToRollupDeltas(
      traceOf(agentSpan("a", "m", "p", { status: "awaiting-input" })),
      priceOf,
    );

    expect(delta).toMatchObject({ runs: 1, completed: 0, failed: 0, incomplete: 0, cancelled: 0 });
  });

  it("reads the fallback and refusal attributes", () => {
    const [delta] = traceToRollupDeltas(
      traceOf(
        agentSpan("a", "m", "p", {
          attributes: {
            "agent.model.name": "m",
            "agent.model.provider": "p",
            "agent.fallbackTrips": 2,
            "agent.refusals": 1,
          },
        }),
      ),
      priceOf,
    );

    expect(delta).toMatchObject({ fallbackRuns: 1, refusals: 1 });
  });

  it("counts a CONTENT_FILTER error as a refusal", () => {
    const [delta] = traceToRollupDeltas(
      traceOf(
        agentSpan("a", "m", "p", {
          status: "failed",
          error: { type: "CONTENT_FILTER", message: "x" },
        }),
      ),
      priceOf,
    );

    expect(delta.refusals).toBe(1);
    expect(delta.errors.refusal).toBe(1);
  });

  it("buckets the hour by the span's endedAt", () => {
    const later = new Date(T0 + 2 * HOUR).toISOString();
    const [delta] = traceToRollupDeltas(
      traceOf(agentSpan("a", "m", "p", { endedAt: later })),
      priceOf,
    );

    expect(delta.hour).toBe(HOUR_START + 2 * HOUR);
  });

  it("falls back to the trace end for an unparsable span time and skips a trace without any", () => {
    const root = agentSpan("a", "m", "p", { endedAt: "nope" });
    const trace = { ...traceOf(root), endedAt: new Date(T0).toISOString() };

    expect(traceToRollupDeltas(trace, priceOf)[0].hour).toBe(HOUR_START);
    expect(traceToRollupDeltas({ ...trace, endedAt: "nope" }, priceOf)).toEqual([]);
  });

  it("buckets a nested span without a readable end by the root's end, even when the trace end is unreadable", () => {
    const later = new Date(T0 + 3 * HOUR).toISOString();
    const root = span("flow", {
      type: "workflow",
      endedAt: later,
      usage: usage(20, 10),
      children: [agentSpan("a", "m", "p", { endedAt: "nope", usage: usage(20, 10) })],
    });
    const deltas = traceToRollupDeltas({ ...traceOf(root), endedAt: "nope" }, priceOf);

    expect(deltas.map((delta) => delta.hour)).toEqual([HOUR_START + 3 * HOUR]);
  });

  it("counts a model priced as free as priced, not unpriced", () => {
    const free = () => 0;
    const [delta] = traceToRollupDeltas(
      traceOf(agentSpan("local", "llama3", "ollama", { usage: usage(100, 50) })),
      free,
    );

    expect(delta).toMatchObject({ pricedRuns: 1, unpricedRuns: 0, unpricedTokens: 0, costUsd: 0 });
  });

  it("keeps an unpriced agent unpriced when only a nested agent has pricing", () => {
    const child = agentSpan("priced", "m2", "p", { usage: usage(10, 10) });
    const root = agentSpan("unpriced", "m1", "p", { usage: usage(110, 60), children: [child] });
    // Only the child's usage is priced; the root's rolled-up cost is the child's cost.
    const childCost = priceOf(child.usage)!;
    const cost = (u: Parameters<typeof priceOf>[0]) =>
      u === child.usage || u === root.usage ? childCost : undefined;
    const [parent] = traceToRollupDeltas(traceOf(root), cost);

    expect(parent).toMatchObject({ agent: "unpriced", pricedRuns: 0, unpricedRuns: 1 });
  });

  it("cuts long names", () => {
    const [delta] = traceToRollupDeltas(
      traceOf(agentSpan("x".repeat(300), "m".repeat(300), "p".repeat(300))),
      priceOf,
    );

    expect(delta.agent).toHaveLength(200);
    expect(delta.model).toHaveLength(200);
    expect(delta.provider).toHaveLength(100);
  });

  it("uses (unknown) for missing names", () => {
    const [delta] = traceToRollupDeltas(traceOf(span("", { type: "image" })), priceOf);

    expect(delta).toMatchObject({ agent: "(unknown)", model: "(unknown)", provider: "(unknown)" });
  });

  it("never lets a subtraction go below 0", () => {
    const inner = agentSpan("i", "m", "p", { usage: usage(900, 900) });
    const outer = agentSpan("o", "m", "p", { usage: usage(100, 100), children: [inner] });
    const delta = traceToRollupDeltas(traceOf(outer), priceOf).find((item) => item.agent === "o")!;

    expect(delta).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});

describe("rollupId", () => {
  it("is 40 hex characters and depends on every part of the key", () => {
    const key = { hour: HOUR_START, agent: "a", model: "m", provider: "p" };
    const id = rollupId(key);

    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(rollupId({ ...key })).toBe(id);
    expect(rollupId({ ...key, agent: "b" })).not.toBe(id);
    expect(rollupId({ ...key, model: "n" })).not.toBe(id);
    expect(rollupId({ ...key, provider: "q" })).not.toBe(id);
    expect(rollupId({ ...key, hour: HOUR_START + HOUR })).not.toBe(id);
  });
});

describe("emptyRollupDelta and addRollupCounters", () => {
  it("starts at zero and adds every counter", () => {
    const key = { hour: HOUR_START, agent: "a", model: "m", provider: "p" };
    const target = emptyRollupDelta(key);
    const source = emptyRollupDelta(key);

    source.runs = 2;
    source.costUsd = 0.5;
    source.errors.tool = 1;
    source.latency[4] = 3;
    addRollupCounters(target, source);
    addRollupCounters(target, source);

    expect(target).toMatchObject({ runs: 4, costUsd: 1 });
    expect(target.errors.tool).toBe(2);
    expect(target.latency[4]).toBe(6);
    expect(emptyRollupDelta(key).runs).toBe(0);
  });
});
