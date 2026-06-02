---
title: "Run supervisor"
description: ai.supervisor in depth — classifier, router, route, intents, evaluate, ack, snapshot resume.
sidebar:
  order: 2
  label: "Run supervisor"
---

A supervisor takes one input, picks which intent(s) handle it, runs them, optionally evaluates the result, and either terminates or iterates. Stateless between runs unless you wire `snapshotStore`.

## When to reach for it

- **`agent`** — one model with tools, single task. Doesn't fit when the right specialist depends on the input.
- **`workflow`** — fixed step order. Doesn't fit when routing varies per request.
- **`supervisor`** — when the right specialist is decided per call and you may iterate to a goal.
- **`orchestrator` (v2)** — when the session matters across runs.

## Three dispatch surfaces

| Surface | When it fires | Iterations |
| --- | --- | --- |
| `classifier` | iter-0 prelude — picks the FIRST intent | exactly 1 |
| `router` | iter 0+ without classifier; iter 1+ with classifier | 1..maxIterations |
| `route` | same scheduling as router but deterministic (no LLM) | 1..maxIterations |

`router` and `route` are mutually exclusive. `classifier` composes with either. Classifier alone (no router/route) → terminates after iter 0. `classifier` is mutually exclusive with `initialAgent`.

Quick decision tree:

- Pure classification → `classifier` alone.
- Multi-step reasoning → `router` + `intents` with rich descriptions.
- Deterministic routing → `route` callback.
- Classify then iterate → `classifier` + `router`/`route`.

## Two routing modes — `route` XOR `router`

### Deterministic — `route(ctx)`

```ts
const triageBot = ai.supervisor({
  name: "triage",
  intents: { billing, shipping, returns },
  route: (ctx) => {
    const text = typeof ctx.input === "string" ? ctx.input.toLowerCase() : "";
    if (text.includes("refund")) return "billing";
    if (text.includes("ship")) return "shipping";
    return "returns";
  },
});
```

`route` returns `string | string[] | typeof END`. Array → fan-out.

### LLM-driven — `router` agent

```ts
const routerAgent = ai.agent({
  output: v.object({ next: v.string(), reasoning: v.string() }),
  // ...
});

const supportBot = ai.supervisor({
  router: routerAgent,
  intents: { billing, shipping, returns, escalate },
  evaluate: (ctx) =>
    Object.values(ctx.result).some((b: any) => b.data?.resolved)
      ? { satisfied: true }
      : undefined,
});
```

The router agent's output MUST include `next: string | string[] | typeof END`. `reasoning: string` is optional but recommended for traceability. `evaluate` pairs only with `router`.

## The `intents` map — five accepted shapes

```ts
intents: {
  billing:   billingAgent,                                                  // (a) AgentContract
  escalate:  escalationWorkflow,                                            // (b) WorkflowInstance
  refund:    async (ctx) => ({ refundId: await callRefundAPI(ctx.input) }), // (c) bare callback
  triage: {                                                                  // (d) agent entry
    agent: triageAgent,
    description: "First-pass classifier",
    placeholders: (ctx) => ({ ticket: ctx.input }),
    output: v.object({ category: v.string() }),
  },
  cancel: {                                                                  // (e) callback entry
    run: async (ctx) => ({ cancelledId: await cancelOrder(ctx.input) }),
    description: "Cancel on customer request",
    output: v.object({ cancelledId: v.string() }),
  },
}
```

Runtime detects shape in this order: `function → "run" in value → "agent" in value → instanceof`. Mixed dispatch fields (`{ agent, run }` together) throws at construction.

**Under a router**, every intent MUST have a non-empty `description`. The bare callback shorthand has no description slot — upgrade to `{ run, description }` when running under a router.

## State accumulates

Each intent contributes a slice; final state validates against the supervisor's `output` schema.

```ts
type RefundOutput = { category: string; order?: { id: string }; reply: string };

const refundSupervisor = ai.supervisor<RefundOutput>({
  name: "refund-support",
  output: outputSchema,
  intents: {
    classify: { agent: classifierAgent, output: v.object({ category: v.string() }) },
    lookupOrder: {
      run: async (ctx) => ({ order: await ordersRepo.find(extractId(ctx.input)) }),
    },
    compose: { agent: replyAgent, output: v.object({ reply: v.string() }) },
  },
  router: routerAgent,
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
});
```

Each branch's output strip-merges into state per its declared `output` schema. Last-write-wins on fan-out conflict (warning logged).

## Per-intent `next` — skip the router

```ts
intents: {
  classify: {
    agent: classifierAgent,
    next: (ctx) => ctx.state.category === "refund" ? "lookupOrder" : "escalate",
  },
  lookupOrder: {
    run: async (ctx) => ({ order: await ordersRepo.find(extractId(ctx.input)) }),
    next: (ctx) => ctx.state.order ? "compose" : "escalate",
  },
  compose: { agent: replyAgent, next: () => END },
}
```

Returns: `string` (intent name), `string[]` (fan-out), `END` (terminate), `undefined` (fall back to router). Order of authority: `evaluate` → `intent.next` → `router/route`.

## Stream-mode intents

For chat-style prose replies, opt out of structured-output coercion:

```ts
intents: {
  smalltalk: {
    agent: smalltalkAgent,
    mode: "stream",
    streamTo: "reply",   // raw text → state.reply
  },
}
```

Token deltas surface as `supervisor.agent.streaming`. `mode: "stream"` + `output` together throws — they're mutually exclusive. Stream mode is agent-only (workflows can't stream this way).

## `ack` — fast preamble

When the router agent or first specialist takes 5+ seconds and the user feels it:

```ts
ack: (ctx) => ({ ack: "Got it, one moment..." })
ack: { run: (ctx) => ({ ack: pickHedge(ctx.input) }), output: v.object({ ack: v.string() }) }
ack: { agent: tinyAckAgent, placeholders: (ctx) => ({ tier: ctx.context.customerTier as string }) }
```

Fires on iter-0 only, in parallel with the routing decision.

**Same-model trap:** if `ack` uses the same model + provider as the router, the ack often takes longer than the routing decision. The callback forms are right for the common case.

## Classifier — `classifier`

Iter-0 prelude. Output is locked to `{ intent, reasoning?, confidence? }`.

```ts
classifier: classifyAgent
// or with refine:
classifier: {
  agent: classifyAgent,
  refine: (ctx) => {
    const { confidence } = ctx.result.data;
    if ((confidence ?? 1) < 0.7) return { intent: "fallback" };
    return undefined;
  },
}
```

`refine` shapes: `undefined` (keep), `END` (halt), `{ intent: "x", ...slice }` (override + merge), `{ ...slice }` (keep intent, merge).

LLM-reported `confidence` is poorly calibrated — use it as a soft signal alongside heuristics, not a hard threshold.

## Tool artifacts

Tools mutate `ctx.artifacts`; the supervisor merges artifacts into state at the end of each iteration.

```ts
ai.supervisor({
  artifactsSchema: v.object({ blocks: v.array(blockSchema).optional() }),
  finalizeArtifacts: (state, artifacts) => ({
    ...state,
    blocks: [...(state.blocks ?? []), ...(artifacts.blocks ?? [])],
  }),
});
```

Default merger — auto-spread (`{...state, ...artifacts}`). `finalizeArtifacts` for concat / dedupe across iterations. The bag resets every iteration.

## Callback intents — dispatching from inside callbacks

```ts
intents: {
  "special-refund": async (ctx) => {
    if ((ctx.input as { amount: number }).amount > 1_000) {
      await ctx.intents["audit-log"].execute();
    }
    return await callRefundAPI(ctx.input);
  },

  classify: async (ctx) => {
    const { data } = await ctx.run(classifierAgent, ctx.input);
    return { category: (data as { label: string }).label };
  },

  chatInline: async (ctx) => {
    const stream = ctx.stream(someAgent, enrich(ctx.input));
    const final = await stream.result;
    return { reply: final.text };
  },
}
```

Cycle protection: per-branch call stack. Re-entry on the same intent throws `SUPERVISOR_DISPATCH_CYCLE`.

## Per-call options

```ts
await supportBot.execute(message, {
  context: { userId, db, traceId },   // request-scoped, never persisted
  history: priorMessages,              // Message[]
  sessionId: "sess_user_42",
  signal: AbortSignal.timeout(60_000),
  runId: "support-2026-04-26-7",
});
```

`history` precedence: per-call → factory `config.history`. Slice with `historyWindow.{router,agents,ack}` (default `ack = 0`, `router/agents = unbounded`) or per-entry `history(ctx)` override.

## Iteration model

1. Router/route picks `next` (or `END`).
2. Picked intents dispatch (parallel for fan-out).
3. `evaluate` (if provided) inspects results.
4. Satisfied or `END` → terminate. Otherwise → loop.

`maxIterations` (default 10) is the hard cap. Hitting it surfaces `MaxIterationsError`.

## Streaming

```ts
const stream = supportBot.stream(message);

for await (const event of stream) {
  if (event.type === "supervisor.agent.streaming") {
    process.stdout.write(event.delta);
  }
}

const result = await stream.result;
```

Token-level streaming requires the dispatched agents to be streamed (supervisor calls `agent.stream()` internally). Callbacks don't stream tokens.

## Snapshot resume

```ts
ai.config({ defaultStore: cache.driver("redis", { client }) });

await supportBot.execute(message, { runId: "support-7" });
await supportBot.resume("support-7");
```

Signature drift detection throws `SupervisorDriftError` on shape mismatch. `force: true` bypasses for safe edits. See [Persist AI data](./persist-ai-data).

## `asTool()` — supervisor as a tool

```ts
const supportTool = supportBot.asTool({
  description: "Route a customer support request to the right specialist",
  input: v.object({ message: v.string() }),
});

const escalationAgent = ai.agent({ model, tools: [supportTool] });
```

## Related

- [Run agent](../the-basics/run-agent) — dispatchable units.
- [Run workflow](./run-workflow) — when steps are known up front.
- [Persist AI data](./persist-ai-data) — snapshot store and resume.
- [Define tools](../the-basics/define-tools) — tool artifacts side-channel.
- [Attach middleware](./attach-middleware) — `semanticCache` fits under each agent's middleware.
