---
title: "Recipe — Aggregate AI cost per tenant"
description: Read Usage cost, reasoningTokens, and cachedTokens off every run and roll them up into a per-tenant ledger priced from ModelPricing.
sidebar:
  order: 10
  label: "Cost per tenant"
---

> **Scenario.** You run a multi-tenant SaaS where every customer hits the same support agent. Finance needs a monthly invoice line per tenant, and engineering needs to see which tenants burn reasoning tokens (expensive) versus cache hits (cheap). One number — "we spent $4,210 on OpenAI" — answers neither question.
>
> The fix: stamp every `execute()` with the tenant id, read the per-channel `Usage.cost` breakdown off the result, and roll it into a tenant-keyed ledger. Pricing comes from a `ModelPricing` registry configured once on the SDK, so the cost is computed at emit time and stored as a historical fact.

## Configure pricing once, on the SDK

`ModelPricing` is **USD per 1,000,000 tokens**. Declare it on the SDK adapter as a registry keyed by model name; every model the SDK produces inherits the matching entry. With pricing present, every report carries a `Usage.cost` breakdown — without it, `cost` is `undefined` (honest absence, never a false zero).

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";
import { ai } from "@warlock.js/ai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    // USD per 1M tokens — copy straight from the provider's pricing page.
    "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
    // o-series prices reasoning at the output rate by default; set
    // `reasoning` only when the provider bills it separately.
    "o4-mini": { input: 1.1, output: 4.4, reasoning: 4.4 },
  },
});

const supportAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt().instruction("Answer the customer's billing question."),
});
```

## Stamp every run with the tenant id

`sessionId` is the opaque grouping key the framework mirrors onto every report node (and every nested executable). Use the tenant id as the session id — then a flat query over your ledger never has to walk the report tree.

```ts
async function answerForTenant(tenantId: string, question: string) {
  const result = await supportAgent.execute(question, {
    sessionId: tenantId,
  });

  if (result.error) {
    // Cost is still real even on failure — the model was called. Record it
    // before returning so a tenant's failed runs still show up on the invoice.
    await recordSpend(tenantId, result);
    throw result.error;
  }

  await recordSpend(tenantId, result);

  return result.text;
}
```

## Read the cost breakdown off the result

`Usage.cost` mirrors `ModelPricing` — `input`, `output`, and the optional `cachedInput` / `cachedOutput` channels. The token sub-channels (`cachedTokens`, `reasoningTokens`, `cacheWriteTokens`) are separate counters, present only when the provider meters them. There is no single scalar total: sum the populated cost fields, treating `undefined` as `0`.

```ts
import type { AgentResult, ModelPricing } from "@warlock.js/ai";

/** Sum a per-channel cost breakdown into one USD scalar. */
function totalUSD(cost: ModelPricing | undefined): number {
  if (!cost) {
    return 0;
  }

  return (
    cost.input +
    cost.output +
    (cost.cachedInput ?? 0) +
    (cost.cachedOutput ?? 0)
  );
}

async function recordSpend(tenantId: string, result: AgentResult): Promise<void> {
  const { usage, report } = result;

  await tenantSpendRepo.create({
    tenantId,
    runId: report.runId,
    modelName: report.model.name,
    provider: report.model.provider,
    status: report.status,
    // Token channels — undefined when the provider doesn't meter them.
    inputTokens: usage.input,
    outputTokens: usage.output,
    cachedTokens: usage.cachedTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    // Cost channels — the historical USD breakdown captured at emit time.
    inputUSD: usage.cost?.input ?? 0,
    outputUSD: usage.cost?.output ?? 0,
    cachedInputUSD: usage.cost?.cachedInput ?? 0,
    totalUSD: totalUSD(usage.cost),
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    durationMs: report.duration,
  });
}
```

## Roll it up across composites with one middleware

Calling `recordSpend` by hand works for a single agent. The moment you wrap the agent in a workflow, supervisor, or orchestrator, the cleanest place to record is a middleware that fires once per `execute()` — it sees the rolled-up `usage` (own spend plus every child) and the `sessionId` off the run options.

```ts
import type { AgentMiddleware } from "@warlock.js/ai";

const tenantLedger: AgentMiddleware = {
  name: "tenant-ledger",
  execute: {
    after: async (ctx, result) => {
      const tenantId = ctx.options?.sessionId;

      if (!tenantId || !result.usage.cost) {
        return;
      }

      await tenantSpendRepo.create({
        tenantId,
        runId: result.report.runId,
        modelName: ctx.model.name,
        provider: ctx.model.provider ?? "unknown",
        status: result.report.status,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cachedTokens: result.usage.cachedTokens ?? 0,
        reasoningTokens: result.usage.reasoningTokens ?? 0,
        totalUSD: totalUSD(result.usage.cost),
        durationMs: result.report.duration,
      });
    },
  },
};

const supportAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  middleware: [tenantLedger],
});
```

Attach `tenantLedger` to every agent and the ledger becomes a single source of truth — one row per run, already tenant-keyed and priced.

## Query the monthly invoice

With the breakdown stored as columns, the invoice and the engineering view are two queries over the same table:

```sql
-- Per-tenant monthly spend (the invoice line).
SELECT tenant_id,
       SUM(total_usd)      AS spend_usd,
       SUM(reasoning_tokens) AS reasoning_tokens,
       SUM(cached_tokens)  AS cached_tokens,
       COUNT(*)            AS runs
FROM tenant_spends
WHERE started_at >= date_trunc('month', now())
GROUP BY tenant_id
ORDER BY spend_usd DESC;

-- "Which tenants are reasoning-heavy?" — reasoning tokens as a share of output.
SELECT tenant_id,
       SUM(reasoning_tokens)::float / NULLIF(SUM(output_tokens), 0) AS reasoning_share
FROM tenant_spends
WHERE started_at >= now() - interval '7 days'
GROUP BY tenant_id
ORDER BY reasoning_share DESC;
```

## Production notes

:::note[Cost is a stored fact, not a re-derivation]
`Usage.cost` is computed when the report is built, from the pricing table in effect at that moment. Store the USD columns, not just the token counts — if you re-derive cost later against today's `ModelPricing`, a mid-month price change silently rewrites last week's invoice. The framework captures it as history precisely so your ledger stays accurate after the upstream table shifts.
:::

:::note[Unpriced runs are `undefined`, not `0`]
A run on a model with no pricing entry leaves `usage.cost` as `undefined`. The middleware's `if (!result.usage.cost) return;` guard skips those rows rather than booking a false `$0`. Aggregators merge only defined channels, so one unpriced child never erases a priced sibling's cost in a composite's rolled-up total. If you want every run on the ledger, add an explicit `pricing` entry for every model you run — absence is the signal that you forgot one.
:::

:::note[`cachedTokens` is a subset of `input`]
`usage.cachedTokens` counts the input tokens served from the provider's prompt cache; they are already included in `usage.input`. `computeCost` prices them at `cachedInput` (falling back to the full `input` rate when the provider publishes no cache rate) and the rest of `input` at full rate. Don't double-count by adding `cachedTokens` to `input` — read it only to see how much the cache saved.
:::

## Related

- [Pick a provider](../getting-started/03-pick-a-provider) — `ModelPricing`, the token channels, and capability flags.
- [Cost tracking](./cost-tracking) — the per-session dashboard view of the same data.
- [Run agent](../the-basics/run-agent) — the `usage` / `report` envelope `execute()` returns.
