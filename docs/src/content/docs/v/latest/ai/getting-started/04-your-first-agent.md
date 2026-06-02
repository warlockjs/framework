---
title: "Your first agent"
description: Five-minute walkthrough — install, pick a provider, write a system prompt, run an agent, stream the reply.
sidebar:
  order: 4
  label: "Your first agent"
---

Five minutes from zero to a streaming agent. By the end you'll have run a real OpenAI request, seen the typed result envelope, and streamed tokens to stdout.

## 1. Install

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai
```

Set your API key in `.env`:

```bash
OPENAI_API_KEY=sk-...
```

## 2. The smallest possible agent

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const myAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
});

const result = await myAgent.execute("Say hi in one short sentence.");

console.log(result.text);
console.log(result.usage.total, "tokens");
```

Run it:

```bash
tsx --env-file=.env first-agent.ts
```

You should see a one-line greeting plus the token count.

`gpt-4o-mini` is the cheapest reasonable default. Swap to `gpt-4o` or any other model name on the same `openai.model({...})` call.

## 3. Add a system prompt

The system prompt is what shapes the agent's behavior. It can be a plain string, or a composable `SystemPrompt` built from `ai.persona()` / `ai.instruction()` blocks.

```ts
const myAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are Alex, a senior TypeScript engineer.")
    .instruction("Always cite the relevant TypeScript handbook section.")
    .instruction("Reply in plain prose — no markdown headings."),
});
```

The builder is immutable — each call returns a new prompt — so you can fork a base prompt into variants safely. See [Write system prompts](../the-basics/write-system-prompts) for the full surface.

## 4. Stream tokens to stdout

Replace `execute` with `stream` and iterate. Each event carries a `delta` you can write straight to the terminal:

```ts
const stream = myAgent.stream("Explain generics to a Go developer.");

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") {
    process.stdout.write(event.delta);
  }
}

const result = await stream.result;
console.log("\n\nTotal:", result.usage.total, "tokens");
```

`stream` returns an async iterable plus a `.result` promise. Iterate for the live UI, await for the final envelope.

## 5. Branch on the result

`execute()` never throws. Every failure surfaces as `result.error`:

```ts
const { data, text, error } = await myAgent.execute("…");

if (error) {
  console.error(error.code, error.category, error.message);
  return;
}

console.log(text);
```

You can branch on `instanceof ProviderRateLimitError`, on `error.code === "PROVIDER_RATE_LIMIT"`, or on the coarser `error.category` for dashboards. See [Handle errors](../digging-deeper/handle-errors).

## 6. Add a tool

Tools turn the agent into something more useful than a thin chat wrapper. Each tool is a typed async function the model can call by name.

```ts
import { v } from "@warlock.js/seal";

const getTimeTool = ai.tool({
  name: "get_time",
  description: "Return the current ISO timestamp for a given timezone.",
  input: v.object({ timezone: v.string() }),
  execute: async ({ timezone }) => {
    return { time: new Date().toLocaleString("en-US", { timeZone: timezone }) };
  },
});

const myAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [getTimeTool],
});

const { text } = await myAgent.execute("What time is it in Cairo?");
```

The agent dispatches the tool, feeds the result back into a second trip, and the model produces the natural-language reply. See [Define tools](../the-basics/define-tools).

## 7. Add structured output

When you want a typed object back instead of free text, declare an `output` schema:

```ts
import { v, type Infer } from "@warlock.js/seal";

const summarySchema = v.object({
  title: v.string(),
  bullets: v.array(v.string()).min(1),
});

type Summary = Infer<typeof summarySchema>;

const summarizer = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  output: summarySchema,
});

const { data } = await summarizer.execute(longArticleText);

if (data) {
  // typed as Summary
  console.log(data.title);
  data.bullets.forEach((b) => console.log("-", b));
}
```

Adapters with native `structuredOutput` forward the schema to the provider; others get a soft "respond in JSON only" instruction. Client-side validation always runs, so `data` is type-safe either way.

## Where to go next

- **Composing several agents into a pipeline** → [Run a workflow](../digging-deeper/run-workflow).
- **Routing across multiple agents based on input** → [Run a supervisor](../digging-deeper/run-supervisor).
- **Cap token spend, block PII, cache responses** → [Attach middleware](../digging-deeper/attach-middleware).
- **Survive a crash mid-pipeline** → [Persist AI data](../digging-deeper/persist-ai-data).

## Related

- [Run agent](../the-basics/run-agent) — the agent surface in depth.
- [Define tools](../the-basics/define-tools) — the tool surface in depth.
- [Recipes](../recipes/basic-agent) — copy-paste patterns.
