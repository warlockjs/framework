---
title: "Run team"
description: ai.team() — thin sugar over ai.supervisor that maps a manager → route/router, members → intents, and a gate → evaluate, returning a real SupervisorContract.
sidebar:
  order: 8
  label: "Run team"
---

`ai.team(config)` is **thin, transparent sugar over [`ai.supervisor`](./run-supervisor)**. It builds a `SupervisorConfig` from a team-shaped config, calls `supervisor(...)`, and returns the **unchanged** `SupervisorContract<TOutput>` — the exact object `ai.supervisor` returns. So `ctx.intents.<member>.execute()`, `.asTool()`, `.resume()`, snapshots, and events all stay intact. `team()` owns **no loop of its own**.

The whole feature is one mapping:

| team field | becomes supervisor field |
| --- | --- |
| `manager` | `route` (deterministic `{ route }`) **XOR** `router` (an agent / `RouterEntry`) |
| `members` | `intents` |
| `gate` | `evaluate` |

Everything else (`goal`, `output`, `state`, `maxIterations`, `snapshotStore`, `on`, `observe`) passes through 1:1. The **one** behavioural difference from a hand-rolled supervisor: a team stamps its report/result with `type: "team"` (a first-class `ReportType`, not `"supervisor"`), so observers and Panoptic recognise it as its own type.

## The shape

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const codeTeam = ai.team({
  name: "code-team",
  goal: "Ship a tested module that passes review.",
  manager: techLeadRouter,                 // agent / RouterEntry → router; or { route } → deterministic
  members: { builder, reviewer, fixer },   // role-name → agent | workflow
  gate: "quality",                         // "quality" | "verify" | (ctx) => EvaluateResult
  output: v.object({ code: v.string() }),
  maxIterations: 6,                        // default 10 (the supervisor's)
});

const { data, report } = await codeTeam.execute("Build a debounce<T> utility.");
```

A `member` is an `AgentContract` or a `WorkflowInstance` (the `TeamMemberValue` union — the autocomplete-friendly common case; callback / full-entry intent shapes still work when forwarded). The keys are both the role names the manager routes to **and** the keys `ctx.intents.<role>` exposes — the supervisor escape hatch is preserved.

## The manager — `route` XOR `router`

```ts
// LLM-driven manager: an agent (or RouterEntry) → becomes SupervisorConfig.router
manager: techLeadRouter

// Deterministic manager: { route } → becomes SupervisorConfig.route
manager: { route: (ctx) => (ctx.iteration === 0 ? "builder" : "reviewer") }
```

Exactly one form is forwarded — mutually exclusive, mirroring the supervisor's own `router` XOR `route` rule. A malformed manager surfaces the existing `SupervisorFailedError` downstream.

## Gates — `"quality"` | `"verify"` | a function

A `gate` string selects a pre-built `evaluate` strategy. Both desugar to a concrete `evaluate` callback that leans entirely on the already-shipped `EvaluateResult` semantics — `satisfied` terminates, `reassignTo` re-dispatches, `feedback` threads forward. **No new termination or loop code is written.**

### `gate: "quality"` — review-then-fix

After each iteration's members settle and merge into supervisor `state`, the gate reads `state.approved` (the `gateKey`, default `"approved"`). If truthy → `{ satisfied: true }`; otherwise → `{ reassignTo: "fixer", feedback: String(state.notes ?? "") }`. The reviewer's feedback (`state.notes`) threads into the next iteration so the fixer sees what to change.

### `gate: "verify"` — test-then-fix

Identical shape, but keyed on the tester's pass/fail slice `state.passed` (the default `gateKey`) rather than a subjective score. On failure it re-dispatches the fixer; there is no feedback channel for a pass/fail signal, so none is threaded.

> The member whose `output` schema writes the gate slice must produce a boolean into `gateKey`. A reviewer writes `{ approved: boolean, notes?: string }`; a tester writes `{ passed: boolean }`.

### A custom gate (full escape hatch)

Supplying a function opts out of the sugar entirely while keeping the rest of `team()`'s wiring. It forwards straight through as `SupervisorConfig.evaluate` with zero wrapping:

```ts
gate: (ctx) => {
  const state = ctx.state as { approved?: boolean; attempts?: number };

  if (state.approved) return { satisfied: true };
  if ((state.attempts ?? 0) >= 3) return { satisfied: true }; // give up after 3
  return { reassignTo: "fixer" };
};
```

## Role mapping — `roles` and `gateKey`

The built-in string gates assume canonical role names (`reviewer`, `fixer`, `tester`) and canonical gate keys (`approved` / `passed`). Override when your keys differ:

```ts
ai.team({
  name: "writers",
  manager: editorRouter,
  members: { drafter, editor, reviser },     // non-canonical names
  gate: "quality",
  roles: { reviewer: "editor", fixer: "reviser" }, // map gate roles → your member keys
  gateKey: "shipReady",                       // gate reads state.shipReady instead of state.approved
});
```

Role validation is **at construction**: when the gate is a string, the resolved `fixer` (and, for `"quality"`, the `reviewer`) keys are checked against `members`. A missing role throws an authoring-style `SupervisorFailedError` (`context: { authoring: true }`) immediately — it never silently starves until `maxIterations`.

## Observability

`observe` is forwarded verbatim to the supervisor `team()` returns, so a team routes its completed report through the same generic `Observer` seam every other flow uses — no team-specific wiring. See [the Observer seam](../observability/observe-seam) for the value semantics (`true` / `false` / a flow-local `Observer`).

The report/result a team emits carries `type: "team"` (a first-class `ReportType`, was `"supervisor"`) — so collectors and [Panoptic](../observability/local-dashboard) group, filter, and label team runs as their own type rather than folding them in with plain supervisors.

## When to drop to `ai.supervisor`

`ai.team` is the right reach when your topology is **a manager dispatching to named role members behind a review-then-fix or test-then-fix gate**. Drop to the raw [`ai.supervisor`](./run-supervisor) when:

- you need an `evaluate` that isn't review/verify-shaped (then just pass a custom function — but at that point the supervisor is clearer);
- you want callback intents or full `RouterEntry` intent shapes for every member rather than the agent/workflow shorthand;
- you're composing intents that aren't "roles" in any meaningful sense.

Because `team()` returns the same `SupervisorContract`, there's no migration cost — anything you can express on the supervisor you can reach through the returned object.

## Related

- [Run supervisor](./run-supervisor) — the primitive `team()` desugars into; everything here is sugar over it.
- [Run orchestrator](./run-orchestrator) — durable, cross-turn sessions wrapped around a supervisor.
- [Planner](../architecture-concepts/planner) — LLM-generated plans, when the next step isn't a fixed roster decision.
- [The Observer seam](../observability/observe-seam) — how a team's report reaches your collectors.
