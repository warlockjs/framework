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

## Mind the two pricing shapes

`budget()` has its **own** pricing table, distinct from the SDK-level `ModelPricing`:

- **`ModelPricing`** (on the SDK / `model({ pricing })`) is **USD per 1,000,000 tokens** and drives `Usage.cost` on reports.
- **`BudgetPricing`** (on `budget({ pricing })`) is **USD per 1,000 tokens**, shape `{ inputPer1K, outputPer1K }`, and is consulted only to enforce the cost cap.

They are separate on purpose — the budget's cost math runs trip-by-trip during the run, before any report is built. Keys in both tables must match the running model's name exactly.

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
    // USD per 1K tokens — note the per-1K shape, not per-1M.
    "gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
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
  console.warn(`budget breach: ${result.error.actual} ${result.error.unit} (cap ${result.error.limit})`);
}
```

`onExceeded: "warn"` is the rollout-first mode: it logs a single warning the first time a cap is breached and lets the run finish, so you can measure real traffic against a proposed cap before flipping to `"abort"`.

## SLO contract — cost, latency, and tokens as one objective

The `contract` clause expresses a full service-level objective and enforces it on top of (and independently of) the legacy caps. Latency is wall-clock milliseconds measured from run start to each trip boundary — the dimension the legacy caps can't express.

```ts
const sloAgent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  middleware: [
    ai.middleware.budget({
      // Cost still needs a pricing entry for the running model.
      pricing: {
        "gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
      },
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

Every clause is optional — supply only the dimensions you care about. A contract with no caps is inert. `maxCostUSD` degrades silently to a no-op without a `pricing` entry for the running model; the token and latency clauses keep enforcing regardless.

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
    "gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
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

## Production notes

:::note[The contract sits on top of the legacy caps]
`maxTokens` / `maxCostUSD` (top-level) and the `contract` clauses are enforced independently — whichever trips first wins. You can run a hard top-level abort AND a soft contract fallback on the same `budget()` instance: the hard cap is your absolute ceiling, the contract is your SLO target. Keep the contract caps tighter than the hard caps so the soft path fires first.
:::

:::note[Budget is per-execution, not per-session]
A fresh counter is created at `execute.before` and dies when the run ends. Two concurrent `execute()` calls on the same agent enforce the cap independently — the middleware holds no cross-run state. For a session-wide or daily cap, read the running spend from your ledger (see [Cost per tenant](./cost-aggregate-per-tenant)) before kicking off the next call and short-circuit at the application layer.
:::

:::note[Cache hits should report zero usage]
The budget accumulates `response.usage.total` after each trip. A semantic-cache hit is expected to surface zero usage, which naturally excludes it from the budget — a cached answer costs nothing and shouldn't count against the cap. If you write a custom cache middleware, return zero usage on a hit so the budget math stays honest.
:::

## Related

- [Attach middleware](../digging-deeper/attach-middleware) — the budget built-in, install order, and the onion model.
- [Handle errors](../digging-deeper/handle-errors) — `BudgetExceededError`, `error.code`, and `error.category`.
- [Cost per tenant](./cost-aggregate-per-tenant) — record what was actually spent alongside the cap.
