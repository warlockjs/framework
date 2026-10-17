---
title: "Recipe — Budget caps and SLO contracts"
description: Enforce a per-run cost and latency SLO with ai.middleware.budget — abort hard on breach, or soft-fallback to a cheaper model via the recorded signal.
sidebar:
  order: 11
  label: "Budgets and SLOs"
---

> **Scenario.** Your agent has one runaway failure mode: a tool loop that keeps re-asking the model, quietly burning $2 and 30 seconds per request before anyone notices. You want a hard contract — "this run must cost under $0.05, finish under 8s, and burn under 40k tokens" — expressed as data, with one global reaction when any clause trips.
>
> `ai.middleware.budget` enforces exactly that. The classic `maxTokens` / `maxCostUSD` caps abort the run the instant a cap is breached. The declarative `contract` adds a wall-clock latency dimension and one `onViolation` reaction: `"abort"` hard-stops, or `"fallback"` records a typed signal and lets the run continue so an outer layer can degrade to a cheaper model.

## Mind the pricing shapes

`budget({ pricing })` takes a table keyed by model name, and each entry is one of two shapes:

- **`ModelPricing`** — **USD per 1,000,000 tokens**, the same shape the SDK uses for `Usage.cost`, cache rates included (`cachedInput`, `cacheWrite`, `cacheWrite1h`). Cache reads and writes are billed exactly as on the report.
- **The legacy `{ inputPer1K, outputPer1K }`** — **USD per 1,000 tokens**, input and output only; cache rates are ignored.

A matching budget entry wins; otherwise the middleware uses the model's resolved `ModelPricing` (per-model `pricing`, the SDK registry, or the adapter's built-in list price). Keys in the budget table must match the running model's name exactly. Prefer the `ModelPricing` shape — or no budget table at all — so the cap and the report agree.

For a dollar-capped budget, pricing is fail-closed by default: if neither source resolves a price, `execute()` returns a `BudgetExceededError` before the first model call. Its message names the model and points to `onUnpriced: "allow"`; set that option only when you intentionally want to run without enforceable USD accounting.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
```

## Hard cap — abort on breach

The simplest guard: a token and USD ceiling that throws `BudgetExceededError` the moment cumulative usage crosses it. `execute()` never throws — the error surfaces on `result.error`.

```ts
import { BudgetExceededError } from "@warlock.js/ai";

const hardCap = ai.middleware.budget({
  maxTokens: 50_000,
  maxCostUSD: 0.5,
  pricing: {
    // ModelPricing: USD per 1M tokens, cache-read rate included.
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  },
  onExceeded: "abort", // default; "warn" logs once and lets the run continue
});

const agent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  middleware: [hardCap],
});

const result = await agent.execute("Summarize the attached 200-page filing.");

if (result.error instanceof BudgetExceededError) {
  // The subclass exposes the breach numerically — no message parsing.
  console.warn(
    `budget breach: ${result.error.actual} ${result.error.unit} (cap ${result.error.limit})`,
  );
}
```

`onExceeded: "warn"` is the rollout-first mode: it logs a single warning the first time a cap is breached and lets the run finish, so you can measure real traffic against a proposed cap before flipping to `"abort"`.

## Reserve before the call — no single trip overruns the cap

The caps above book usage **after** each trip, so the one trip that crosses the line still runs — and a large one can overshoot by a lot. `reserve` switches to reserve-then-commit:

1. **Before** each model call, the middleware reserves the trip's worst case: its input tokens plus `outputTokens`, priced as uncached input. If that would cross `maxTokens`, `maxCostUSD`, an `"abort"` contract cap, or the `scoped` ledger, the call is **never sent** and the run fails with `BudgetExceededError` whose `context.reason` is `"reservation"` (for the `scoped` ledger, a `ScopedBudgetExceededError` carrying the key, window and would-be `used`).
2. **After** the call, the reservation is replaced by the actual usage.
3. When the call **fails**, the reservation is released.

```ts
import { BudgetExceededError, countInputTokens } from "@warlock.js/ai";

const model = openai.model({ name: "gpt-4o", maxTokens: 4_096 });

const guarded = ai.agent({
  model,
  middleware: [
    ai.middleware.budget({
      maxCostUSD: 0.25,
      reserve: {
        outputTokens: 4_096, // the most one trip can generate — match the model's maxTokens
        // Optional: the default is an offline estimate of the trip's messages.
        inputTokens: async (ctx) => (await countInputTokens(model, [...ctx.messages])).tokens,
      },
    }),
  ],
});

const result = await guarded.execute("Summarize the attached filing.");

if (result.error instanceof BudgetExceededError && result.error.context?.reason === "reservation") {
  // Refused before spending anything: spent + reserved would exceed the cap.
  console.warn(result.error.context);
}
```

Set `outputTokens` to the `maxTokens` the model is called with — that is the true worst case. The default input count is `estimateInputTokens(ctx.messages)`, an offline character-based **estimate** that does not see the tool schemas; pass `inputTokens` for a native count or extra headroom when the cap is tight.

### Counting input tokens

```ts
import { countInputTokens, estimateInputTokens } from "@warlock.js/ai";

// Offline estimate: ~4 characters per token, plus allowances per message
// and per attachment. Clearly an estimate — tune charsPerToken down for
// code / JSON / non-Latin text so it errs high.
const rough = estimateInputTokens(messages, { tools, charsPerToken: 3 });

// Native count where the model has one (Anthropic, Google, Bedrock, OpenAI
// Responses), the estimate otherwise — `source` says which.
const { tokens, source } = await countInputTokens(model, messages, { tools });
```

`countInputTokens` returns `{ tokens, source: "native" | "estimate" }`, so a cap can treat an estimate more conservatively than a real count.

## SLO contract — cost, latency, and tokens as one objective

The `contract` clause expresses a full service-level objective and enforces it on top of (and independently of) the legacy caps. Latency is wall-clock milliseconds measured from run start to each trip boundary — the dimension the legacy caps can't express.

```ts
const sloAgent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  middleware: [
    ai.middleware.budget({
      // Cost needs a price for the running model — here gpt-4o's built-in
      // list price applies, so no `pricing` table is needed.
      contract: {
        maxCostUSD: 0.05,
        maxLatencyMs: 8_000,
        maxTokens: 40_000,
        onViolation: "abort", // any breached clause aborts with BUDGET_EXCEEDED
      },
    }),
  ],
});

const result = await sloAgent.execute("Draft the quarterly board summary.");

if (result.error?.code === "BUDGET_EXCEEDED") {
  // A latency breach has no BudgetUnit, so its detail rides on context.
  const dimension = result.error.context?.dimension; // "cost" | "latency" | "tokens"
  metrics.increment("ai.slo.violation", { dimension: String(dimension) });
}
```

Every clause is optional — supply only the dimensions you care about. A contract with no caps is inert. For a dollar cap, an explicit budget price wins; otherwise the model/SDK's resolved `ModelPricing` is used. If neither exists, the budget fails closed before the first call unless `onUnpriced: "allow"` opts out; token and latency clauses continue to enforce independently.

## Soft fallback — degrade instead of abort

`onViolation: "fallback"` is the graceful path. The middleware can't itself swap models mid-run, so on the first breach it records a typed `BudgetContractViolation` in the run's state bag, fires the optional `fallback` callback, and lets the run continue. An outer middleware reads the signal back with `ai.middleware.readBudgetFallbackSignal` off the shared `ctx.state` and decides how to degrade the next run — cheaper model, cached answer, truncated context.

```ts
import { ai } from "@warlock.js/ai";
import type { AgentMiddleware } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const premium = openai.model({ name: "gpt-4o" });
const cheap = openai.model({ name: "gpt-4o-mini" });

const sloGuard = ai.middleware.budget({
  name: "slo",
  pricing: {
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  },
  contract: {
    maxCostUSD: 0.05,
    maxLatencyMs: 8_000,
    onViolation: "fallback",
    // Notification hook — fires once, cannot abort, its errors are swallowed.
    fallback: (violation) => {
      metrics.increment("ai.slo.soft_breach", { dimension: violation.dimension });
    },
  },
});

// An outer middleware shares the same ctx.state, so it can read the signal
// the budget recorded during this run. Register it AFTER sloGuard so its
// execute.after runs (onion model: after hooks fire bottom-up).
const degradeOnBreach: AgentMiddleware = {
  name: "degrade-on-breach",
  execute: {
    after: (ctx) => {
      const signal = ai.middleware.readBudgetFallbackSignal(ctx.state, "slo");

      if (signal) {
        // Flag the tenant so the NEXT turn routes to the cheaper agent.
        degradeFlags.set(ctx.options?.sessionId, signal.dimension);
        metrics.gauge("ai.slo.degraded", { dimension: signal.dimension });
      }
    },
  },
};

const premiumAgent = ai.agent({
  model: premium,
  middleware: [sloGuard, degradeOnBreach],
});
const cheapAgent = ai.agent({ model: cheap });

/**
 * Route to the cheaper agent when the tenant tripped the SLO on a prior
 * turn; otherwise run premium under the contract. `fallback` never
 * throws, so a soft breach finishes the current run AND degrades the next.
 */
async function answerWithinSLO(tenantId: string, question: string): Promise<string | undefined> {
  const agent = degradeFlags.has(tenantId) ? cheapAgent : premiumAgent;
  const result = await agent.execute(question, { sessionId: tenantId });

  if (result.error) {
    throw result.error;
  }

  return result.text;
}
```

:::note[Where the signal lives]
The fallback signal is recorded in the budget's per-run state bag under its `<name>.fallback` key — pass the same `name` to `readBudgetFallbackSignal(state, name)`. Read it from an outer middleware's `execute.after` hook, which shares the same `ctx.state`. It does not survive to the next `execute()` — it's a within-run signal, so persist your own "degrade this tenant" flag (as above) if you need it to outlive the run.
:::

## Scoped budgets — a shared cap across executions

The per-execution caps above reset with every `execute()` call. `budget({ scoped })` adds a **UTC day/month ledger shared across separate agent runs** — a per-user daily token cap, a per-tenant monthly cost cap — enforced atomically so concurrent runs can't jointly overshoot it:

```ts
import { ai } from "@warlock.js/ai";
import { memoryScopedBudgetStore } from "@warlock.js/ai";
import { ScopedBudgetExceededError } from "@warlock.js/ai";

const dailyCap = ai.middleware.budget({
  scoped: {
    key: (ctx) => `user:${ctx.options?.sessionId}`, // string, or a resolver from middleware context
    window: "day", // "day" | "month" — UTC boundary
    maxTokens: 100_000,
    store: memoryScopedBudgetStore(), // in-process ledger
  },
});

const agent = ai.agent({ model: openai.model({ name: "gpt-4o" }), middleware: [dailyCap] });

const result = await agent.execute("...", { sessionId: userId });

if (result.error instanceof ScopedBudgetExceededError) {
  // key, window, limit, used — no message parsing
  console.warn(`${result.error.key} over its ${result.error.window} cap: ${result.error.used}`);
}
```

Without `reserve`, the middleware books each trip's **measured** usage atomically after the response — this keeps the ledger from exceeding its limit, but can't prevent the one trip that caused the rejection from having run. With `reserve: { outputTokens }`, each trip's worst case is reserved in the ledger atomically **before** the call and settled to the actual usage afterwards (released if the call fails), so concurrent runs sharing a key cannot jointly start more work than the cap allows:

```ts
const sharedCap = ai.middleware.budget({
  scoped: {
    key: "tenant:acme",
    window: "day",
    maxTokens: 1_000_000,
    store: memoryScopedBudgetStore(),
  },
  reserve: { outputTokens: 4_096 },
});
```

A trip whose actual usage still exceeds its reservation (an estimate that ran low) is booked in full, and the cap is reported as breached after the fact.

### Stores

| Store                                                                         | Scope               | Notes                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memoryScopedBudgetStore()`                                                   | one process         | Serializes each ledger key in-process. No setup.                                                                                                                                                                                                                                                                                               |
| `cacheScopedBudgetStore({ ... })`                                             | multi-node          | Lazily loads the optional `@warlock.js/cache` peer and uses its atomic `update` primitive. Deployment-wide enforcement needs a cache driver whose `update` is cross-node atomic.                                                                                                                                                               |
| `cascadeScopedBudgetStore({ model })` / `cascadeScopedBudgetStore({ table })` | multi-node, durable | Lazily loads the optional `@warlock.js/cascade` peer. Pass your own `model`, or a `table` name to have it create one. The backing table/collection needs a **unique `(key, windowStart, unit)` index** — the store upserts the ledger row with `$setOnInsert: { used: 0 }`, then conditionally increments only while `used <= limit - amount`. |

```ts
import { cascadeScopedBudgetStore } from "@warlock.js/ai";

const store = await cascadeScopedBudgetStore({ table: "ai_budget_ledgers" });

const monthlyTenantCap = ai.middleware.budget({
  scoped: { key: (ctx) => `tenant:${tenantOf(ctx)}`, window: "month", maxCostUSD: 500, store },
  pricing: { "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 } },
});
```

`ScopedBudgetExceededError` extends `BudgetExceededError` and adds `key`, `window`, and `used` (the amount already in the ledger before this reservation was rejected).

## Production notes

:::note[The contract sits on top of the legacy caps]
`maxTokens` / `maxCostUSD` (top-level) and the `contract` clauses are enforced independently — whichever trips first wins. You can run a hard top-level abort AND a soft contract fallback on the same `budget()` instance: the hard cap is your absolute ceiling, the contract is your SLO target. Keep the contract caps tighter than the hard caps so the soft path fires first.
:::

:::note[Budget is per-execution unless you add `scoped`]
A fresh counter is created at `execute.before` and dies when the run ends; two concurrent `execute()` calls on the same agent enforce `maxTokens`/`maxCostUSD`/`contract` independently. For a cap that must hold across separate runs — a session-wide or daily/monthly limit — add `scoped` (above), backed by a store shared by every process enforcing it. For ad-hoc reporting on spend already recorded, see [Cost per tenant](/v/latest/ai/recipes/cost-aggregate-per-tenant/).
:::

:::note[Cache hits should report zero usage]
The budget accumulates `response.usage.total` after each trip. A semantic-cache hit is expected to surface zero usage, which naturally excludes it from the budget — a cached answer costs nothing and shouldn't count against the cap. If you write a custom cache middleware, return zero usage on a hit so the budget math stays honest.
:::

## Related

- [Attach middleware](/v/latest/ai/reliability/attach-middleware/) — the budget built-in, install order, and the onion model.
- [Handle errors](/v/latest/ai/reliability/handle-errors/) — `BudgetExceededError`, `error.code`, and `error.category`.
- [Cost per tenant](/v/latest/ai/recipes/cost-aggregate-per-tenant/) — record what was actually spent alongside the cap.
