---
title: "Workflows"
description: Deterministic multi-step pipelines with branching, retries, parallel groups, and snapshot resume.
sidebar:
  order: 2
  label: "Workflows"
---

A workflow is a named, ordered set of steps with a stable signature. Each step is exactly one of: an `agent` call, a free-form `run` function, or a `parallel` group of children. To run another workflow as a step, wrap it with `workflow.asTool()` and call it from a `run` step. Workflows are durable — snapshot to any `CacheDriver` from `@warlock.js/cache` — observable, cancellable, resumable.

This page is the mental model. For the API surface see [Run workflow](../digging-deeper/run-workflow).

## When to reach for a workflow

- **Fixed pipeline shape** known at author time: fetch → extract → classify → save.
- **Survive a crash** mid-pipeline and pick up where you left off.
- **Mix LLM steps with non-LLM steps** — embeddings, DB writes, external API calls — under one envelope.
- **Branch on intermediate results** — `nextStep` reads completed step outputs.
- **Run children in parallel** when they're independent.

Reach for a supervisor when the *shape* changes per call. Reach for an [orchestrator](./orchestrators) when the *session* matters across runs.

## The step lifecycle

Every step runs through the same phases:

```text
skip? → before? → (run | agent | parallel) → output.extract (+ schema) → after? → nextStep?
```

| Phase | What it owns |
| --- | --- |
| `skip` | Return `true` to skip the step entirely. Output becomes `undefined`. |
| `before` | Pre-work — fetch resources, set state, validate. |
| `run` | The core non-agent work — pure code. |
| `agent` | An agent to dispatch. `input(ctx)` builds the prompt from current state. |
| `parallel` | A list of child steps that fan out and settle together. |
| `output.extract` | Pull the step's output value out of `ctx`. Schema-validated if `schema` is supplied. |
| `after` | Post-work — save, notify, emit metrics. |
| `nextStep` | Step-level routing on success. Return `{ goto: "stepName" }`, `{ end: true }`, or void to fall through. |
| `onFailure` | Step-level recovery after retries exhaust. |
| `onCancel` | Cleanup if the signal aborts in flight. |

Errors in `before` / `run` / `agent` / `after` / `output` are retryable per the step's `retry` config. Errors in `nextStep` / `onFailure` terminate the workflow immediately — those are programmer errors, not transient failures.

## Context: input vs state vs context

```ts
type WorkflowContext<TInput, TState, TContext> = {
  readonly input: TInput;                         // frozen — the durable cause
  readonly context: TContext;                     // frozen — per-execution, never persisted
  readonly steps: Record<string, StepSnapshot>;   // frozen snapshots of completed steps
  state: TState;                                  // mutable — current shared state
  readonly agentResult?: AgentResult<unknown>;    // set when current step has an agent
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly startedAt: Date;
};
```

The three buckets answer three different questions:

- **`input`** — *what* are we processing? Frozen. Replayed verbatim on resume.
- **`context`** — *who* is running it? Tenancy, user, locale, traceId. Frozen. **Never persisted** — callers pass fresh on every `execute()` and `resume()`.
- **`state`** — *what's in flight right now?* Mutable. Cloned on each retry attempt.

The split matters because of resume: when you re-run a workflow with `resume(runId)`, the framework rehydrates `input` from the snapshot but needs `context` fresh from the caller (DB connections, request IDs, current user). Mixing them would persist things you don't want persisted.

**Resume invariant.** Persistence-scoping fields in `context` (e.g. `organizationId`) MUST match across resume calls. The framework can't enforce this — it doesn't fingerprint context — but mismatching it silently corrupts data.

## State vs `steps[x].output` — performance

```ts
ctx.state.smallFlag = true;                      // cheap — clones on retry
ctx.state.giantHtml = await fetch(...);          // expensive — same clone on every retry
```

Heuristic: small control data in `state`, large artifacts in the producer's `output.extract` and read via `ctx.steps[prev].output`. `state` is cloned on every attempt; `steps` is cloned once when the step commits.

## Parallel groups

```ts
ai.step({
  name: "generate",
  parallel: [
    ai.step({ name: "draft", agent: writerAgent, input, output }),
    ai.step({ name: "suggest", agent: kbAgent, input, output }),
  ],
});
```

Children share `state` — last-write-wins on conflict. They settle atomically: any child failing doesn't cancel siblings; the parent step records the first child's error. The checkpoint writes once after all children settle.

## Routing

Two routing hooks:

- **`nextStep(ctx)`** — fires on success. Reads completed step outputs, returns `{ goto: "stepName" }`, `{ end: true }`, or `void`.
- **`onFailure(ctx, error)`** — fires after retries exhaust. Same return shape. Use it for typed recovery — fall back to a cheaper model, escalate to a human, halt with a clean error.

Guards: `maxSteps` (default 100) catches infinite loops. `loopWarnAfter` (default 5 revisits of one step) emits `workflow.loop.warning`.

## Retries

```ts
retry: {
  attempts: 3,
  backoff: "exponential",         // "none" | "linear" | "exponential" | custom fn
  retryOn: (error, attempt) => true,
  onRetry: (attempt, error) => {},
}
```

Exponential defaults: 500ms → 1s → 2s → 4s → 8s, capped at 30s. `AbortError` short-circuits retry — cancellation is final.

## Snapshot resume

After every step settles, the workflow checkpoints to its `snapshotStore` (a `SnapshotStore` from `ai.snapshot.{memory,pg,redis}()`, or the global `ai.config({ defaultSnapshotStore })`). On resume:

1. Read the snapshot for `runId`.
2. Compute the current signature from the workflow definition.
3. If signatures match → rehydrate state, continue from snapshot's `next`.
4. If signatures differ → throw `WorkflowDriftError` without executing.

Drift is the framework refusing to silently corrupt your data. You then choose: discard the snapshot, force-resume (escape hatch for trivial edits), or migrate manually. See [Persist AI data](../digging-deeper/persist-ai-data).

## Result envelope

```ts
type WorkflowResult<TOutput> = {
  type: "workflow";
  data?: TOutput;            // from workflow.output.extract
  report: WorkflowReport;    // runId, signature, status, timings, per-step snapshots
  usage: Usage;              // aggregated across all agent calls
  error?: AIError;
};
```

`report.steps[name]` carries a frozen `StepSnapshot` per step with `output`, `status`, `attempts`, `attemptHistory`, timings, and (for parallel groups) nested children.

## When a workflow isn't the right shape

- **Unknown shape at author time** — reach for [`ai.planner()`](./planner) (LLM generates the plan over your capabilities), or model it as a supervisor where the router decides.
- **Quality loop until goal met** — use `ai.supervisor()` with `evaluate`.
- **Multi-turn conversation with persistent session** — [`ai.orchestrator()`](./orchestrators).
- **Iterate a runtime list of items** — wrap a workflow with `ai.batch()` utility.

## Related

- [Run workflow](../digging-deeper/run-workflow) — the API surface.
- [Supervisors](./supervisors) — the next rung up.
- [Orchestrators](./orchestrators) — stateful sessions across runs.
- [Planner](./planner) — generate-then-execute over capabilities.
- [Persist AI data](../digging-deeper/persist-ai-data) — snapshot resume + drift handling.
