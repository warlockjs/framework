---
title: "Recipe — Basic agent"
description: A complete runnable agent — system prompt, structured output, streaming, error handling. Copy-paste starter.
sidebar:
  order: 1
  label: "Basic agent"
---

The smallest production-shaped agent you'll write: a system prompt, structured output, streaming, error branching. Everything fits in one file.

## What you'll build

A summarizer agent that takes a long article and returns `{ title, bullets }`. Streams tokens to stdout while it runs. Branches typed errors. Caps cost via middleware.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

## The agent

```ts
import { ai, ProviderRateLimitError, ContextLengthExceededError } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v, type Infer } from "@warlock.js/seal";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const summarySchema = v.object({
  title: v.string(),
  bullets: v.array(v.string()).min(2).max(7),
});

type Summary = Infer<typeof summarySchema>;

const summarizer = ai.agent({
  name: "article-summarizer",
  model: openai.model({ name: "gpt-4o-mini" }),
  output: summarySchema,
  systemPrompt: ai.systemPrompt()
    .persona("You are an editor who writes tight, factual summaries.")
    .instruction("Title is 8 words or fewer.")
    .instruction("Each bullet is one sentence, plain prose, no markdown."),
  middleware: [
    ai.middleware.budget({
      maxTokens: 20_000,
      maxCostUSD: 0.05,
      onExceeded: "abort",
    }),
  ],
});
```

## Run it — blocking

```ts
const article = await fetch("https://example.com/article").then((r) => r.text());

const { data, error, usage } = await summarizer.execute(article);

if (error) {
  if (error instanceof ProviderRateLimitError) {
    console.warn("rate limited, retry after", error.retryAfter, "ms");
  } else if (error instanceof ContextLengthExceededError) {
    console.warn("article too long for", error.modelName, "— need to chunk");
  } else {
    console.error(error.code, error.category, error.message);
  }
  return;
}

console.log(data?.title);
data?.bullets.forEach((b) => console.log("-", b));
console.log("\nused", usage.total, "tokens, cost:", usage.cost?.input + usage.cost?.output, "USD");
```

## Run it — streaming

```ts
const stream = summarizer.stream(article);

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") {
    process.stdout.write(event.delta);
  }
}

const { data, error } = await stream.result;

if (error) {
  console.error("\n\nfailed:", error.code);
} else {
  console.log("\n\nparsed:", data?.title);
}
```

## What you got for free

- **Typed `data`.** `summarySchema` flows through to `data: Summary | undefined`.
- **Cost cap.** Budget middleware aborts before runaway spend.
- **Per-channel cost.** `usage.cost` is `{ input, output }` in USD because `pricing` is configured.
- **Typed errors.** Rate-limit, context-length, content-filter — all distinct `AIError` subclasses you can branch on.
- **No try/catch.** `execute()` never throws. The whole flow is straight-line.

## Where to take it

- Add a tool — see [Tool-calling agent](./tool-calling-agent).
- Add RAG — see [RAG with cache similarity](./rag-with-cache-similarity).
- Add cost tracking dashboard — see [Cost tracking](./cost-tracking).

## Related

- [Run agent](../the-basics/run-agent) — the full API surface.
- [Write system prompts](../the-basics/write-system-prompts) — composable prompts.
- [Handle errors](../digging-deeper/handle-errors) — the full error hierarchy.
