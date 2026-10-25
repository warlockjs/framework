---
title: "Evaluation and datasets"
description: ai.dataset() plus baseline/tolerance regression and the ai.eval CI reporters — turn agent.eval into a regression-gated, shardable, JUnit-emitting CI quality check.
sidebar:
  order: 1
  label: "Evaluation and datasets"
---

This page is about the **mechanics that turn `agent.eval` into a CI gate**: where the cases come from (`ai.dataset()`), how a run is judged against the last good run (`baseline` / `tolerance` → `report.regression`), and how the result lands in CI (`ai.eval.toJUnit` / `toJSON` / `fromJSON`). For the philosophy of _what_ to test and _when_, see [Testing and evals](/v/latest/ai/best-practices/testing-and-evals/); this page is the toolkit those practices stand on.

## `ai.dataset()` — a taggable, filterable, shardable case set

`agent.eval` accepts either a raw `EvalCase[]` or a `DatasetContract`. A dataset is an immutable wrapper around eval cases (every entry is a valid `EvalCase` plus optional `tags`) that you can filter and shard:

```ts
import { ai } from "@warlock.js/ai";

const ds = ai.dataset({
  name: "support",
  cases: [{ name: "greeting", input: "hi", expected: "Hello", tags: ["smoke"] }],
  fromFile: "./eval/support.jsonl", // appended after inline `cases`
});

const report = await agent.eval({ cases: ds, scorers: [ai.eval.contains()] });
```

### Sources — inline + JSONL

`cases` are inline entries; `fromFile` reads a **JSONL** file once, synchronously, at construction — one JSON object per line, each a `DatasetEntry`. Blank lines are skipped; a malformed line throws an `InvalidRequestError` naming the **1-based line number** (failing loud at construction, like `SystemPrompt.fromFile`). Both sources combine — file entries append after inline `cases`.

```jsonl
{ "name": "refund-policy", "input": "Can I get a refund?", "expected": "30 days", "tags": ["policy"] }
{ "name": "shipping", "input": "Where is my order?", "tags": ["smoke"] }
```

### `filter()` — narrow by tag (or anything)

Returns a new dataset sharing nothing mutable with this one:

```ts
const smoke = ds.filter((entry) => entry.tags?.includes("smoke"));
const report = await agent.eval({ cases: smoke, scorers: [ai.eval.exact()] });
```

### `shard(index, total)` — split across parallel CI jobs

Deterministic round-robin by position. Every entry lands in exactly one shard, so the union of all `total` shards reproduces the full case list with no gaps or overlaps:

```ts
// In CI job N of 4:
const shard = ds.shard(Number(process.env.SHARD_INDEX), 4);
await agent.eval({ cases: shard, scorers: [ai.eval.contains()] });
```

`total` must be a positive integer and `index` in `[0, total)`, else `shard()` throws an `InvalidRequestError`.

## Regression gating — `baseline` and `tolerance`

Pass a prior `EvalReport` as `baseline` and the new report carries a `regression` block. Cases are joined by `name`; a case **regresses** when its new aggregate score drops more than `tolerance` below the baseline (`before - after > tolerance`):

```ts
import { readFile } from "node:fs/promises";

const baseline = ai.eval.fromJSON(await readFile("./eval/baseline.json", "utf8"));

const report = await agent.eval({
  cases: ds,
  scorers: [ai.eval.contains()],
  baseline,
  tolerance: 0.05, // allow a 5% wobble before flagging a regression. default 0 (any drop)
});

expect(report.regression?.passed).toBe(true);
```

`report.regression` is an `EvalRegression`:

```ts
type EvalRegression = {
  regressed: Array<{ name: string; before: number; after: number }>;
  removed: string[]; // in baseline, absent now
  added: string[]; // new now, absent in baseline
  passed: boolean; // true when nothing regressed beyond tolerance
  regressedMetrics?: Array<{
    scope: string;
    metric: "passRate" | "meanScore";
    before: number;
    after: number;
    interval: { low: number; high: number };
  }>; // interval gate
  stableFailures?: string[]; // repeat > 1
  flaky?: string[]; // repeat > 1
};
```

Cases present in only one report surface under `added` / `removed` rather than as regressions — **adding or dropping a case never fails the gate by itself.** `passed` flips false only when a real case got worse beyond tolerance. The diff is a pure function of the two reports and the tolerance; you can also call it directly as `ai.eval`'s underlying `diff(report, baseline, tolerance)` if you have both reports in hand. The third argument also accepts `{ tolerance, gate, confidence, failOnStableFailures }`; see [Repeated runs and variance-aware gating](#repeated-runs-and-variance-aware-gating).

### The baseline loop

Today's report becomes tomorrow's baseline. Serialize a known-good run and commit it:

```ts
await writeFile("./eval/baseline.json", ai.eval.toJSON(report));
```

`toJSON` emits the whole report verbatim (results, per-case scores, timings, any attached `regression`); `fromJSON` parses it back. Scorers were never part of the serialized report, so the round-trip is over plain data — exactly what regression diffing needs.

## Repeated runs and variance-aware gating

A language model scores a few points differently every run, so one run compared with one baseline flags regressions that are only noise. Set `repeat` to run every case several times and let the gate account for the spread:

```ts
const report = await agent.eval({
  cases: ds, // entries may carry a `category`
  scorers: [ai.eval.contains()],
  repeat: 5, // default 1: a single run, behavior unchanged
  confidence: 0.95, // interval level, default 0.95
  baseline,
  gate: "interval", // default "point"
  tolerance: 0.02,
  failOnStableFailures: true,
});
```

Runs execute one after another (the eval runner has no parallelism, so the concurrency you already have is unchanged); each case runs `repeat` times before the next case starts. A case passes only when **all** its runs pass.

### What the report adds

- Per case: `repeat`, `passes` (e.g. `2` of `3`), `runs` (score, verdict and duration of each run), `score` (mean of the runs), `scoreInterval` and `passRateInterval`. `result` and `scores` are those of the first failing run, or of the first run when all passed. `onFailure` fires once per failing case.
- `report.stats`: pooled `overall` statistics plus one entry per `EvalCase.category`. Every run of every case is a sample, so `repeat: 3` over 10 cases gives 30. Each entry holds `runs`, `passes`, `passRate` with a Wilson `passRateInterval`, and `meanScore` with a Student-t `meanScoreInterval`.
- With `repeat > 1`: `report.stableFailures` (cases that failed every run) and `report.flakyCases` (failed some runs, passed others). A stable failure is a defect; a flaky case is variance. Treat them differently.
- `toJUnit` adds `passed 2/3 runs` to repeated cases.

### The statistics

- **Pass rates** use the Wilson score interval. It stays inside `[0, 1]`, is not degenerate at 0% or 100%, and is wide for small samples (2 of 2 passing gives a lower bound near 0.34, not "100%").
- **Mean scores** use a Student-t interval on the run scores, clamped to `[0, 1]`. With fewer than two samples there is no variance estimate, so the interval is the whole `[0, 1]` range.
- Runs are treated as independent samples. Pooling the runs of different cases also folds case-to-case difficulty into the spread, which makes the interval conservative (wider), never falsely tight.
- A small category therefore shows a wide interval instead of false precision.

### The interval gate

`gate: "point"` (default) is the original rule: a case regresses when `before - after > tolerance`.

`gate: "interval"` flags a regression only when the baseline and current intervals are **separated**: the baseline's lower bound is above the current upper bound by more than `tolerance`. Both sides' uncertainty counts, so noise inside the intervals does not fail the gate, while a drop clearly outside them does. The rule is applied to each case (needs two or more runs) and to the overall and per-category pass rate and mean score, reported as `regression.regressedMetrics` (`{ scope: "overall" | "category:<name>", metric, before, after, interval }`). A baseline side with fewer than two samples contributes its point value; a current case with fewer than two runs uses the point rule.

`regression.stableFailures` and `regression.flaky` mirror the report lists. `failOnStableFailures: true` also fails `regression.passed` when any case failed every run, independent of the baseline comparison.

### Baseline files

`toJSON` stores `repeat`, per-case `passes`, `runs` and intervals, and `stats`. Baselines written before repeats exist (no `runs`, no `stats`) keep working: each case counts as one sample, so use `gate: "point"` or re-record the baseline with `repeat` to get meaningful intervals.

## CI reporters

### `ai.eval.toJUnit(report)` — JUnit-XML artifact

A pure, runner-decoupled reporter: one `<testsuite>` named for the agent, one `<testcase>` per case, a `<failure>` child on each case that didn't pass (carrying the joined scorer reasons, or `agent error: ...` when the agent itself errored), and a `time` attribute in **seconds** (JUnit's unit). Every dynamic value is XML-entity-escaped.

```ts
import { writeFile } from "node:fs/promises";

const report = await agent.eval({ cases: ds, scorers: [ai.eval.exact()] });
await writeFile("./report.junit.xml", ai.eval.toJUnit(report));
```

Most CI systems ingest this directly to render a per-case pass/fail view.

### `ai.eval.toJSON` / `fromJSON` — round-trippable snapshot

The same pair that drives the baseline loop. Use `toJSON` to archive a run as a build artifact and `fromJSON` to load last release's report as the next run's `baseline`.

## A complete CI gate

```ts
import { describe, expect, it } from "vitest";
import { ai } from "@warlock.js/ai";
import { readFile, writeFile } from "node:fs/promises";

const hasKeys = Boolean(process.env.OPENAI_API_KEY);

describe.runIf(hasKeys)("support-agent quality", () => {
  it("does not regress against the committed baseline", async () => {
    const ds = ai.dataset({ name: "support", fromFile: "./eval/support.jsonl" });
    const baseline = ai.eval.fromJSON(await readFile("./eval/baseline.json", "utf8"));

    const report = await supportAgent.eval({
      cases: ds,
      scorers: [ai.eval.contains()],
      judge: { agent: judgeAgent, rubric: "Score 1.0 only if the policy is stated correctly." },
      baseline,
      tolerance: 0.05,
    });

    await writeFile("./report.junit.xml", ai.eval.toJUnit(report));

    expect(report.passed).toBe(true); // every case passed outright
    expect(report.regression?.passed).toBe(true); // nothing got worse vs baseline
  });
});
```

Gate the live quality suite behind `describe.runIf(hasKeys)` so the fast, offline wiring tests never need API keys — see [Testing and evals](/v/latest/ai/best-practices/testing-and-evals/) for the wiring-vs-quality split.

## Tool-use checks

Two built-in scorers catch an agent that talks about acting instead of acting:

```ts
scorers: [
  ai.eval.requiredToolCalled({ tools: ["update_plan"], intents: [/\bswap\b/i] }),
  ai.eval.changeClaimedWithoutToolCall({ tools: ["update_plan"] }),
];
```

`requiredToolCalled` fails with "required tool not called" when a case that asks for an action got no successful call to a required tool. `changeClaimedWithoutToolCall` fails with "change claimed without a tool call" when the reply says something was changed and no change tool completed. The agent options that prevent both are in the [tool-use contract](/v/latest/ai/agents/tool-use-contract/).

## Related

- [Testing and evals](/v/latest/ai/best-practices/testing-and-evals/) — the philosophy: split deterministic wiring tests from live quality evals; seed cases from production failures.
- [Record / replay testing](/v/latest/ai/testing/record-replay-testing/) — make the live eval suite deterministic and free by replaying recorded model calls.
- [Prompt registry](/v/latest/ai/prompts/prompt-registry/) — `validate()` lints prompt _text_; `agent.eval` measures the _behaviour_ it produces.
