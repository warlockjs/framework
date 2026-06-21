---
title: "Recipe — Cost tracking"
description: Track per-session AI spend — configure pricing, group by sessionId, dashboard the per-channel cost breakdown.
sidebar:
  order: 4
  label: "Cost tracking"
---

Every primitive returns `usage` with a per-channel cost breakdown when pricing is configured. This recipe shows how to wire it for a real cost dashboard — per session, per model, per provider.

## Configure pricing

Pricing lives on the SDK adapter (or per-model override). Configure once at boot:

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": {
      input: 0.15,
      output: 0.6,
      cachedInput: 0.075,        // when the provider reports cached input
    },
    "gpt-4o": {
      input: 5.0,
      output: 15.0,
    },
  },
});
```

Values are USD per 1M tokens (matching OpenAI's published pricing page). The framework converts internally to per-token rates.

Per-model overrides win:

```ts
const customModel = openai.model({
  name: "my-org/finetune",
  pricing: { input: 1.0, output: 3.0 },
});
```

`undefined` pricing → `usage.cost` is `undefined`. Honest absence over false zero.

## The shape of `usage.cost`

```ts
type CostBreakdown = {
  input: number;          // USD
  output: number;
  cachedInput?: number;
  cachedOutput?: number;
};

type Usage = {
  input: number;          // tokens
  output: number;
  total: number;
  cost?: CostBreakdown;
};
```

Every report node carries `usage`. Cost rolls up the tree — a workflow's `result.usage.cost` is the sum of every agent call inside it.

## Stamp every run with a sessionId

```ts
const sessionId = `user_${userId}_${dateString}`;

await myAgent.execute(message, { sessionId });
```

The framework stamps `sessionId` onto every report node produced by the run. Use it as the join key on your cost table.

## Persist cost per run

The cleanest pattern is a small middleware that fires on every `execute` completion:

```ts
import type { AgentMiddleware } from "@warlock.js/ai";
import { spendsRepo } from "./repos";

const costTracker: AgentMiddleware = {
  name: "cost-tracker",
  execute: {
    after: async (ctx, result) => {
      if (!result.usage.cost) return;

      await spendsRepo.create({
        sessionId: ctx.options?.sessionId,
        agentName: ctx.agent.name,
        modelName: ctx.model.name,
        provider: ctx.model.provider,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        inputUSD: result.usage.cost.input,
        outputUSD: result.usage.cost.output,
        totalUSD:
          result.usage.cost.input +
          result.usage.cost.output +
          (result.usage.cost.cachedInput ?? 0) +
          (result.usage.cost.cachedOutput ?? 0),
        startedAt: result.report.startedAt,
        endedAt: result.report.endedAt,
        duration: result.report.duration,
      });
    },
  },
};

const myAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  middleware: [costTracker],
});
```

Attach `costTracker` to every agent and you get a single source of truth on cost.

## Combine with budget for hard caps

`costTracker` measures. `budget` enforces:

```ts
ai.agent({
  model,
  middleware: [
    ai.middleware.budget({
      maxCostUSD: 0.5,         // per-execute hard cap
      onExceeded: "abort",     // throws BudgetExceededError
    }),
    costTracker,                // records what was spent
  ],
});
```

For session-level caps (across many executes), enforce at the application layer — read the running spend from your DB before kicking off the next call, return early when over budget.

## Group dashboards by category

`error.category` and `report.status` belong on the same row as cost. Then you can answer:

- "What's the cost of failed runs?" (`status = 'failed'`)
- "What's the cost broken down by error category?" (`category = 'rate-limit'` vs `category = 'content-filter'`)
- "Per-model cost per session." (`group by session_id, model_name`)

```sql
SELECT model_name, provider, count(*), sum(total_usd)
FROM ai_spends
WHERE session_id = $1
GROUP BY model_name, provider
ORDER BY sum(total_usd) DESC;
```

## Sample report tree

```ts
const { usage, report } = await myWorkflow.execute(input);

console.log("Total cost:", usage.cost);
// { input: 0.0042, output: 0.0181 }

for (const step of Object.values(report.steps)) {
  console.log(`  step ${step.name}: ${step.usage?.cost?.input ?? 0} + ${step.usage?.cost?.output ?? 0}`);
}
```

Per-step cost lets you spot the expensive step in a workflow — usually the one with a `gpt-4o` agent that should be `gpt-4o-mini`.

## Related

- [Pick a provider](../getting-started/03-pick-a-provider) — pricing configuration.
- [Run agent](../the-basics/run-agent) — `usage` on the result envelope.
- [Attach middleware](../digging-deeper/attach-middleware) — the budget built-in and custom middleware.
