---
title: "Recipe — Deterministic supervisor tests with mockRouter + matchers"
description: Test a multi-agent supervisor with no LLM and no flakiness — drive routing with ai.mockRouter, script agents with mockAgent, and assert with toRouteTo / toConverge.
sidebar:
  order: 13
  label: "Deterministic supervisor tests"
---

A supervisor's wiring — which intent runs, in what order, and whether the run converges — is logic you can test without ever calling a model. Routing through a real LLM router makes that test slow, costly, and non-deterministic; a green-then-red-then-green suite trains the team to ignore it. `ai.mockRouter` replaces the LLM `route` decision with a canned sequence, `mockAgent` scripts each intent's reply, and the registered matchers (`toRouteTo`, `toConverge`, `toPassStep`, `toOutputShape`) assert on the unified report tree. The whole suite runs in milliseconds, offline, identically every time.

## The scenario

A draft-then-review supervisor: a `writer` agent drafts, a `critic` agent reviews, then the run ends. We want to assert three things deterministically:

1. both `writer` and `critic` were dispatched,
2. the supervisor converged (terminated on its own decision, not on the iteration cap),
3. the run produced no error.

No API key, no network, no variance.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/seal
yarn add -D vitest
```

`mockRouter`, `mockAgent`, and the matchers all ship from the package root. Register the matchers once per test file before using them.

## The supervisor and its test doubles

```ts
import { ai, mockAgent } from "@warlock.js/ai";

// Script each intent's reply — no model, fully deterministic.
const writer = mockAgent({
  name: "writer",
  responses: [{ content: "Here is a draft.", finishReason: "stop" }],
});

const critic = mockAgent({
  name: "critic",
  responses: [{ content: "Looks good, ship it.", finishReason: "stop" }],
});

function buildSupervisor(route: ReturnType<typeof ai.mockRouter>) {
  return ai.supervisor({
    name: "draft-then-review",
    intents: { writer, critic },
    route,
    maxIterations: 4,
  });
}
```

## The test

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { ai, registerAiMatchers, END } from "@warlock.js/ai";

beforeAll(() => {
  // Idempotent — registers toRouteTo / toConverge / toPassStep / toOutputShape.
  registerAiMatchers();
});

describe("draft-then-review supervisor", () => {
  it("dispatches writer then critic and converges", async () => {
    // One canned decision per iteration: writer, then critic, then stop.
    const supervisor = buildSupervisor(ai.mockRouter(["writer", "critic", END]));

    const result = await supervisor.execute("Write a launch post.");

    expect(result.error).toBeUndefined();
    expect(result).toRouteTo("writer");
    expect(result).toRouteTo("critic");
    expect(result).toConverge();
  });

  it("can branch the route on accumulated state", async () => {
    // A function decision reads the live RouteContext. Here: keep routing to
    // the critic until it has run once, then end. `onExhausted: "repeat"`
    // replays the last decision past the end of the queue.
    const supervisor = buildSupervisor(
      ai.mockRouter<{ critiqued?: boolean }>(
        ["writer", (ctx) => (ctx.iterations.length >= 2 ? END : "critic")],
        { onExhausted: "repeat" },
      ),
    );

    const result = await supervisor.execute("Write a launch post.");

    expect(result).toConverge();
    expect(result).toRouteTo("critic");
  });
});
```

## What the matchers assert

The matchers read the same unified report tree every primitive produces — they're report assertions, not LLM assertions, so they're fully deterministic. You can pass either the result envelope (`result`) or `result.report`.

- **`toRouteTo(intent)`** — the supervisor dispatched that intent at least once across its iterations (it scans each iteration snapshot's dispatched intents).
- **`toConverge()`** — the supervisor terminated cleanly on its own decision (`route` / `router` / `evaluate` / `classifier`) with status `"completed"` — NOT on `max-iterations`, `cancelled`, or `error`. This is the single best "did the flow work" assertion.
- **`toPassStep(name)`** — a named **workflow** step completed (for workflow results).
- **`toOutputShape(schema)`** — a result's `data` validates against a Standard Schema.

## Asserting a typed output with toOutputShape

When the supervisor declares an `output` schema, assert the shape directly:

```ts
import { v } from "@warlock.js/seal";

const outputSchema = v.object({ post: v.string() });

const supervisor = ai.supervisor({
  name: "typed-draft",
  intents: {
    writer: {
      agent: mockAgent({
        name: "writer",
        responses: [{ content: '{"post":"launch copy"}', finishReason: "stop" }],
      }),
      output: outputSchema, // strip-merges into supervisor state
    },
  },
  route: ai.mockRouter(["writer", END]),
  output: outputSchema,
});

const result = await supervisor.execute("Draft it.");

expect(result).toConverge();
expect(result).toOutputShape(outputSchema);
```

## Exhaustion behavior

`mockRouter` controls what happens once its canned queue runs dry, via `onExhausted`:

- `"end"` (default) — return `END`, terminating cleanly. Script the interesting turns and let the run stop.
- `"repeat"` — replay the last decision for every further iteration. Good for "keep routing here until a state condition flips."
- `"throw"` — throw on over-run, surfacing an unexpected extra iteration as a test failure. Use when every iteration must be accounted for.

```ts
// Fail loudly if the supervisor iterates more than the two scripted turns.
const strict = ai.mockRouter(["writer", "critic"], { onExhausted: "throw" });
```

## Production notes

:::tip[Test the wiring here, the prompts in eval]
This pattern verifies the deterministic skeleton — routing order, convergence, state branching — with zero model variance, so it belongs in your fast unit suite and runs on every PR. It deliberately says nothing about answer quality; that's what an LLM-backed `agent.eval` suite is for. Keep the two separate so a flaky model never reddens your wiring tests.
:::

- **`mockRouter` is a `route` callback, not a `router` agent** — `route` and `router` are mutually exclusive on a supervisor, so dropping in `mockRouter` is a clean swap for the LLM router with no other config change.
- **Function decisions get the live `RouteContext`** — branch on `ctx.iterations`, `ctx.state`, `ctx.feedback` to test state-dependent routing without scripting an exact per-turn sequence.
- **`registerAiMatchers()` is idempotent** — call it in `beforeAll` or at module top in each test file; repeated calls are a no-op. It's surfaced through a lazy bridge so importing `@warlock.js/ai` in production never pulls in `vitest`.
- **`toConverge` is your canary.** It fails on `max-iterations` (a routing bug that never terminates), on cancellation, and on error — one assertion catches the three ways a supervisor run goes wrong.
- **Use `mockAgent` for the intents.** Scripting each agent's `responses` keeps the whole supervisor offline and deterministic; the agents return exactly what you scripted, so the only thing under test is the supervisor's own logic.

## Related

- [Self-consistency voting](./dx-self-consistency-voting) — the fan-out supervisor these matchers test.
- [Eval in CI](./dx-eval-in-ci) — the complementary LLM-backed quality suite.
