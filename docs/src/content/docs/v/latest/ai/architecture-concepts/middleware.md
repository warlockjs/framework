---
title: "Middleware"
description: Cross-cutting concerns wrapped around an agent run — observe, transform, short-circuit. Built-ins for budget, guardrail, semantic cache.
sidebar:
  order: 4
  label: "Middleware"
---

Middleware in `@warlock.js/ai` is the pipeline that wraps an agent run. It exists for cross-cutting concerns — budgeting, content guardrails, caching, observability — that don't belong in any one tool or system prompt.

This page is the mental model. For the API surface and authoring guide see [Attach middleware](../digging-deeper/attach-middleware).

## Three granularities, one object

One middleware is one object. It can hook into any subset of three levels:

```ts
const myMiddleware: AgentMiddleware = {
  name: "my-mw",
  execute: { before(ctx) {...}, after(ctx, result) {...}, onError(ctx, error) {...} },
  trip:    { before(ctx) {...}, after(ctx, response) {...}, onError(ctx, error) {...} },
  tool:    { before(ctx) {...}, after(ctx, result) {...}, onError(ctx, error) {...} },
};
```

- **`execute`** — wraps the whole run. Fires once per `agent.execute()` call.
- **`trip`** — wraps each LLM round-trip. Fires once per trip (1..N per execute).
- **`tool`** — wraps each tool dispatch. Fires once per tool call.

Hooks run in the obvious order: `before` outermost, `after` innermost-up, `onError` only when something throws.

## What you can do

Each hook can:

- **Observe** — read context, write metrics. Most middleware lives here.
- **Transform** — mutate `ctx.state` for downstream middleware to read.
- **Short-circuit** — return a synthetic result from `before` to skip the real work. Semantic cache uses this to serve cached responses without hitting the model.
- **Reject** — throw a typed `AIError` subclass. Budget and guardrail use this.
- **Recover** — return a value from `onError` to suppress the error.

## The three built-ins

### `ai.middleware.budget`

Cumulative token / USD cap across all trips of one execution.

```ts
ai.middleware.budget({
  maxTokens: 50_000,
  maxCostUSD: 0.5,
  onExceeded: "abort", // or "warn"
});
```

Breach surfaces `BudgetExceededError` with `unit`, `limit`, `actual`. Warn mode logs and continues — useful for measuring before enforcing.

### `ai.middleware.guardrail`

Pre / post content checks.

```ts
ai.middleware.guardrail({
  inputCheck: async (text) => text.match(/\bSSN\b/) ? { ok: false, reason: "pii" } : { ok: true },
  outputCheck: async (text) => text.length > 10_000 ? { ok: false, reason: "too-long" } : { ok: true },
});
```

Rejection surfaces `GuardrailViolationError` with `phase: "input" | "output"`. Output checks fire BEFORE tool dispatch — a rejected response means the tools it requested never run.

### `ai.middleware.semanticCache`

Two-tier cache — exact-match first, then vector similarity.

```ts
ai.middleware.semanticCache({
  embedder: openai.embedder({ name: "text-embedding-3-small" }),
  threshold: 0.95,
  ttlMs: 60 * 60 * 1000,
});
```

Hits return a synthetic `ModelResponse` with `usage: { total: 0 }` — cost dashboards reflect the saving honestly. Trip-zero only: tool-using loops never cache tool-call responses (would infinite-loop).

## Ordering matters

The canonical order is `[cache, budget, guardrail, observability]`. Three reasons:

1. **Cache outermost when guardrails are present.** Guardrails reject bad output by throwing in `trip.after`. `after` hooks run innermost-up, so if the guardrail is inside the cache, the cache writes the bad response BEFORE the guardrail can reject it. Outermost cache means rejected outputs never poison it.
2. **Budget before guardrails.** Guardrails may call classifiers with their own token costs.
3. **Observability last.** It should see the final decision every other middleware made.

The order you pass to `middleware: [...]` IS the order they nest. First in the array = outermost.

## State scoping

Middleware sees `ctx.state` — a fresh `Map<string, unknown>` per `execute()` call. Use it for per-run scratch space (timing markers, accumulated metrics). Never close over module-level mutable state — concurrent calls would step on each other.

`ctx.state` does NOT cross `execute()` boundaries. One call → one fresh map.

## Where middleware does and doesn't apply

| Place | Middleware effect |
| --- | --- |
| `ai.agent({ middleware: [...] })` | Wraps every `agent.execute()`. |
| Workflow step with `agent: myAgent` | The agent's own middleware fires normally inside the step. |
| `workflow.asTool()` called from an agent | The calling agent's `tool`-level middleware wraps the workflow. |
| Step-level / workflow-level / supervisor-level middleware | Does NOT exist in v1. Use agent-level middleware on agents inside the workflow / supervisor. |

## Custom middleware — when to write your own

Write one when:

- You need to log differently per agent (logging into a per-tenant channel, for example).
- You're measuring something the built-ins don't expose (queue depth, downstream service health).
- You're implementing a custom cache backend the `semanticCache` shape doesn't fit.

Don't write one when:

- The concern is one tool's business — put it in the tool.
- The concern is the prompt — put it in the system prompt.
- The concern is the agent loop — `execute()` already has it.

## Related

- [Attach middleware](../digging-deeper/attach-middleware) — API surface, authoring rules, ordering invariants.
- [Handle errors](../digging-deeper/handle-errors) — `BudgetExceededError`, `GuardrailViolationError`.
- [Persist AI data](../digging-deeper/persist-ai-data) — `defaultStore` for semantic cache.
