import { describe, expect, it } from "vitest";
import type { AgentContract } from "../contracts/agent/agent.contract";
import type { EvalReport } from "../contracts/agent/eval.type";
import { runEval } from "./eval-runner";
import { diff } from "./regression";
import { fromJSON, toJSON } from "./report-json";
import { toJUnit } from "./report-junit";
import { exact } from "./scorers";

/**
 * Deterministic fake agent: `answer(input, attempt)` returns the text for
 * the `attempt`-th (0-based) run of `input`. No model is involved.
 */
function fakeAgent(answer: (input: string, attempt: number) => string): AgentContract<unknown> {
  const attempts = new Map<string, number>();

  return {
    name: "fake",
    execute: async (input: string) => {
      const attempt = attempts.get(input) ?? 0;

      attempts.set(input, attempt + 1);

      return { text: answer(input, attempt) };
    },
  } as unknown as AgentContract<unknown>;
}

const cases = [
  { name: "steady", input: "steady", expected: "ok", category: "core" },
  { name: "flaky", input: "flaky", expected: "ok", category: "core" },
  { name: "broken", input: "broken", expected: "ok", category: "edge" },
];

const answer = (input: string, attempt: number) => {
  if (input === "steady") return "ok";
  if (input === "flaky") return attempt === 1 ? "bad" : "ok";

  return "bad";
};

describe("agent.eval repeat", () => {
  it("should run once by default and keep single-run semantics", async () => {
    const report = await runEval(fakeAgent(answer), { cases, scorers: [exact()] });

    expect(report.repeat).toBe(1);
    expect(report.cases.map((entry) => entry.passes)).toEqual([1, 1, 0]);
    expect(report.cases.every((entry) => entry.runs?.length === 1)).toBe(true);
    expect(report.stableFailures).toBeUndefined();
    expect(report.flakyCases).toBeUndefined();
    expect(report.passedCount).toBe(2);
  });

  it("should run every case n times and report pass counts", async () => {
    const report = await runEval(fakeAgent(answer), { cases, scorers: [exact()], repeat: 3 });

    expect(report.repeat).toBe(3);
    expect(report.cases.map((entry) => [entry.passes, entry.repeat])).toEqual([
      [3, 3],
      [2, 3],
      [0, 3],
    ]);
    expect(report.cases[1].passed).toBe(false);
    expect(report.cases[1].score).toBeCloseTo(2 / 3, 10);
    expect(report.stats?.overall.runs).toBe(9);
    expect(report.stats?.categories.core.runs).toBe(6);
    expect(report.stats?.categories.edge.passes).toBe(0);
  });

  it("should separate stable failures from flaky cases", async () => {
    const report = await runEval(fakeAgent(answer), { cases, scorers: [exact()], repeat: 3 });

    expect(report.stableFailures).toEqual(["broken"]);
    expect(report.flakyCases).toEqual(["flaky"]);
  });

  it("should fire onFailure once per failing case, not per run", async () => {
    const failed: string[] = [];

    await runEval(fakeAgent(answer), {
      cases,
      scorers: [exact()],
      repeat: 3,
      onFailure: (entry) => {
        failed.push(entry.case.name);
      },
    });

    expect(failed).toEqual(["flaky", "broken"]);
  });

  it("should reject an invalid repeat or confidence", async () => {
    await expect(
      runEval(fakeAgent(answer), { cases, scorers: [exact()], repeat: 0 }),
    ).rejects.toThrow(/repeat/);
    await expect(
      runEval(fakeAgent(answer), { cases, scorers: [exact()], confidence: 1 }),
    ).rejects.toThrow(/confidence/);
  });
});

describe("baseline gating with repeats", () => {
  /** Baseline of one 10-run case at the given pass count, scored 0/1. */
  const baselineWith = async (passRuns: number): Promise<EvalReport> =>
    runEval(
      fakeAgent((_input, attempt) => (attempt < passRuns ? "ok" : "bad")),
      { cases: [{ name: "q", input: "q", expected: "ok" }], scorers: [exact()], repeat: 10 },
    );

  it("should flag noise as a regression under the point gate", async () => {
    const baseline = await baselineWith(9);
    const current = await baselineWith(7);

    expect(diff(current, baseline).passed).toBe(false);
  });

  it("should tolerate noise inside the interval under the interval gate", async () => {
    const baseline = await baselineWith(9);
    const current = await baselineWith(7);

    const regression = diff(current, baseline, { gate: "interval" });

    expect(regression.passed).toBe(true);
    expect(regression.regressed).toEqual([]);
    expect(regression.regressedMetrics).toEqual([]);
  });

  it("should flag a drop clearly outside the interval", async () => {
    const baseline = await baselineWith(10);
    const current = await baselineWith(2);

    const regression = diff(current, baseline, { gate: "interval" });

    expect(regression.passed).toBe(false);
    expect(regression.regressed.map((entry) => entry.name)).toEqual(["q"]);
    expect(regression.regressedMetrics?.map((entry) => entry.scope)).toContain("overall");
  });

  it("should widen the bar by the tolerance", async () => {
    const baseline = await baselineWith(10);
    const current = await baselineWith(2);

    expect(diff(current, baseline, { gate: "interval", tolerance: 0.9 }).passed).toBe(true);
  });

  it("should not flag a small category on thin evidence", async () => {
    const run = (passes: number) =>
      runEval(
        fakeAgent((_input, attempt) => (attempt < passes ? "ok" : "bad")),
        {
          cases: [{ name: "tiny", input: "tiny", expected: "ok", category: "rare" }],
          scorers: [exact()],
          repeat: 2,
        },
      );

    const regression = diff(await run(1), await run(2), { gate: "interval" });

    expect(regression.regressedMetrics).toEqual([]);
  });

  it("should flag a category regression the aggregate hides", async () => {
    const make = async (rareOk: boolean) =>
      runEval(
        fakeAgent((input) => (input.startsWith("big") || rareOk ? "ok" : "bad")),
        {
          cases: [
            ...Array.from({ length: 30 }, (_, index) => ({
              name: `big${index}`,
              input: `big${index}`,
              expected: "ok",
              category: "big",
            })),
            ...Array.from({ length: 12 }, (_, index) => ({
              name: `rare${index}`,
              input: `rare${index}`,
              expected: "ok",
              category: "rare",
            })),
          ],
          scorers: [exact()],
        },
      );

    const regression = diff(await make(false), await make(true), { gate: "interval" });

    expect(regression.regressedMetrics?.some((entry) => entry.scope === "category:rare")).toBe(
      true,
    );
    expect(regression.regressedMetrics?.some((entry) => entry.scope === "category:big")).toBe(
      false,
    );
  });

  it("should gate on stable failures only when asked", async () => {
    const baseline = await runEval(
      fakeAgent(() => "ok"),
      {
        cases,
        scorers: [exact()],
      },
    );
    const options = { cases, scorers: [exact()], repeat: 2, baseline, tolerance: 1 };

    const lenient = await runEval(fakeAgent(answer), options);
    const strict = await runEval(fakeAgent(answer), { ...options, failOnStableFailures: true });

    expect(lenient.regression?.passed).toBe(true);
    expect(lenient.regression?.stableFailures).toEqual(["broken"]);
    expect(strict.regression?.passed).toBe(false);
  });

  it("should pass the interval gate through agent.eval options", async () => {
    const baseline = await baselineWith(9);
    const current = await runEval(
      fakeAgent((_input, attempt) => (attempt < 7 ? "ok" : "bad")),
      {
        cases: [{ name: "q", input: "q", expected: "ok" }],
        scorers: [exact()],
        repeat: 10,
        baseline,
        gate: "interval",
      },
    );

    expect(current.regression?.passed).toBe(true);
  });
});

describe("baseline files", () => {
  it("should round-trip repeat counts, per-case counts and intervals", async () => {
    const report = await runEval(fakeAgent(answer), { cases, scorers: [exact()], repeat: 3 });
    const restored = fromJSON(toJSON(report));

    expect(restored.repeat).toBe(3);
    expect(restored.stats?.overall.passRateInterval).toEqual(
      report.stats?.overall.passRateInterval,
    );
    expect(restored.cases[1].passes).toBe(2);
    expect(restored.cases[1].scoreInterval).toEqual(report.cases[1].scoreInterval);
    expect(restored.cases[1].passRateInterval).toEqual(report.cases[1].passRateInterval);
  });

  it("should accept an older baseline without runs or stats", async () => {
    const legacy: EvalReport = {
      agentName: "fake",
      total: 1,
      passedCount: 1,
      failedCount: 0,
      passRate: 1,
      meanScore: 1,
      passed: true,
      duration: 0,
      cases: [
        {
          case: { name: "q", input: "q" },
          result: { text: "ok" } as unknown as EvalReport["cases"][number]["result"],
          scores: [{ score: 1, passed: true }],
          score: 1,
          passed: true,
          duration: 0,
        },
      ],
    };

    const current = await runEval(
      fakeAgent((_input, attempt) => (attempt < 2 ? "ok" : "bad")),
      {
        cases: [{ name: "q", input: "q", expected: "ok" }],
        scorers: [exact()],
        repeat: 3,
        baseline: legacy,
        gate: "interval",
      },
    );

    expect(current.regression).toBeDefined();
    expect(current.regression?.regressed).toEqual([]);
  });
});

describe("toJUnit with repeats", () => {
  it("should report pass counts for repeated cases", async () => {
    const report = await runEval(fakeAgent(answer), { cases, scorers: [exact()], repeat: 3 });
    const xml = toJUnit(report);

    expect(xml).toContain("passed 2/3 runs");
    expect(xml).toContain("passed 0/3 runs");
    expect(xml).toContain("<system-out>passed 3/3 runs</system-out>");
  });
});
