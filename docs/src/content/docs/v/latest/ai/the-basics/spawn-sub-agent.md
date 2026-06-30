---
title: "Spawn sub-agent"
description: spawnSubAgent — a thin wrapper that builds a fresh one-shot agent with an optional per-task budget and runs it once. A general primitive, usable anywhere.
sidebar:
  order: 5
  label: "Spawn sub-agent"
---

`ai.spawnSubAgent(spec)` is a small convenience helper for the most common kind of delegation: hand a self-contained subtask to a brand-new agent built just for it, run it once, and get the unified `AgentResult` back. It is **not** a planner feature, an orchestration runtime, or a sandbox — it builds a plain `ai.agent()` under the hood, so reach for it anywhere you'd otherwise write "make a throwaway agent and call it once."

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const result = await ai.spawnSubAgent({
  name: "extract-entities",
  model,
  task: "Pull every company name from this article: ...",
  budget: { maxCostUSD: 0.05 }, // per-task spend cap — aborts the moment it's crossed
  output: v.object({ companies: v.array(v.string()) }),
});

if (result.error) {
  // never throws on runtime failure — failures surface here
}
console.log(result.data); // { companies: [...] }
```

## What it actually is

A spawn is exactly this, with no hidden machinery:

```ts
// ai.spawnSubAgent(spec) is equivalent to:
ai.agent({
  name: spec.name,
  model: spec.model,
  systemPrompt: spec.systemPrompt,
  tools: spec.tools,
  maxTrips: spec.maxTrips,
  output: spec.output,
  middleware: spec.budget ? [ai.middleware.budget(spec.budget)] : undefined,
}).execute(spec.task, { output: spec.output, signal: spec.signal, sessionId: spec.sessionId });
```

Because each spawn is its own `ai.agent()` instance, it starts from an empty conversation with its own tools and prompt — ordinary new-instance behavior, **not** special isolation (every `ai.agent()` already works that way). The spawned `report` slots under the caller's `report.children[]` like any executable, so cost and traces roll up uniformly.

## The one thing it adds — a per-task budget

The single field that earns the helper its name is `budget`. It promotes a per-task spend ceiling to a first-class spec field: when set, the spawn runs under a [`budget` middleware](../architecture-concepts/middleware) that aborts the moment a cap (`maxTokens` / `maxCostUSD`) is crossed, so a delegated subtask can't overrun its allowance. That's distinct from `maxTrips`, which caps round-trips, not spend. It's equivalent to passing `middleware: [ai.middleware.budget(...)]` to a plain agent — `ai.spawnSubAgent` just makes it a named, obvious field for the "delegate with a hard cap" case.

## What it does *not* give you

It is a **narrower** surface than `agent.execute()` — a deliberate one-shot shape:

- no `history` (each spawn starts fresh),
- no `placeholders`,
- no per-call event handlers,
- no `repair`.

If you need any of those, construct an `ai.agent()` directly and call `execute()` — you lose nothing.

## When to reach for it

Reach for `ai.spawnSubAgent` when you want a **named, single-use delegation with a spend cap**:

- a tool's `execute` that fans a sub-question out to a fresh agent,
- a [workflow](../architecture-concepts/workflows) or [planner](../architecture-concepts/planner) step that delegates a bounded subtask,
- a [supervisor](../architecture-concepts/supervisors) intent that needs a one-off specialist,
- any hand-rolled orchestration where "build an agent, run it once, throw it away, don't let it overspend" is the whole job.

Otherwise — when you want history, streaming, events, or a long-lived agent — just build an `ai.agent()` and call it.

## The spec

```ts
type SpawnSubAgentSpec<TOutput> = {
  name: string;                          // stable identifier for the spawned agent
  model: ModelContract;                  // the model it runs against
  task: string;                          // the subtask instruction handed to execute()
  systemPrompt?: SystemPromptContract | string;
  tools?: AgentToolEntry[];              // tools the spawn may call in its own loop
  maxTrips?: number;                     // per-spawn round-trip cap
  budget?: BudgetOptions;                // per-task spend cap ({ maxTokens } / { maxCostUSD })
  output?: StandardSchemaV1<TOutput>;    // structured output validated into result.data
  signal?: AbortSignal;                  // cancellation
  sessionId?: string;                    // groups the spawn under a session in flat trace queries
};
```

## Related

- [Run agent](./run-agent) — the full agent surface `spawnSubAgent` builds on (history, streaming, events, repair).
- [Middleware](../architecture-concepts/middleware) — the `budget` middleware the `budget` field wires up for you.
- [Planner](../architecture-concepts/planner) — generates and runs a plan; a step can delegate via `spawnSubAgent`, but the planner does not require it.
