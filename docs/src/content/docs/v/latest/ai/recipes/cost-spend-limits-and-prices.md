---
title: "Recipe — Price list and spend limits"
description: One overridable price list for every provider, a spend hook to persist cost, and per-run, per-session and per-caller caps with ai.middleware.budget.
sidebar:
  order: 12
  label: "Prices and spend limits"
---

> **Scenario.** The app talks to several providers, finance wants every call's cost in your own table, and a runaway session must stop before it costs more than a set amount. All of it is built in: a price list you can override, a spend hook, and `ai.middleware.budget` for run, session and caller caps.

## One price list

Each first-party adapter ships list prices for its current models (USD per 1M tokens, with cached-input and cache-write rates where the provider bills them), applied automatically so `Usage.cost` is filled. Combine them with your own contract rates in one catalogue:

```ts
import { ai } from "@warlock.js/ai";
import { ANTHROPIC_MODEL_PRICING } from "@warlock.js/ai-anthropic";
import { OPENAI_MODEL_PRICING } from "@warlock.js/ai-openai";
import { GOOGLE_MODEL_PRICING } from "@warlock.js/ai-google";

export const prices = ai
  .pricing({ tables: [ANTHROPIC_MODEL_PRICING, OPENAI_MODEL_PRICING, GOOGLE_MODEL_PRICING] })
  .set("claude-sonnet-4-6", { input: 2.4, output: 12, cachedInput: 0.24, cacheWrite: 3 }); // negotiated rate

prices.get("gpt-4o"); // { input: 2.5, output: 10, cachedInput: 1.25 }
prices.costUSD(result.usage, "gpt-4o"); // total USD, or undefined for an unpriced model
```

- `.set()` overrides beat every table; of the tables, the one added last wins.
- Dated snapshot ids (`claude-haiku-4-5-20251001`) resolve to the alias entry.
- An unlisted model returns `undefined`, never `0`.
- `prices.toRecord()` gives a plain record to pass to an SDK's `pricing` option.
- Models whose price depends on prompt length are not in the adapter tables, because one flat rate would be wrong. Add them with `.set()`.

To update a price, change the entry in your catalogue; to track a provider's list, upgrade the adapter.

## Persist what each call cost

```ts
const guard = ai.middleware.budget({
  pricing: prices,
  maxCostUSD: 0.5, // per run
  onSpend: async (spend) => {
    await db.spend.insert({
      sessionId: spend.sessionId,
      model: spend.model,
      tokens: spend.usage.total,
      usd: spend.costUSD, // undefined when the model is unpriced
    });
  },
});
```

`onSpend` runs after every model call, before the caps are compared, so the call that breaches a cap is still recorded. An error thrown inside it is ignored.

## Caps per run, session and caller

| Cap                               | Option                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| One run                           | `maxCostUSD` / `maxTokens`                                                           |
| One session (never resets)        | `scoped: { key: (ctx) => ctx.options?.sessionId, window: "all", maxCostUSD, store }` |
| One caller per day or month (UTC) | `scoped: { key: userId, window: "day" \| "month", maxCostUSD, store }`               |

```ts
const sessionCap = ai.middleware.budget({
  pricing: prices,
  scoped: {
    key: (ctx) => `session:${ctx.options?.sessionId ?? "anonymous"}`,
    window: "all",
    maxCostUSD: 2,
    store: await cascadeScopedBudgetStore({ model: SpendLedger }), // or memoryScopedBudgetStore() in tests
  },
  reserve: { outputTokens: 4_096 }, // refuse the call before it is made
});
```

The ledger store is the persistence: `memoryScopedBudgetStore()` for tests, `cacheScopedBudgetStore()` or `cascadeScopedBudgetStore()` for production, or implement `ScopedBudgetStore` (`reserve`, `commit`, `refund`) on your own database.

Without `reserve`, a scoped cap is checked as each call's usage is booked, so the call that crosses it has already run. With `reserve`, the worst case of the next call is booked in the ledger first; if it would exceed the cap the call is not made and the run fails with `ScopedBudgetExceededError` (a `BudgetExceededError`, with `key`, `window`, `limit`, `used`). Per-run caps raise `BudgetExceededError` the same way.

See [Budget caps and SLO contracts](/v/latest/ai/recipes/cost-budgets-and-slo/) for the contract, fallback and server-tool options.
