---
title: "Recipe — Tools that emit UI artifacts"
description: Silent tools that write rich UI blocks into ctx.artifacts instead of round-tripping JSON through the model, so a product card renders without a second LLM trip.
sidebar:
  order: 13
  label: "Silent tools UI"
---

A shopping assistant returns a product carousel. The naive design is: the model calls `search_catalog`, the tool returns a JSON blob of products, that blob round-trips back into the model, and the model re-emits the products as prose or some structured shape your UI then parses. That's a second LLM trip you pay for, plus a lossy reformatting of data you already had in hand.

The better design: the tool writes the carousel *blocks* — exactly the shape your frontend renders — into a **side-channel** that never touches the model, and returns only a tiny summary (`{ total: 5 }`) on the LLM channel so the model can say "I found 5 quiet ACs" without ever seeing or reshaping the product data. That side-channel is `ctx.artifacts`.

This recipe combines two `@warlock.js/ai` features:

- **`ctx.artifacts`** — a mutable bag threaded into every tool's `execute(input, ctx)`. Writes here are captured by the system; they never round-trip through the LLM. The tool's *return value* is what the model sees; `ctx.artifacts` is what your UI consumes.
- **`mode: "silent"`** — when every tool call in a generation is silent, the agent loop terminates after dispatch. The prose the model already streamed IS the final reply. No second trip.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The artifact-emitting tool

The tool searches the catalog, pushes render-ready blocks into `ctx.artifacts.blocks`, and returns only a compact summary on the model channel.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { catalogRepo } from "./services";

// The exact shape your frontend renders — never reshaped by the model.
type UiBlock =
  | { type: "product_card"; id: string; title: string; price: number; image: string }
  | { type: "notice"; text: string };

const searchCatalogTool = ai.tool({
  name: "search_catalog",
  description: "Search the product catalog. Returns a count; the UI renders the cards.",
  action: ({ query }) => `Searching the catalog for "${query}"`,
  input: v.object({
    query: v.string(),
    maxPrice: v.number().optional(),
  }),
  execute: async ({ query, maxPrice }, ctx) => {
    const products = await catalogRepo.search(query, { maxPrice, limit: 6 });

    // SIDE-CHANNEL: push render-ready blocks. The model never sees this.
    const bag = ctx?.artifacts as { blocks?: UiBlock[] } | undefined;

    if (bag) {
      bag.blocks ??= [];

      for (const p of products) {
        bag.blocks.push({
          type: "product_card",
          id: p.id,
          title: p.title,
          price: p.price,
          image: p.imageUrl,
        });
      }

      if (products.length === 0) {
        bag.blocks.push({ type: "notice", text: `No matches for "${query}".` });
      }
    }

    // MODEL CHANNEL: a tiny summary the model narrates. No product data leaks here.
    return { total: products.length };
  },
});
```

Note `mode` is **not** set on this tool. It's a `feedback` tool by design here — see the trade-off below. The pure-side-effect silent variant is shown after.

## The agent

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const shopper = ai.agent({
  name: "shopping-assistant",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a friendly shopping assistant.")
    .instruction("When the customer asks for products, call search_catalog.")
    .instruction("Summarize the result in one short sentence. The UI shows the cards — do not list products yourself."),
  tools: [searchCatalogTool],
  maxTrips: 4,
});
```

## Run it — collect the artifacts at the call site

The caller owns the artifacts bag: create it, pass it as `toolCtx`, read it back after the run. The tool mutates the same object reference, so the blocks are waiting for you when `execute()` resolves.

```ts
// Caller-owned bag. The tool writes into `artifacts.blocks`; we read it after.
const ctx = { artifacts: {} as { blocks?: UiBlock[] } };

const { text, report, error } = await shopper.execute(
  "Show me quiet air conditioners under 2000 AED for a bedroom.",
  { toolCtx: ctx },
);

if (error) {
  return { reply: "Sorry, something went wrong.", blocks: [] };
}

// `text` is the model's one-line narration; `ctx.artifacts.blocks` is the UI payload.
return {
  reply: text,                          // "I found 5 quiet units for you."
  blocks: ctx.artifacts.blocks ?? [],   // [{ type: "product_card", ... }, ...]
};
```

Your API returns `reply` (the prose) and `blocks` (the cards) as two clean channels. The model never had to serialize, and never reshaped, the product data — it only ever saw `{ total: 5 }`.

## The fully-silent variant — pure side effect, one trip

When the model's reply does **not** depend on the tool's result at all — e.g. the customer says "remember I prefer matte finishes" and you want to persist that preference and render a confirmation chip without a second LLM trip — make the tool `silent`. The agent terminates after dispatch; the prose the model streamed alongside the call is the final reply.

```ts
const pinPreferenceTool = ai.tool({
  name: "pin_preference",
  description: "Persist a stated customer preference and surface a confirmation chip.",
  mode: "silent",                       // result never round-trips to the model
  input: v.object({
    key: v.string(),
    value: v.string(),
  }),
  execute: async ({ key, value }, ctx) => {
    await preferencesRepo.set(key, value);

    const bag = ctx?.artifacts as { blocks?: UiBlock[] } | undefined;

    if (bag) {
      bag.blocks ??= [];
      bag.blocks.push({ type: "notice", text: `Saved: ${key} = ${value}` });
    }

    return { ok: true };               // the model never reads this
  },
});
```

:::caution
On the OpenAI line (`gpt-4o`, `gpt-4o-mini`), a silent-**only** turn often produces **no prose** — the model emits the tool call alone. If the customer must see an acknowledgement, render it from your `ctx.artifacts` blocks (the confirmation chip above) rather than relying on the model to narrate. Claude models reliably emit prose alongside the tool call; OpenAI ones do not. Don't design the user-visible acknowledgement around model prose for a silent-only turn.
:::

## Why feedback vs silent here

| Tool | Mode | Why |
| --- | --- | --- |
| `search_catalog` | `feedback` | The model must narrate *something* about the results ("I found 5"). It needs the `{ total }` summary back to phrase that — so it round-trips. The heavy product data still bypasses the model via artifacts. |
| `pin_preference` | `silent` | The model's reply doesn't depend on the write succeeding. Skip the second trip entirely; render the confirmation from artifacts. |

The rule of thumb: if the model needs to *say something that depends on the tool's outcome*, keep it `feedback` and return a **minimal** summary (not the full payload). If the model's reply is independent of the outcome, make it `silent`.

## Production notes

- **Strict channel separation is the whole point.** The tool `return` value is the LLM channel; `ctx.artifacts` is the system channel. Never put raw render data in the return value "just in case" — that defeats the purpose and bloats token cost. Keep returns to counts, ids, and booleans.
- **The caller owns the bag.** For a standalone agent, you pass `toolCtx: { artifacts: {} }` and read it after `execute()`. Under a supervisor the bag is managed for you (it resets per iteration and merges into state via `artifactsSchema` / `finalizeArtifacts`), so you don't thread it manually there.
- **Silent tools must be cheap and idempotent.** They have no channel to report failure to the model, and the HTTP request stays open until they resolve. Keep them to local writes and in-memory mutations; kick long work onto a queue and return immediately.
- **Middleware still sees silent tools.** Logging, cost tracking, and telemetry middleware observe them normally — `mode === "silent"` is exposed on the middleware tool context so cost code can skip projecting a follow-up trip's tokens.
- **A feedback tool that returns a minimal summary gets you the best of both.** One narration trip, zero data reshaping. Reach for fully-silent only when no narration is needed.
