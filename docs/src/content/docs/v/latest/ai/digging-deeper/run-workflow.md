---
title: "Run workflow"
description: ai.workflow / ai.step in depth — generics, lifecycle, parallel groups, routing, retry, resume, drift.
sidebar:
  order: 1
  label: "Run workflow"
---

`ai.workflow({...})` is the second rung of the ladder — a named, ordered set of steps with a stable signature. Each step is exactly one of: an `agent` call, a `run` function, or a `parallel` group. Compose another workflow in by wrapping it with `workflow.asTool()` and calling it from a `run` step. Workflows are durable, observable, cancellable, resumable.

## Minimal shape

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

ai.config({ defaultSnapshotStore: ai.snapshot.memory() });   // for resume; see Persist AI data

type CatalogInput = { url: string };
type CatalogOutput = { id: string };
type CatalogState = { html?: string; catalogId?: string };

const wf = ai.workflow<CatalogInput, CatalogOutput, CatalogState>({
  name: "catalog-item",
  output: {
    extract: (ctx) => ({ id: ctx.state.catalogId ?? "" }),
    schema: v.object({ id: v.string() }),
  },
  steps: [
    ai.step<CatalogInput, CatalogState>({
      name: "fetch",
      run: async (ctx) => {
        ctx.state.html = await fetch(ctx.input.url).then((r) => r.text());
      },
    }),
    ai.step<CatalogInput, CatalogState>({
      name: "extract",
      agent: extractorAgent,
      input: (ctx) => ({ prompt: `Extract from: ${ctx.state.html}` }),
      output: {
        extract: (ctx) => ctx.agentResult?.data,
        schema: itemSchema,
      },
      retry: { attempts: 3, backoff: "exponential" },
    }),
  ],
});
```

## Generics

```ts
ai.workflow<TInput, TOutput, TState, TContext>(...)
ai.step<TInput, TState, TContext>(...)
```

Order: `Input` / `Output` describe the public contract first. `State` comes before `Context` because step bodies touch state far more often. Defaults (`unknown`, `Record<string, unknown>`) let partial typing work.

## Execute — two interchangeable shapes

```ts
// canonical — mirrors agent.execute
const result = await wf.execute(
  { url: "https://..." },
  { runId: "catalog-123", signal: AbortSignal.timeout(60_000) },
);

// single-object — ergonomic alt
const result = await wf.execute({
  input: { url: "https://..." },
  runId: "catalog-123",
});
```

`WorkflowRunOptions` carries `runId`, `signal`, `on`, `context`, `sessionId`. `workflow.version` mirrors onto every produced report.

## `execute()` never throws

All failures funnel into `result.error`:

- `StepFailedError` / `STEP_FAILED`
- `RoutingError` / `WORKFLOW_INVALID_GOTO`
- `WorkflowDriftError` / `WORKFLOW_DRIFT`
- `WorkflowCancelledError` / `WORKFLOW_CANCELLED`
- `MaxStepsExceededError` / `WORKFLOW_MAX_STEPS`

See [Handle errors](./handle-errors).

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

`report.steps[name]` holds a frozen `StepSnapshot` per step — `output`, `status`, `attempts`, `attemptHistory`, timings, nested children for parallel groups.

## Step lifecycle

```text
skip? → before? → (run | agent | parallel) → output.extract (+ schema) → after? → nextStep?
```

| Phase | Purpose |
| --- | --- |
| `skip` | Return `true` to skip the step. Output becomes `undefined`. |
| `before` | Pre-work — fetch, set state, validate. |
| `run` | Core non-agent work. |
| `agent` | Agent to execute. `input(ctx)` builds the prompt. |
| `input` | Required when `agent` is set. |
| `output` | `{ extract, schema? }` — extract the step's output. |
| `after` | Post-work — save, notify. |
| `nextStep` | Step-level routing on success. |
| `onFailure` | Step-level recovery after retries exhaust. |
| `onCancel` | Cleanup if cancelled in flight. |

Errors in `before` / `run` / `agent` / `after` / `output` are retryable. Errors in `nextStep` / `onFailure` terminate the workflow with `RoutingError` — those are programmer errors, not transient failures.

## Context — input vs context vs state

```ts
type WorkflowContext<TInput, TState, TContext> = {
  readonly input: TInput;                         // frozen — durable cause
  readonly context: TContext;                     // frozen — per-execution
  readonly steps: Record<string, StepSnapshot>;   // frozen snapshots of completed steps
  state: TState;                                  // mutable shared state
  readonly agentResult?: AgentResult<unknown>;    // set when current step has an agent
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly startedAt: Date;
};
```

`input`, `context`, `steps` are deep-frozen. `state` is mutable during a step and frozen into `steps[name].state` on completion.

- **`input`** — *what* to process. Persisted in the snapshot, replayed verbatim on `resume()`.
- **`context`** — *who's running it.* Tenancy, user, locale, traceId. **Never persisted.** Callers pass fresh on every `execute()` and `resume()`.

**Resume invariant.** Persistence-scoping fields in `context` (e.g. `organizationId`) MUST match across resume calls. The framework can't fingerprint context — mixing scopes silently corrupts data.

## State vs `steps[x].output` — performance

- **Small control data** (flags, counters) → `ctx.state`. Cheap.
- **Large artifacts** (HTML blobs, embedding vectors) → producer step's `output.extract`, read via `ctx.steps[prev].output`.

`ctx.state` clones on every retry attempt. `ctx.steps` clones once on step commit.

## Parallel children

```ts
ai.step({
  name: "generate",
  parallel: [
    ai.step({ name: "draft", agent: writerAgent, input, output }),
    ai.step({ name: "suggest-articles", agent: kbAgent, input, output }),
  ],
});
```

- Children share `ctx.state` — last-write-wins on conflict.
- Addressable by flat (`ctx.steps.draft`) AND nested (`ctx.steps.generate.steps.draft`) path.
- Any child failing doesn't cancel siblings; the parent records the first child's error.
- Checkpoint writes atomically after all children settle.

## Routing — `nextStep` and `onFailure`

```ts
ai.step({
  name: "qa",
  agent: qaReviewerAgent,
  input,
  output,
  nextStep: (ctx) => {
    if (!ctx.agentResult?.data.approved) {
      ctx.state.qaFeedback = ctx.agentResult?.data.feedback;
      return { goto: "draft" };
    }
  },
  onFailure: (ctx, error) => {
    if (error.code === "PROVIDER_RATE_LIMIT") {
      return { goto: "fallbackQa" };
    }
  },
});
```

Returns: `{ goto: "stepName" }`, `{ end: true }`, or `void` (fall through / halt).

Guards: `maxSteps` (default 100) hard-fails with `MaxStepsExceededError`. `loopWarnAfter` (default 5 revisits) emits `workflow.loop.warning`.

## Retry

```ts
retry: {
  attempts: 3,
  backoff: "exponential",         // "none" | "linear" | "exponential" | (attempt) => ms
  retryOn: (error, attempt) => true,
  onRetry: (attempt, error) => {},
}
```

Exponential defaults: 500ms → 1s → 2s → 4s → 8s, capped at 30s. `AbortError` short-circuits retry — cancellation is final.

## Cancellation

```ts
const ctrl = new AbortController();
const result = wf.execute({ input, signal: ctrl.signal });
ctrl.abort("user cancelled");
```

Between-step cancellation is guaranteed. Mid-step is best-effort. `status: "cancelled"` on return with partial `report.steps`; the checkpoint writes before returning so resume works.

## Persistence and resume

```ts
await wf.execute({ input, runId: "ticket-123" });   // fresh run
await wf.resume("ticket-123");                       // after crash
```

See [Persist AI data](./persist-ai-data) for snapshot stores, drift detection, and recovery patterns.

## Events

`workflow.starting`, `workflow.step.{starting|streaming|completed|skipped|retrying|failed}`, `workflow.loop.warning`, `workflow.cancelled`, `workflow.completed`, `workflow.error`.

Subscription order: definition → instance → per-call. All matching handlers fire.

Every payload carries `runId` and `rootRunId`.

## When NOT to use a workflow

- **Unknown shape at author time** — reach for [`ai.planner()`](../architecture-concepts/planner) (LLM generates the plan) or model as a supervisor.
- **Quality loop until goal met** — `ai.supervisor()` with `evaluate`.
- **Multi-turn conversation with persistent session** — [`ai.orchestrator()`](./run-orchestrator).
- **Iterate a runtime list of items** — wrap a workflow with the `ai.batch()` utility.

## Related

- [Run agent](../the-basics/run-agent) — agents inside steps.
- [Run supervisor](./run-supervisor) — the next rung up.
- [Run orchestrator](./run-orchestrator) — durable sessions across runs.
- [Persist AI data](./persist-ai-data) — snapshot resume.
- [Handle errors](./handle-errors) — `WorkflowError` subclasses.
