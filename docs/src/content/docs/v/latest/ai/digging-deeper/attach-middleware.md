---
title: "Attach middleware"
description: Built-in middleware (budget, guardrail, semanticCache) plus authoring your own. Ordering invariants you must follow.
sidebar:
  order: 4
  label: "Attach middleware"
---

Middleware in `@warlock.js/ai` wraps an agent run at three granularities — `execute`, `trip`, `tool`. One middleware is one object. The package ships three built-ins and a small helper surface for composing your own.

## Install order at a glance

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { cache } from "@warlock.js/cache";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

ai.config({ defaultStore: cache.driver("redis", { client: redisClient }) });

const myAgent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  middleware: [
    ai.middleware.semanticCache({
      embedder: openai.embedder({ name: "text-embedding-3-small" }),
      threshold: 0.95,
    }),
    ai.middleware.budget({ maxTokens: 50_000 }),
    ai.middleware.guardrail({
      inputCheck: async (text) =>
        text.match(/\bSSN\b/) ? { ok: false, reason: "pii" } : { ok: true },
    }),
  ],
});
```

**Canonical order: `[cache, budget, guardrail, observability]`.** See "Ordering invariants" below for why.

## `ai.middleware.budget`

Cumulative token / USD cap across all trips of one execution.

```ts
ai.middleware.budget({
  maxTokens: 50_000,
  maxCostUSD: 0.5,
  pricing: { "gpt-4o": { inputPer1K: 0.005, outputPer1K: 0.015 } },
  onExceeded: "abort", // or "warn"
});
```

Breach → `BudgetExceededError` on `result.error`. Inspect `error.unit` (`"tokens" | "usd"`), `error.limit`, `error.actual`. Warn mode logs and continues — useful for measuring before enforcing.

USD only fires when both `maxCostUSD` AND a matching `pricing[modelName]` entry exist.

## `ai.middleware.guardrail`

Pre / post content checks.

```ts
ai.middleware.guardrail({
  inputCheck: async (text, ctx) =>
    text.includes("forbidden") ? { ok: false, reason: "policy-1" } : { ok: true },
  outputCheck: async (text) =>
    text.length > 10_000 ? { ok: false, reason: "too-long" } : { ok: true },
  name: "pii-guardrail",
});
```

Rejection → `GuardrailViolationError` with `phase: "input" | "output"` and the configured `reason`. Output checks fire BEFORE tool dispatch — a rejected response means the tools it requested are never invoked.

Checks run on every trip (including tool follow-ups and repair attempts). Gate to only the first trip via `ctx.tripIndex === 0` when you want input-screening only.

## `ai.middleware.semanticCache`

Two-tier cache — exact-match key first, vector similarity second. Delegates to any vector-capable `CacheDriver`.

```ts
ai.middleware.semanticCache({
  embedder: openai.embedder({ name: "text-embedding-3-small" }),
  // store optional — falls back to ai.config({ defaultStore })
  store: cache.driver("pg", {
    client: pgPool,
    vector: { dimensions: 1536, index: "hnsw" },
  }),
  threshold: 0.95,
  ttlMs: 60 * 60 * 1000,
  namespace: "support-faq",
});
```

**Driver requirements.** The store must support `similar()` — `pg` (with `vector` config), `redis` (with RediSearch), or memory drivers for dev. Without similarity → `CacheUnsupportedError` at first vector op.

**How it works.**

- **Exact-match** — FNV hash over the message list. `store.get(hash)` returns an instant hit.
- **Vector-match** — embeds the prompt, calls `store.similar(vector, { topK: 1, threshold })`. The driver uses its native ANN index.
- **Hits** return a synthetic `ModelResponse` with `usage: { input: 0, output: 0, total: 0 }`.
- **Writes** happen at `trip.after` on miss.
- **Trip-zero only.** Only first-trip responses get cached. Tool-using loops never cache tool-call responses — would infinite-loop.
- **Never use memory drivers in production** — they do a linear scan per query.

## Writing your own middleware

One object, any subset of three hook maps:

```ts
import type { AgentMiddleware } from "@warlock.js/ai";

const latencyLogger: AgentMiddleware = {
  name: "latency-logger",
  execute: {
    before(ctx) {
      ctx.state.set("latency.start", performance.now());
    },
    after(ctx, result) {
      const start = ctx.state.get("latency.start") as number;
      console.log(`agent ${ctx.agent.name} finished in ${performance.now() - start}ms`);
    },
  },
  trip: {
    before(ctx) {
      ctx.state.set(`latency.trip.${ctx.tripIndex}.start`, performance.now());
    },
    after(ctx) {
      const start = ctx.state.get(`latency.trip.${ctx.tripIndex}.start`) as number;
      console.log(`  trip ${ctx.tripIndex}: ${performance.now() - start}ms`);
    },
  },
};
```

### Rules

- **Never close over mutable state.** Use `ctx.state` — fresh per `execute()` call.
- **Abort with a typed `AIError` subclass.** Never `throw new Error(...)`.
- **Short-circuit by returning from `before`.** Return the level's result type — the pipeline skips the real work and outer `after` hooks still run on your synthetic value.
- **`onError` is opt-in recovery.** Return a value to recover; return `void` to let the error propagate.
- **`log: false`** suppresses framework debug emission for that middleware (the middleware itself still runs).

## Ordering invariants — read before shipping

1. **Cache MUST be outermost when guardrails are present.** Guardrail `trip.after` throws to reject bad output, but `after` hooks run bottom-up. If guardrail is outside the cache, rejection fires AFTER the cache has written the bad response. Canonical order `[cache, budget, guardrail]` keeps rejected outputs out of the cache.
2. **Budget before guardrails.** Guardrails may call classifiers with their own token costs.
3. **Observability last.** It should see the final decision every other middleware made.

The order you pass to `middleware: [...]` IS the order they nest. First in the array = outermost.

## Helpers

### `ai.middleware.compose(...sources)`

Flatten multiple sources into one ordered array. No sorting, no dedup.

```ts
ai.agent({
  model,
  middleware: ai.middleware.compose(standardStack, toolRules, auditMiddleware),
});
```

### `ai.middleware.forTool(name | names, middleware)`

Scope `tool.*` hooks to specific tool names. `execute` and `trip` hooks pass through unscoped.

```ts
const scoped = ai.middleware.forTool(
  ["paid_api", "expensive_db"],
  toolRateLimit({ maxCalls: 5 }),
);
```

## Caveats

- **`tool.onError` is almost-never-useful.** `ToolContract.invoke()` never throws — errors are captured into `result.error`. `tool.onError` only fires when another middleware's `tool.before` / `tool.after` itself throws. For "the tool itself failed", branch on `result.error` in a `tool.after`.
- **Middleware does NOT observe unregistered tool calls.** When the model asks for a tool the agent wasn't configured with, the pipeline is bypassed and a failed `ToolCall` is recorded directly.
- **`name` must be unique** across an agent's middleware array.
- **Middleware state does NOT cross `agent.execute()` boundaries.** One execute → one fresh `ctx.state`.

## Workflow + middleware — what works today

- Inside a workflow step with `agent: myAgent` — the agent's own middleware fires normally.
- `workflow.asTool()` called from an agent — the calling agent's `tool`-level middleware wraps the workflow.
- Step-level / workflow-level / supervisor-level middleware does NOT exist yet.

## Related

- [Run agent](../the-basics/run-agent) — agent lifecycle the middleware wraps.
- [Persist AI data](./persist-ai-data) — `defaultStore` for semantic cache.
- [Handle errors](./handle-errors) — `BudgetExceededError` / `GuardrailViolationError`.
