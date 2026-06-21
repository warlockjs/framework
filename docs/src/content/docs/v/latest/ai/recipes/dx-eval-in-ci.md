---
title: "Recipe — Gate a prompt change in CI with agent.eval"
description: Write agent.eval as a Vitest test — fixed cases, exact and predicate scorers, plus an LLM judge — so a prompt regression fails the build before it ships.
sidebar:
  order: 11
  label: "Eval in CI"
---

You changed a system prompt. It looks better. Does it actually still answer the ten questions you care about, and does it still sound on-brand? The only honest answer is a regression suite that runs your agent against fixed cases and asserts on the outcome — and the natural home for that is the test runner you already have. `agent.eval` returns an assertion-friendly `EvalReport`; wrap it in a Vitest test and a prompt regression turns red in CI before it reaches a user.

## The scenario

A docs Q&A agent answers product questions. The eval suite mixes three kinds of check:

- **Factual** cases with a known answer — graded by an `exact` / `contains` scorer (cheap, deterministic).
- **Structural** cases — graded by a `predicate` scorer that asserts on the result shape (no tool errored, output parsed).
- **Subjective** cases (tone, helpfulness) with no single right answer — graded by an **LLM judge** against a rubric.

The whole thing is one `*.spec.ts` that the build runs.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-anthropic @warlock.js/seal
yarn add -D vitest
```

CI needs the provider keys in the environment. Gate the suite so local runs without keys skip rather than fail.

## The agent under test and the judge

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });

// The agent we're guarding against regressions.
export const docsAgent = ai.agent({
  name: "docs-qa",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You answer questions about the Warlock framework.")
    .instruction("Be concise. If unsure, say so — never invent an API."),
});

// A separate, name-bearing judge agent with a verdict-shaped output schema.
// The judge runner reads { score, passed, reason } off result.data.
const verdictSchema = v.object({
  score: v.number().min(0).max(1),
  passed: v.boolean(),
  reason: v.string(),
});

const judgeAgent = ai.agent({
  name: "eval-judge",
  model: anthropic.model({ name: "claude-sonnet-4-5" }),
  output: verdictSchema,
  systemPrompt: ai.systemPrompt().persona(
    "You are a strict grader. Score answers 0..1 and return the JSON verdict.",
  ),
});
```

## The Vitest suite

```ts
import { describe, expect, it } from "vitest";

const hasKeys = !!process.env.OPENAI_API_KEY && !!process.env.ANTHROPIC_API_KEY;

describe.runIf(hasKeys)("docs-qa eval", () => {
  it("passes the factual + structural suite", async () => {
    const report = await docsAgent.eval({
      cases: [
        {
          name: "schema-builder",
          input: "What package provides the v schema builder?",
          expected: "@warlock.js/seal",
          scorers: [ai.eval.contains()],
        },
        {
          name: "execute-never-throws",
          input: "Does agent.execute throw on a provider error?",
          expected: "no",
          scorers: [ai.eval.contains()],
        },
        {
          name: "no-tool-errors",
          input: "Summarize how supervisors route between agents.",
          // A predicate scorer asserts on the result, not the text:
          // every child report node completed and the agent didn't error.
          scorers: [
            ai.eval.predicate(
              (ctx) =>
                ctx.result.error === undefined &&
                ctx.result.report.children.every((child) => child.status === "completed"),
            ),
          ],
        },
      ],
      // Suite-wide threshold for scorers that return only a numeric score.
      passThreshold: 0.5,
      onFailure: (caseResult) =>
        console.error(
          `FAILED ${caseResult.case.name} (score ${caseResult.score.toFixed(2)})`,
          caseResult.scores.map((s) => s.reason).filter(Boolean),
        ),
    });

    // `report.passed` is true only when EVERY case passed.
    expect(report.passed).toBe(true);
    expect(report.passRate).toBe(1);
  });

  it("passes the subjective suite via an LLM judge", async () => {
    const report = await docsAgent.eval({
      cases: [
        { name: "tone-unsure", input: "What is the airspeed of an unladen swallow?" },
        { name: "tone-helpful", input: "I'm new — where do I start?" },
      ],
      // No per-case scorers → the judge grades every case.
      judge: {
        agent: judgeAgent,
        rubric:
          "Score 1.0 only if the answer is honest about uncertainty and never invents an API. Penalize confident hallucination heavily.",
        passThreshold: 0.7,
      },
    });

    expect(report.passed).toBe(true);
    expect(report.meanScore).toBeGreaterThanOrEqual(0.7);
  });
});
```

## How scoring resolves

For each case, the runner resolves scorers in this precedence: the case's own `scorers` → the suite-level `scorers` → the suite `judge`. A case that can resolve none throws at author time — an eval that can't score a case is a config bug, not a silent pass. A case passes only when the agent did **not** error AND every resolved scorer passes. `report.passed` is the AND across the whole suite, which is exactly what you `expect(...).toBe(true)`.

The built-in scorers, all on `ai.eval`:

- `ai.eval.exact()` — output equals `expected` (trimmed, case-insensitive; structured values compared by canonical JSON).
- `ai.eval.contains()` — `expected` appears as a substring of the output.
- `ai.eval.predicate(fn)` — wrap any boolean assertion over the full `EvalScorerContext` (`ctx.result`, `ctx.output`, `ctx.text`).
- `ai.eval.judge(config)` — LLM-as-judge against a rubric.

## Production notes

:::tip[Keep the deterministic and judge suites separate]
Exact/contains/predicate scorers are free and stable — run them on every PR. The judge suite costs real tokens and carries grader variance, so it's worth splitting into its own test (or a nightly job) and giving the judge a `passThreshold` with headroom. Mixing a flaky judge into your fast feedback loop trains people to ignore red.
:::

- **`eval` never throws on a case failure.** Failures surface on the report (`report.passed`, per-case `passed`) and through `onFailure` — so a single broken case gives you the whole picture, not a stack trace on the first miss. The only author-time throw is the "no scorer resolvable" guard.
- **Cases run sequentially**, in suite order — deliberate, since cases share the agent and may carry side effects. Don't assume parallelism.
- **Give the judge an output schema.** The judge runner reads `{ score, passed, reason }` from `result.data` first, falling back to parsing raw text. A schema-bearing judge (as above) is far more reliable than text parsing; a judge that errors or returns unparseable text scores the case `0` rather than crashing the suite.
- **Gate on keys, not on luck.** `describe.runIf(hasKeys)` keeps the suite green on a contributor's machine with no API keys while still enforcing it in CI where the keys exist.
- **`onFailure` throws are swallowed** so a logging bug can't abort the run — log inside it, don't depend on it propagating.

## Related

- [Basic agent](./basic-agent) — the agent shape under evaluation.
- [Deterministic supervisor tests](./dx-deterministic-supervisor-tests) — fast, no-LLM tests for multi-agent flows.
