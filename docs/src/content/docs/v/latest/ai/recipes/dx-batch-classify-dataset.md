---
title: "Recipe — Batch-classify a 10k-row dataset"
description: Run one agent over a ten-thousand-row dataset with ai.batch — bounded concurrency, per-item retry, per-item results, and rolled-up usage for the whole run.
sidebar:
  order: 10
  label: "Batch-classify a dataset"
---

You have a CSV of 10,000 support tickets and you need to tag each one with a category and an urgency. One ticket is a one-line agent call. Ten thousand of them, fired naively in a `Promise.all`, will blow your provider rate limit, retry nothing, and give you no way to tell which rows failed. `ai.batch` is the primitive for exactly this shape: the SAME executable run N times, with bounded concurrency, independent per-item retry, and a rolled-up `usage` + report tree that slots into your cost dashboard like a single run does.

## The scenario

A nightly job classifies the day's incoming tickets so the morning shift sees a pre-triaged queue. Each ticket becomes `{ category, urgency }`. The job must:

- never exceed ~8 concurrent provider calls,
- retry a transient failure per item without blocking its siblings,
- finish even if a handful of rows fail (a bad row must not abort the run),
- report which rows failed and the total token spend.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

## The classifier agent

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v, type Infer } from "@warlock.js/seal";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const classificationSchema = v.object({
  category: v.enum(["billing", "shipping", "technical", "account", "other"]),
  urgency: v.enum(["low", "medium", "high"]),
});

type Classification = Infer<typeof classificationSchema>;

const classifier = ai.agent({
  name: "ticket-classifier",
  model: openai.model({ name: "gpt-4o-mini" }),
  output: classificationSchema,
  maxTrips: 1,
  systemPrompt: ai.systemPrompt()
    .persona("You triage inbound customer-support tickets.")
    .instruction("Pick the single best category and urgency. Be decisive."),
});
```

`maxTrips: 1` keeps each classification to one LLM round-trip — there are no tools, so a second trip would only be waste.

## Run the batch

```ts
import type { AgentResult } from "@warlock.js/ai";

// 10,000 ticket bodies — loaded from CSV, a queue, wherever.
const tickets: string[] = await loadTicketBodies();

const result = await ai.batch<string, unknown, AgentResult<Classification>>(
  classifier,
  tickets,
  {
    name: "nightly-triage",
    concurrency: 8,
    retry: {
      attempts: 3,
      backoff: "exponential",
      // Don't burn a retry on a deterministic schema/validation failure —
      // only retry the transient provider-side errors.
      retryOn: (error) => {
        const code = (error as { code?: string }).code ?? "";
        return code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_UNAVAILABLE";
      },
      onRetry: (attempt, error) =>
        console.warn(`retry #${attempt}:`, (error as Error).message),
    },
    onItem: (item) => {
      // Fires once per row the moment it settles — stream progress to a log.
      if (item.status !== "completed") {
        console.warn(`row ${item.index} ${item.status} after ${item.attempts} attempt(s)`);
      }
    },
  },
);
```

`ai.batch` is generic over the executable's result type. Pinning the third type parameter to `AgentResult<Classification>` makes each `item.result` fully typed — `item.result?.data` is `Classification | undefined`, not `unknown`.

## Collect per-item results and the rolled-up usage

The batch as a whole **never rejects** — a failed row lives on its own `BatchItemResult`, not as a thrown error. Walk `result.items` for the per-row breakdown and read `result.report` / `result.usage` for the roll-up.

```ts
const tagged: { index: number; classification: Classification }[] = [];
const failures: { index: number; code?: string }[] = [];

for (const item of result.items) {
  if (item.status === "completed" && item.result?.data) {
    tagged.push({ index: item.index, classification: item.result.data });
  } else {
    failures.push({ index: item.index, code: item.error?.code });
  }
}

console.log(`${result.report.succeeded}/${result.report.total} classified`);
console.log(`${result.report.failed} failed, ${result.report.cancelled} cancelled`);
console.log(`${result.usage.total} tokens total`);

// `usage.cost` is populated because the SDK was constructed with `pricing`.
if (result.usage.cost) {
  console.log(`cost: $${(result.usage.cost.input + result.usage.cost.output).toFixed(4)}`);
}

// Re-queue just the failed rows for a later pass.
await requeue(failures.map((f) => tickets[f.index]));
```

You can also read outputs positionally: `result.data` is an ordered array of each successful item's `result.data`, with `undefined` in the slots of failed/cancelled rows — handy when you don't care about per-row status and just want to write results back in original order.

```ts
result.data.forEach((classification, index) => {
  if (classification) {
    void writeBack(tickets[index], classification as Classification);
  }
});
```

## Cancelling a long run

Pass an `AbortSignal` to stop a long batch cleanly. In-flight items receive the same signal; rows that hadn't started are reported as `"cancelled"` (never run, no cost) rather than silently dropped.

```ts
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());

const result = await ai.batch(classifier, tickets, {
  concurrency: 8,
  signal: controller.signal,
});
```

## Production notes

:::note[Why batch instead of `Promise.all`]
A hand-rolled `Promise.all` has no concurrency ceiling, no per-item retry, and no rolled-up report — one rejected promise takes the whole run down. `ai.batch` isolates every item: one row's exhausted retries never cancel a sibling, and the batch envelope is the same unified `{ data, usage, report }` shape an agent returns, so a batch nests into the same trace tooling and cost dashboards as everything else.
:::

- **Concurrency is a rate-limit lever, not a speed dial.** Size it to your provider's requests-per-minute, not your CPU. `concurrency` defaults to `items.length` (all at once) — always set it for a real dataset. Values `<= 0` collapse to fully serial.
- **Scope `retryOn` tightly.** Retrying a schema-validation failure just spends three times the tokens to fail the same way. Retry only the transient provider errors (rate limit, 5xx); let deterministic failures fail fast and land on `item.error`.
- **`onItem` throws are swallowed by design** — a progress callback must never break the batch. If you need to know about a hook failure, log inside it; don't rely on it propagating.
- **The roll-up obeys the universal invariant.** `result.usage` and `result.report.usage` are the sum of every item's usage (a batch has zero own cost), and each item's own report hangs under `report.children[]` in original order — so a trace walker sees all 10,000 runs under one root.
- **Lineage groups the whole run.** Pass `sessionId` to stamp it onto the batch report and every child item report, so a flat query like "total spend for the nightly job" groups cleanly.

## Related

- [Basic agent](./basic-agent) — the single-run agent this batch fans out.
- [Cost tracking](./cost-tracking) — turning `usage` into a dashboard.
