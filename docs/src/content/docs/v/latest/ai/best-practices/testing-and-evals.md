---
title: "Best Practices — Testing and evals"
sidebar:
  label: "Testing and evals"
description: Test AI flows the way a senior engineer would — deterministic, zero-cost unit tests for routing and wiring with MockSDK and ai.mockRouter, behavior-shaped matchers, and agent.eval as a CI quality gate with an LLM judge. Each recommendation is a scenario-grounded do-this / avoid-that pair with runnable code.
---

The pillar this page answers: **how do you keep an AI system from silently regressing — without a slow, flaky, expensive test suite?**

AI code has two completely different failure modes, and conflating them is the root of every bad AI test suite. The **wiring** can break — the supervisor routes to the wrong specialist, a workflow step is skipped, the run never converges. The **quality** can break — the prompt change made answers worse, the new model hallucinates an API. The first is deterministic logic you can pin down with no model at all; the second is a statistical property you can only measure against real model output. Test them with the same tool and you get the worst of both: a wiring bug hidden behind grader variance, or a quality gate so slow nobody runs it.

The discipline below is to **split the two**. Wiring goes in fast, offline, deterministic unit tests — `MockSDK`, `ai.mockRouter`, `mockAgent`, and the report matchers. Quality goes in `agent.eval` with real models and an LLM judge, run as a CI gate on prompt and model changes. Everything here is one running scenario.

## The running scenario

A draft-then-review content supervisor: a `writer` agent drafts a launch post, a `critic` agent reviews it, then the run ends. It sits behind a docs-QA agent that answers product questions and must never invent an API. Two things can regress: the supervisor's routing (a wiring concern) and the agent's answer quality after a prompt edit (a quality concern). Every recommendation makes one of those two safe to change.

## Test wiring with `MockSDK` — fast, deterministic, zero cost

The supervisor's logic — which intent runs, in what order, whether the run converges — is plain control flow. Routing it through a real LLM router makes that test slow, costly, and non-deterministic: a green-then-red-then-green suite trains the team to ignore the one signal that should never be ignored. `MockSDK` is a real `SDKAdapterContract` that returns scripted responses with no HTTP call, so the model layer becomes a fixture and the only thing left under test is your wiring.

**Do this — script the model with `MockSDK` (or `mockAgent`) and assert offline.** No API key, no network, no variance. `mockAgent` is the one-call shortcut that wires `MockSDK` → model → `agent()` for you.

```ts
import { ai, mockAgent } from "@warlock.js/ai";

// Each intent returns exactly what you scripted — the model is a fixture.
const writer = mockAgent({
  name: "writer",
  responses: [{ content: "Here is a draft.", finishReason: "stop" }],
});

const critic = mockAgent({
  name: "critic",
  responses: [{ content: "Looks good, ship it.", finishReason: "stop" }],
});

const supervisor = ai.supervisor({
  name: "draft-then-review",
  intents: { writer, critic },
  route: ai.mockRouter(["writer", "critic", END]), // canned, one decision per iteration
  maxIterations: 4,
});

const result = await supervisor.execute("Write a launch post.");
expect(result.error).toBeUndefined();
```

**Avoid this — a live model in a wiring test.** Pointing the supervisor at a real provider to check that it routes `writer` then `critic` pays tokens, adds network latency, and — worse — makes the test's outcome depend on what the model decided that run. When it goes red you can't tell a routing bug from a model mood swing, so eventually you stop trusting it.

```ts
// Anti-pattern: a real router in a test that's only about routing ORDER.
const supervisor = ai.supervisor({
  name: "draft-then-review",
  intents: { writer, critic },
  router: realRouterAgent, // slow, costs tokens, non-deterministic — for a logic check
});
```

> `MockSDK` accepts a `responses` array (consumed in order, last one repeats), and each `MockModelResponse` can carry `toolCalls`, a `usage`, a `delay`, or an `error` to throw — enough to exercise tool loops, latency handling, and provider-error paths without a provider. Reach for raw `MockSDK` when you need that control; reach for `mockAgent` when you just need a scripted agent.

## Drive routing with `ai.mockRouter`, not a hand-rolled stub

A supervisor's `route` is a callback that returns the next intent per iteration. You *could* hand-write a closure with a counter, but you'd re-implement exhaustion handling and state-branching every time, slightly differently. `ai.mockRouter` is the canonical double: a canned sequence consumed one decision per iteration, with a typed `onExhausted` policy for what happens past the end of the queue.

**Do this — a canned sequence, with an explicit exhaustion policy when it matters.** `route` and `router` are mutually exclusive on a supervisor, so dropping in `mockRouter` is a clean one-field swap for the LLM router. A function decision reads the live `RouteContext`, so you can branch on accumulated state instead of scripting an exact per-turn sequence.

```ts
// Literal sequence: writer, then critic, then stop.
route: ai.mockRouter(["writer", "critic", END]);

// Branch on state, and replay the last decision past the end of the queue.
route: ai.mockRouter<{ critiqued?: boolean }>(
  ["writer", (ctx) => (ctx.iterations.length >= 2 ? END : "critic")],
  { onExhausted: "repeat" },
);

// Fail loudly if the supervisor iterates more than the scripted turns.
route: ai.mockRouter(["writer", "critic"], { onExhausted: "throw" });
```

**Avoid this — a bespoke counter stub that silently ends.** A hand-rolled `let i = 0; return seq[i++] ?? END` looks fine until the supervisor loops one extra time: it quietly returns `END` and the test passes, hiding the very over-iteration bug you'd want to catch. `mockRouter`'s `onExhausted: "throw"` turns that silent over-run into a red test.

```ts
// Anti-pattern: a stub that hides an extra iteration instead of surfacing it.
let i = 0;
const seq = ["writer", "critic"];
route: () => seq[i++] ?? END; // over-iteration → silent END → false green
```

> The three exhaustion modes map to three intents. `"end"` (default): script the interesting turns, let the run stop. `"repeat"`: keep routing to the same intent until a state condition flips. `"throw"`: every iteration must be accounted for. Pick `"throw"` when "did it iterate exactly N times" is part of what you're asserting.

## Let the matchers carry the assertion — `toRouteTo`, `toConverge`, `toPassStep`, `toOutputShape`

The point of a test is that its assertions read like the behavior you care about. Digging the dispatched intents out of `result.report.snapshots` by hand works, but the next reader has to reverse-engineer what you meant. The registered matchers read the same unified report tree every primitive produces and name the behavior directly — and because they assert on the report, they're fully deterministic. Register them once per file (it's idempotent, and surfaced through a lazy bridge so importing `@warlock.js/ai` in production never pulls in `vitest`).

**Do this — assert in the vocabulary of the flow.** Pass either the result envelope or `result.report`. `toConverge()` is the single best "did the flow actually work" assertion — it fails on `max-iterations`, on cancellation, and on error, catching the three ways a supervisor run goes wrong in one line.

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { ai, mockAgent, registerAiMatchers, END } from "@warlock.js/ai";

beforeAll(() => {
  registerAiMatchers(); // idempotent — toRouteTo / toConverge / toPassStep / toOutputShape
});

describe("draft-then-review supervisor", () => {
  it("dispatches writer then critic and converges", async () => {
    const supervisor = ai.supervisor({
      name: "draft-then-review",
      intents: {
        writer: mockAgent({ name: "writer", responses: [{ content: "draft", finishReason: "stop" }] }),
        critic: mockAgent({ name: "critic", responses: [{ content: "ship it", finishReason: "stop" }] }),
      },
      route: ai.mockRouter(["writer", "critic", END]),
      maxIterations: 4,
    });

    const result = await supervisor.execute("Write a launch post.");

    expect(result).toRouteTo("writer");
    expect(result).toRouteTo("critic");
    expect(result).toConverge(); // terminated on its own decision, not the iteration cap
  });
});
```

`toPassStep` is the workflow counterpart, and `toOutputShape` validates a result's `data` against a Standard Schema (a `@warlock.js/seal` schema is one):

```ts
import { v } from "@warlock.js/seal";

const outputSchema = v.object({ post: v.string() });

// Workflow: assert a named step completed.
expect(await contentWorkflow.execute({})).toPassStep("draft");

// Any executable with a typed output: assert the shape.
const result = await typedSupervisor.execute("Draft it.");
expect(result).toConverge();
expect(result).toOutputShape(outputSchema);
```

**Avoid this — re-deriving the verdict inline.** Hand-walking the report not only obscures intent, it bakes the report's internal shape into every test, so a report refactor breaks fifty tests instead of one matcher. And it's easy to get subtly wrong — checking only `status === "completed"` misses that `max-iterations` *also* completes, which is exactly the bug `toConverge` exists to catch.

```ts
// Anti-pattern: the verdict logic, re-implemented (and subtly wrong) in the test.
const dispatched = result.report.snapshots.flatMap((s) => Object.keys(s.result));
expect(dispatched).toContain("writer");
expect(result.report.status).toBe("completed"); // passes even on max-iterations!
```

## Gate prompt and model changes with `agent.eval` plus an LLM judge

Deterministic tests prove the wiring is intact; they say nothing about whether the answer got *better* or *worse*. That's a quality property, and the only honest way to measure it is to run the real agent against fixed cases and score the output. `agent.eval` returns an assertion-friendly `EvalReport` — wrap it in a Vitest test and a prompt regression turns red in CI before it ships. Mix three scorer kinds: cheap deterministic ones (`exact` / `contains`) for factual cases, a `predicate` for structural cases, and an **LLM judge** for the subjective ones with no single right answer.

**Do this — a fixed case suite, scored, asserted on `report.passed`.** Give the judge a verdict-shaped output schema and a rubric; the runner reads `{ score, passed, reason }` off `result.data`. A case passes only when the agent did not error AND every resolved scorer passed; `report.passed` is the AND across the suite — exactly what you assert.

```ts
import { describe, expect, it } from "vitest";
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });

const docsAgent = ai.agent({
  name: "docs-qa",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You answer questions about the Warlock framework.")
    .instruction("Be concise. If unsure, say so — never invent an API."),
});

// A separate, name-bearing judge with a verdict-shaped output schema.
const judgeAgent = ai.agent({
  name: "eval-judge",
  model: anthropic.model({ name: "claude-sonnet-4-5" }),
  output: v.object({ score: v.number().min(0).max(1), passed: v.boolean(), reason: v.string() }),
  systemPrompt: ai.systemPrompt().persona(
    "You are a strict grader. Score answers 0..1 and return the JSON verdict.",
  ),
});

const hasKeys = !!process.env.OPENAI_API_KEY && !!process.env.ANTHROPIC_API_KEY;

describe.runIf(hasKeys)("docs-qa eval", () => {
  it("passes the factual + subjective suite", async () => {
    const report = await docsAgent.eval({
      cases: [
        // Factual — deterministic scorer.
        { name: "schema-builder", input: "What package provides the v schema builder?", expected: "@warlock.js/seal", scorers: [ai.eval.contains()] },
        // Structural — predicate over the result, not the text.
        { name: "no-tool-errors", input: "Summarize how supervisors route.", scorers: [
          ai.eval.predicate((ctx) =>
            ctx.result.error === undefined &&
            ctx.result.report.children.every((child) => child.status === "completed"),
          ),
        ]},
        // Subjective — no per-case scorer, so the suite judge grades it.
        { name: "tone-unsure", input: "What is the airspeed of an unladen swallow?" },
      ],
      judge: { agent: judgeAgent, rubric: "Score 1.0 only if honest about uncertainty and it never invents an API.", passThreshold: 0.7 },
      onFailure: (caseResult) =>
        console.error(`FAILED ${caseResult.case.name}`, caseResult.scores.map((s) => s.reason)),
    });

    expect(report.passed).toBe(true); // true only when EVERY case passed
  });
});
```

**Avoid this — eyeballing the diff after a prompt edit.** "It looks better" is not a regression test. Without a fixed suite, a prompt change that fixes one phrasing and breaks three others ships green, and you find out from a user. The whole point of `eval` is to convert "looks better" into a number the build can gate on.

> Scorers resolve per case in precedence order: the case's own `scorers` → the suite `scorers` → the suite `judge`. A case that resolves none throws at **author** time — an eval that can't score a case is a config bug, not a silent pass. Cases run **sequentially** in suite order (they share the agent and may carry side effects), and `eval` never throws on a case failure — failures surface on `report.passed`, per-case `passed`, and through `onFailure` (whose own throws are swallowed so a logging bug can't abort the run).

## Keep the deterministic and judge suites apart

The two suites have opposite economics. The deterministic suite (mock SDK, matchers, `exact`/`contains`/`predicate`) is free, fast, and stable — it belongs on **every PR**. The judge suite costs real tokens and carries grader variance, so mixing it into your fast feedback loop makes the whole loop slow and occasionally red for reasons unrelated to the diff — which trains people to ignore red.

**Do this — gate the suites differently.** Run the deterministic suite on every push; run the judge suite on prompt/model changes (or nightly), gated on keys so a contributor without API keys gets a green skip rather than a red failure, and give the judge a `passThreshold` with headroom for variance.

```ts
// Deterministic: no keys, runs everywhere, every time.
describe("supervisor wiring", () => { /* mockRouter + matchers */ });

// Judge: real tokens, real variance — gated on keys, generous threshold.
const hasKeys = !!process.env.OPENAI_API_KEY && !!process.env.ANTHROPIC_API_KEY;
describe.runIf(hasKeys)("docs-qa quality", () => { /* agent.eval with judge */ });
```

**Avoid this — one suite that mixes mock wiring tests and a live judge.** Now your fast unit run needs API keys, costs money on every push, and goes red when the grader has an off day — so the team learns that red doesn't mean broken, and the day a real regression lands, nobody looks.

> A useful rule of thumb: if a test would give a different verdict on two identical runs, it does not belong in the suite that gates every push. The deterministic suite must be boringly reproducible; the judge suite is allowed to be statistical, which is exactly why it lives elsewhere.

## Write a failing eval case the moment you fix a bug

A bug you fixed once will come back the moment someone re-tunes the prompt — unless a case remembers it. The cheapest regression insurance in an AI system is the discipline of turning every fixed bug into a permanent eval case before you close the ticket. The fix proves the case passes today; the case proves it stays fixed tomorrow.

**Do this — capture the exact failing input as a case the instant you fix it.** Use the real input the bug surfaced on, and pick the scorer that encodes the actual defect — `contains` for "must mention X", `predicate` for "must not error / must parse", `judge` for "must not confidently hallucinate".

```ts
// Bug: the agent invented `request.validate()` (no such API) for this question.
// Fix: tightened the "never invent an API" instruction. Lock it in:
{
  name: "regression-no-invented-validate-api",
  input: "How do I validate a request body in Warlock?",
  scorers: [ai.eval.predicate((ctx) => !/request\.validate\(/.test(ctx.text ?? ""))],
}
```

**Avoid this — fixing the prompt and moving on.** With no case, the regression is one well-meaning prompt edit away from returning, and the next person has zero signal that this exact failure ever mattered. An undocumented fix is a fix with a half-life.

> Name regression cases so the name *is* the story — `regression-no-invented-validate-api`, not `case-7`. When it fails in CI six months later, the name alone tells the next engineer what broke and why the case exists.

## Seed eval datasets from real Panoptic traces

The best eval cases are the ones production actually failed on — they're real inputs, real failures, and you didn't have to imagine them. If you've wired `@warlock.js/ai-panoptic`, every run is captured as a `Trace`, and the in-memory trace store is queryable: `query({ status: "failed" })` hands you exactly the runs worth turning into cases. This closes the loop — production failures become the regression suite that prevents them.

**Do this — pull failed traces and seed cases from them.** Query the store for failures in a window, lift each trace's input (the root span's `attributes` carry the primitive-specific detail the collector recorded), and add it as a case. The `fileExporter` persists traces to disk, so the same approach works against an offline trace dump in CI.

```ts
import { createCollector, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const collector = createCollector();
collector.use(store); // the store doubles as an exporter — traces fill as runs complete

// ...run production traffic through agents subscribed to the collector...

// Later: harvest the failures into eval cases.
const failed = store.query({ status: "failed", startedAfter: "2026-06-18T00:00:00.000Z" });

const seededCases = failed.map((trace, index) => ({
  name: `seed-${trace.traceId}`,
  // The input lives in the root span's attribute bag the collector recorded.
  input: String(trace.root.attributes?.input ?? ""),
}));

// Feed seededCases straight into agent.eval({ cases: seededCases, judge: { ... } }).
```

**Avoid this — inventing synthetic cases from your imagination of how users phrase things.** Hand-written cases test the failures you *expect*; the ones that bite are the phrasings you never anticipated. A suite seeded from real traces is grounded in real traffic, so it catches the long tail synthetic cases miss — and it grows itself, every time production hits a new failure mode.

> A `TraceSpan` mirrors the execution report's identity, timing, status, and cost; the request-specific detail (input text, tool args digest, step name) rides in the `attributes` bag the collector populates. So "seed from traces" is really "lift the input from the failed trace's attributes and re-pose it as a case" — the trace tells you *what* failed and on *what input*; you supply the `expected` or the rubric.

## Avoid list

The short version — the mistakes that make an AI test suite slow, flaky, or quietly useless:

- **Don't put a live model in a wiring test.** Routing order, convergence, and step success are deterministic logic — script the model with `MockSDK` / `mockAgent` and assert offline, or your logic test inherits the model's variance.
- **Don't hand-roll a router stub that silently ends.** A bespoke counter hides over-iteration behind a false green; use `ai.mockRouter` and `onExhausted: "throw"` when every iteration must be accounted for.
- **Don't re-derive the verdict by walking the report inline.** Use `toRouteTo` / `toConverge` / `toPassStep` / `toOutputShape` — they read like the behavior and don't break on a report refactor. `toConverge` in particular catches the `max-iterations` case a naive `status === "completed"` check misses.
- **Don't ship a prompt or model change without an `agent.eval` gate.** "Looks better" is not a regression test; convert it into `report.passed` the build can fail on.
- **Don't mix the deterministic suite and the live judge in one run.** Keep the free, stable suite on every PR and the token-spending, variance-carrying judge gated on keys (or nightly) with threshold headroom.
- **Don't fix a bug without writing the failing case.** An undocumented fix is one prompt edit from regressing — capture the exact failing input as a named regression case before you close the ticket.
- **Don't invent synthetic cases when production already wrote them for you.** Seed datasets from `query({ status: "failed" })` over real Panoptic traces; they catch the phrasings you'd never have imagined.

## See also

- [Recipe — Deterministic supervisor tests](../recipes/dx-deterministic-supervisor-tests) — `ai.mockRouter` + `mockAgent` + the matchers, end to end with no LLM.
- [Recipe — Eval in CI](../recipes/dx-eval-in-ci) — `agent.eval` as a Vitest gate, with deterministic scorers and an LLM judge.
- [Recipe — Wire Panoptic](../recipes/observability-wire-panoptic) — the collector + store the seeding workflow draws its failed traces from.
- [Best Practices — Supervisors and routing](./supervisors-and-routing) — the routing decisions these wiring tests pin down.
- [Best Practices — Cost and efficiency](./cost-and-efficiency) — the model-tiering and budget choices an eval gate protects from regression.
- [Architecture — Supervisors](../architecture-concepts/supervisors) — the unified report tree every matcher reads.
