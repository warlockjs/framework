---
title: "Supervisors"
description: Multi-intent routing — one input, several specialists, decided per call, optionally iterated to a goal.
sidebar:
  order: 3
  label: "Supervisors"
---

A supervisor takes one input, picks which intent(s) handle it, runs them, optionally evaluates the result, and either terminates or iterates. It's the right tool when the *shape* of the work depends on the input — when an agent has too many tools and a workflow has too many branches.

This page is the mental model. For the API surface see [Run supervisor](../digging-deeper/run-supervisor).

## The three primitives compared

- **`ai.agent`** — one model with tools. Doesn't fit when the right specialist depends on the input.
- **`ai.workflow`** — fixed step order. Doesn't fit when routing decisions need an LLM or vary per request.
- **`ai.supervisor`** — picks the specialist per call, can iterate until the answer is good enough.

## Three dispatch surfaces

A supervisor has three places it can decide what to run, and they compose:

| Surface | Fires when | Iterations |
| --- | --- | --- |
| `classifier` | iter-0 prelude — picks the FIRST intent | exactly 1 |
| `router` | iter 0+ without classifier; iter 1+ with classifier | 1..maxIterations |
| `route` | same as router but deterministic (callback, no LLM) | 1..maxIterations |

`router` and `route` are mutually exclusive — pick one. `classifier` composes with either. Classifier alone (no router/route) terminates after the first intent.

Quick decision tree:

- Pure single-step classification → `classifier` alone.
- Multi-step reasoning with LLM routing → `router` agent + rich intent descriptions.
- Deterministic per-call routing → `route` callback.
- Classify first, then iterate → `classifier` + `router`/`route`.

## Intents — five accepted shapes

```ts
intents: {
  billing:   billingAgent,                                                 // (a) AgentContract
  escalate:  escalationWorkflow,                                           // (b) WorkflowInstance
  refund:    async (ctx) => ({ id: await callRefundAPI(ctx.input) }),       // (c) bare callback
  triage:    { agent: triageAgent, description: "First-pass classifier" }, // (d) agent entry
  cancel:    { run: async (ctx) => ({...}), description: "...", output },  // (e) callback entry
}
```

Runtime detects shape in this order: `function → "run" in value → "agent" in value → instanceof`. Mixing `{ agent, run }` together throws at construction.

Under an LLM `router`, every intent MUST have a non-empty `description` so the router agent has signal. Bare callback shorthand has no description slot — upgrade to `{ run, description }` when running under a router.

## State accumulates across iterations

Each intent contributes a slice of typed `state`. The supervisor's `output` schema defines the final shape; intermediate iterations build it up incrementally.

```ts
type RefundOutput = { category: string; order?: { id: string }; reply: string };

const supervisor = ai.supervisor<RefundOutput>({
  output: outputSchema,
  intents: {
    classify:    { agent: classifierAgent, output: v.object({ category: v.string() }) },
    lookupOrder: { run: async (ctx) => ({ order: await ordersRepo.find(extractId(ctx.input)) }) },
    compose:     { agent: replyAgent, output: v.object({ reply: v.string() }) },
  },
  router: routerAgent,
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
});
```

Each branch's output strip-merges into `state` per its declared schema. Last-write-wins on fan-out conflict — a warning is logged when it happens.

## Iteration model

1. Router (or `route`) picks `next` — a single intent name, an array (fan-out), or `END`.
2. Picked intents dispatch in parallel for fan-out.
3. `evaluate` (if provided) inspects `state` and `result`. Returns `{ satisfied: true }` to end, `undefined` to loop.
4. If satisfied or `END` → terminate. Otherwise → loop.

`maxIterations` (default 10) is the hard cap. Hitting it surfaces `MaxIterationsError`.

## Per-intent `next` — skip the router

When you don't need the LLM to make every routing decision, intents can declare their own `next`:

```ts
intents: {
  classify: {
    agent: classifierAgent,
    next: (ctx) => ctx.state.category === "refund" ? "lookupOrder" : "escalate",
  },
  lookupOrder: {
    run: async (ctx) => ({ order: await find(extractId(ctx.input)) }),
    next: (ctx) => ctx.state.order ? "compose" : "escalate",
  },
  compose: { agent: replyAgent, next: () => END },
}
```

Order of authority: `evaluate` → `intent.next` → `router/route`. The first one to return a non-`undefined` value wins.

## Tool artifacts — the side channel

When tools run under a supervisor, `ctx.artifacts` is a typed bag they can write to. The supervisor merges artifacts into state at the end of each iteration (default: spread; configurable via `finalizeArtifacts`).

The point: tools can produce data the model should NOT see — rendered UI blocks, citation lists, telemetry — that still ends up in the final supervisor output.

```ts
ai.supervisor({
  artifactsSchema: v.object({ blocks: v.array(blockSchema).optional() }),
  finalizeArtifacts: (state, artifacts) => ({
    ...state,
    blocks: [...(state.blocks ?? []), ...(artifacts.blocks ?? [])],
  }),
});
```

The bag resets every iteration. Use `finalizeArtifacts` for concat / dedupe across iterations.

## The `ack` preamble

When the first specialist takes 5+ seconds and the user feels it, an `ack` fires on iteration 0 in parallel with the routing decision:

```ts
ack: (ctx) => ({ ack: "Got it, one moment..." })
```

There's a same-model trap: if `ack` uses the same model + provider as the router, the ack often takes longer than the routing decision. The callback form sidesteps it for the common case.

## Streaming

```ts
const stream = supervisor.stream(message);

for await (const event of stream) {
  if (event.type === "supervisor.agent.streaming") {
    process.stdout.write(event.delta);
  }
}
```

Token-level streaming requires the dispatched agents to be streamed — the supervisor calls `agent.stream()` internally for `mode: "stream"` intents. Callbacks don't stream tokens (there's nothing to stream).

## Snapshot resume

Same model as workflows. After every iteration the supervisor checkpoints. On resume:

```ts
await supervisor.execute(message, { runId: "support-7" });   // fresh
await supervisor.resume("support-7");                         // after crash
```

Signature drift detection throws `SupervisorDriftError` on shape mismatch. `force: true` bypasses for safe edits.

## When a supervisor isn't the right shape

- **Fixed pipeline** — `ai.workflow()`. Faster, cheaper, more deterministic.
- **One specialist** — `ai.agent()` with tools. A supervisor with one intent is wasted complexity.
- **Long-running conversation** — orchestrator (v2). For now, persist your own history and feed it via `history` option.

## Related

- [Run supervisor](../digging-deeper/run-supervisor) — the API surface.
- [Define tools](../the-basics/define-tools) — `ctx.artifacts` side-channel.
- [Persist AI data](../digging-deeper/persist-ai-data) — snapshot resume.
