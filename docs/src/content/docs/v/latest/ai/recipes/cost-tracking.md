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
      cachedInput: 0.075, // when the provider reports cached input
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

Resolution order: per-model `pricing` > the SDK `pricing` registry > the adapter's **built-in list prices** > `undefined`. The Anthropic, OpenAI, Google, Bedrock, Mistral, Groq and DeepSeek adapters ship tables taken from each vendor's pricing page, with the source and date recorded next to them. Models whose price depends on the prompt length, the time of day or the input modality are left out on purpose — pass `pricing` for those. Each provider page lists what its table covers.

## The shape of `usage.cost`

`ModelPricing` (USD per 1M tokens):

```ts
type ModelPricing = {
  input: number;
  output: number;
  cachedInput?: number; // cache reads (falls back to `input`)
  cacheWrite?: number; // default-lifetime cache writes (falls back to `cachedOutput`, then `input`)
  cacheWrite1h?: number; // 1-hour cache writes (falls back to `cacheWrite`)
  reasoning?: number; // only when reasoning tokens are priced apart from output
  /** @deprecated use cacheWrite */
  cachedOutput?: number;
};
```

`usage.cost` has the same shape, in USD per channel:

```ts
type Usage = {
  input: number; // tokens, as the provider reports them
  output: number;
  total: number;
  cachedTokens?: number; // prompt tokens read from the cache
  cacheWriteTokens?: number; // prompt tokens written to the cache
  cacheWrite1hTokens?: number; // the 1-hour share of cacheWriteTokens
  inputIncludesCache?: boolean; // does `input` already contain the cache tokens?
  reasoningTokens?: number;
  cost?: ModelPricing; // { input, output, cachedInput?, cacheWrite?, reasoning? } in USD
};
```

For one number, use `totalCost(usage.cost)` from `@warlock.js/ai` — it sums every channel (including the legacy `cachedOutput` of reports stored before 5.31) and returns `undefined` for an unpriced run.

Every report node carries `usage`. Cost rolls up the tree — a workflow's `result.usage.cost` is the sum of every agent call inside it.

## Cache reads and writes, per provider

Providers disagree on whether `input` counts the cached part of the prompt, and every adapter says which through `usage.inputIncludesCache`:

| Provider                                     | `input` contains the cache tokens?                              | `inputIncludesCache` |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral | yes — cache reads (and OpenAI cache writes) are part of `input` | `true`               |
| Anthropic, Bedrock Converse                  | no — `input` is the uncached remainder                          | `false`              |

`computeCost` bills each token once at its own rate: fresh input at `input`, cache reads at `cachedInput`, cache writes at `cacheWrite` (the 1-hour share at `cacheWrite1h`), output at `output`. An adapter that leaves the flag unset gets the OpenAI reading.

A worked Anthropic example — `input_tokens: 100`, `cache_read_input_tokens: 50_000`, `cache_creation_input_tokens: 20_000` (5-minute writes), `output_tokens: 500` on `claude-sonnet-4-6` (input $3, cache read $0.30, 5-minute write $3.75, output $15 per 1M):

```ts
import { computeCost, totalCost } from "@warlock.js/ai";

const cost = computeCost(
  {
    input: 100,
    output: 500,
    total: 600,
    cachedTokens: 50_000,
    cacheWriteTokens: 20_000,
    inputIncludesCache: false,
  },
  { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
);
// { input: 0.0003, output: 0.0075, cachedInput: 0.015, cacheWrite: 0.075 }

totalCost(cost); // 0.0978
```

The Anthropic adapter fills the cache-write rates from Anthropic's multipliers (5-minute 1.25x, 1-hour 2x the input rate) when your `pricing` entry leaves them out, and reads the 1-hour share from `usage.cache_creation`.

## Cost of side calls

`model.complete()` and the streaming `done` chunk carry `usage.cost` too when the model is priced, so a summary or classifier call made outside an agent is costed the same way:

```ts
import { totalCost } from "@warlock.js/ai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const model = anthropic.model({ name: "claude-haiku-4-5" }); // built-in list price

const { content, usage } = await model.complete([
  { role: "user", content: "Summarize this thread in one line: ..." },
]);

console.log(content, usage.total, totalCost(usage.cost) ?? "unpriced");
```

Writing your own adapter? Call `attachCost(usage, this.pricing)` on the usage you return — it sets `usage.cost` when priced and leaves it absent otherwise.

## Stamp every run with a sessionId

```ts
const sessionId = `user_${userId}_${dateString}`;

await myAgent.execute(message, { sessionId });
```

The framework stamps `sessionId` onto every report node produced by the run. Use it as the join key on your cost table.

## Persist cost per run

The cleanest pattern is a small middleware that fires on every `execute` completion:

```ts
import { totalCost, type AgentMiddleware } from "@warlock.js/ai";
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
        totalUSD: totalCost(result.usage.cost) ?? 0,
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
      maxCostUSD: 0.5, // per-execute hard cap
      onExceeded: "abort", // throws BudgetExceededError
    }),
    costTracker, // records what was spent
  ],
});
```

Add `reserve: { outputTokens }` to refuse a call **before** it is sent when its worst case would cross the cap, instead of noticing after the trip — see [Cost budgets and SLO contracts](/v/latest/ai/recipes/cost-budgets-and-slo/).

For session-level caps (across many executes), use `budget({ scoped })` with a shared ledger, or enforce at the application layer — read the running spend from your DB before kicking off the next call, return early when over budget.

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
  console.log(
    `  step ${step.name}: ${step.usage?.cost?.input ?? 0} + ${step.usage?.cost?.output ?? 0}`,
  );
}
```

Per-step cost lets you spot the expensive step in a workflow — usually the one with a `gpt-4o` agent that should be `gpt-4o-mini`.

## Related

- [Pick a provider](/v/latest/ai/getting-started/03-pick-a-provider/) — pricing configuration.
- [Run agent](/v/latest/ai/agents/run-agent/) — `usage` on the result envelope.
- [Attach middleware](/v/latest/ai/reliability/attach-middleware/) — the budget built-in and custom middleware.

## Hosted-tool request fees

`ModelPricing.serverTools` uses **USD per request**. Token rates still use USD
per million tokens. `computeCost` adds a `cost.serverTools` object containing
historical USD amounts by tool (`webSearch`, `webFetch`, `codeExecution` or a
provider-specific counter key). `totalCost` includes those amounts, and
`mergeUsage` adds both counters and costs. Unconfigured rates stay absent;
token costs alone are a partial estimate when a hosted tool is unpriced.

```ts
import { computeCost, totalCost } from "@warlock.js/ai";
import { ANTHROPIC_SERVER_TOOL_PRICING } from "@warlock.js/ai-anthropic";

const pricing = {
  input: 3,
  output: 15,
  serverTools: ANTHROPIC_SERVER_TOOL_PRICING,
};
const cost = computeCost(
  {
    input: 100,
    output: 50,
    total: 150,
    serverToolUse: { webSearchRequests: 2, webFetchRequests: 1 },
  },
  pricing,
);
console.log(cost?.serverTools); // { webSearch: 0.02, webFetch: 0 }
console.log(totalCost(cost));
```

Pass this `pricing` to the model (or SDK registry) to cost `complete()`, streaming
`done` and agent trips automatically. Existing built-in token tables remain
unchanged: request prices are explicit opt-ins so tool versions, free allowances
and contract rates are not silently conflated.

Verified list prices on **2026-10-18**:

| Export                          | USD per request                  | Scope and official source                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_SERVER_TOOL_PRICING` | `webSearch: 0.01`, `webFetch: 0` | [Web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool#usage-and-pricing) costs $10/1,000 searches; [fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool#usage-and-pricing) has no extra request fee. Tokens remain additional.  |
| `OPENAI_SERVER_TOOL_PRICING`    | `webSearch: 0.01`                | Standard `web_search`: [OpenAI pricing](https://developers.openai.com/api/docs/pricing#built-in-tools) lists $10/1,000 tool calls plus search-content tokens at model rates. Non-reasoning `web_search_preview` costs $25/1,000 with free search-content tokens: supply its rate explicitly instead. |
| `GOOGLE_SERVER_TOOL_PRICING`    | `webSearch: 0.014`               | [Gemini 3 and newer](https://ai.google.dev/gemini-api/docs/google-search#pricing): each unique nonempty query, $14/1,000 after the shared monthly free allowance. Gemini 2.5 and older bill per grounded prompt, so this per-query table must not be used for them.                                  |

Google's `webSearchRequests` counts unique nonempty queries; its
`googleWebSearchQueries` records the full raw array length. The raw metadata
retains duplicates and empty strings. Stream snapshots replace prior metadata
per candidate; they are not added together. Monthly free allowances and
provider invoice adjustments are not applied locally. Bedrock, Qwen and Kimi
request fees remain unpriced; enabling a tool or echoing a call does not prove
the provider billed one request.
