---
title: "Recipe — Tool-calling agent"
description: An agent with real tools — weather lookup, order fetch, a silent state-update tool. Shows the full trip loop in practice.
sidebar:
  order: 2
  label: "Tool-calling agent"
---

A support agent that can look up an order, check shipping status, and quietly update customer preferences. Three tools, three different `mode` values, real round-trips.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The tools

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { ordersRepo, shippingRepo, preferencesRepo } from "./repos";

const lookupOrderTool = ai.tool({
  name: "lookup_order",
  description: "Find an order by ID. Returns status, line items, total.",
  action: ({ orderId }) => `Looking up order ${orderId}`,
  input: v.object({ orderId: v.string() }),
  execute: async ({ orderId }) => {
    const order = await ordersRepo.find(orderId);
    if (!order) return { found: false, message: "no such order" };
    return { found: true, status: order.status, total: order.total, items: order.items };
  },
});

const trackShipmentTool = ai.tool({
  name: "track_shipment",
  description: "Get current shipment status for an order. Returns carrier, ETA, last update.",
  action: ({ orderId }) => `Checking shipment for ${orderId}`,
  input: v.object({ orderId: v.string() }),
  execute: async ({ orderId }) => {
    const shipment = await shippingRepo.byOrder(orderId);
    return shipment ?? { tracked: false };
  },
});

const updatePreferencesTool = ai.tool({
  name: "update_preferences",
  description: "Persist a customer's preference change (language, currency, notifications).",
  mode: "silent",                              // model never sees the return
  input: v.object({
    language: v.string().optional(),
    currency: v.string().optional(),
    notifications: v.enum(["all", "important", "none"]).optional(),
  }),
  execute: async (patch, ctx) => {
    const customerId = ctx.artifacts.customerId as string;
    await preferencesRepo.update(customerId, patch);
    return { ok: true };
  },
});
```

Three tools:

- **`lookup_order`** — feedback mode (default). Result feeds back; the model narrates it.
- **`track_shipment`** — feedback mode. Same pattern.
- **`update_preferences`** — silent mode. Side effect only. The agent loop terminates if it's the only tool called this trip.

## The agent

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const support = ai.agent({
  name: "customer-support",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a calm, helpful customer support agent for Acme Corp.")
    .instruction("Always look up the order before answering questions about it.")
    .instruction("When the customer mentions a preference change, call `update_preferences` alongside your reply."),
  tools: [lookupOrderTool, trackShipmentTool, updatePreferencesTool],
  maxTrips: 5,
});
```

## Run it

```ts
const { text, report } = await support.execute(
  "Where is my order #A-7711? And please switch me to Spanish.",
);

console.log(text);

// Tool dispatches live in the report tree as children with type "tool".
// `ToolCall` (type: "tool") is exported from @warlock.js/ai.
const toolCalls = report.children.filter(
  (c): c is import("@warlock.js/ai").ToolCall => c.type === "tool",
);
for (const call of toolCalls) {
  console.log(`  tool ${call.name} (trip ${call.tripIndex}, ${call.duration}ms)`);
}
```

Likely flow:

1. **Trip 0** — Model calls `lookup_order({ orderId: "A-7711" })` and `update_preferences({ language: "es" })` in the same generation.
2. Agent dispatches both. `lookup_order` returns data; `update_preferences` writes to the DB silently.
3. **Trip 1** — Model reads the order data, then either calls `track_shipment` or replies in prose.
4. **Trip 2** — Model emits the final reply.

Cost: 2-3 LLM trips, depending on whether the model fetches shipment data. Without silent mode on the preferences tool, the model would have written follow-up prose that nobody asked for.

## Tool error handling

If `lookupOrderTool.execute` throws, the agent records the error on the `ToolCall`, tells the model what failed, and loops up to `maxTrips`:

```ts
execute: async ({ orderId }) => {
  if (!isValidOrderFormat(orderId)) {
    throw new Error("orderId must look like A-####");
  }
  // ...
}
```

The model gets a chance to retry with a corrected input. Inspect the failure on the tool call's `error` field — each tool dispatch is a `type: "tool"` child of `report.children`.

## Inject context via artifacts

The silent preferences tool needs to know WHICH customer to update. That context comes from `ctx.artifacts` — populated by the agent caller, not by the model:

```ts
// At the call site:
await support.execute(message, {
  // Pre-populating artifacts isn't a direct API today.
  // The clean pattern is to scope the tool to the customer at construction time:
});
```

Better: bind the customer at tool construction:

```ts
function makeUpdatePreferencesTool(customerId: string) {
  return ai.tool({
    name: "update_preferences",
    mode: "silent",
    input: preferencesSchema,
    execute: async (patch) => {
      await preferencesRepo.update(customerId, patch);
      return { ok: true };
    },
  });
}
```

Build a fresh agent per request, or rebuild the tool with the customer in scope. This keeps the model from being able to confuse customers across sessions.

## Related

- [Define tools](../the-basics/define-tools) — the tool factory in depth.
- [Silent tools recipe](./silent-tools) — `mode: "silent"` patterns and provider behavior.
- [Streaming tool guard](./streaming-tool-guard) — recovering tool calls leaked as text.
