---
title: "Recipe — Multi-tool research agent"
description: An agent with web-search, calculator, and database-lookup tools answering a real question, with the full tool-call event stream surfaced live.
sidebar:
  order: 12
  label: "Multi-tool research agent"
---

A user asks your product analytics assistant: *"How many days of runway do we have if our balance is the number I gave finance last quarter, and we're burning the rate shown on our latest investor update?"* Answering it takes three different tools — a database lookup for the recorded balance, a web search for the public investor-update figure, and a calculator to divide one by the other. The interesting part isn't any single tool; it's watching the agent decide which to call, in what order, and surfacing that decision stream to the UI as it happens.

This recipe builds that agent and wires up the `agent.tool.*` event stream so you can render "Searching the web…", "Looking up the ledger…", "Calculating…" in real time.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The three tools

Each tool declares an `action` string (or a function returning one) — that's the human-facing "what is it doing right now" label the framework resolves and puts on the tool-lifecycle events for your UI. The `description` is what the model reads; `action` is what your user reads.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { searchClient, ledgerRepo } from "./services";

const webSearchTool = ai.tool({
  name: "web_search",
  description: "Search the public web for a fact and return the top snippets.",
  action: ({ query }) => `Searching the web for "${query}"`,
  input: v.object({ query: v.string() }),
  execute: async ({ query }) => {
    const hits = await searchClient.search(query, { limit: 3 });
    return { results: hits.map((h) => ({ title: h.title, snippet: h.snippet, url: h.url })) };
  },
});

const dbLookupTool = ai.tool({
  name: "db_lookup",
  description: "Look up a recorded financial metric for a given quarter. Metrics: balance, burn_rate.",
  action: ({ metric, quarter }) => `Looking up ${metric} for ${quarter}`,
  input: v.object({
    metric: v.enum(["balance", "burn_rate"]),
    quarter: v.string(),
  }),
  execute: async ({ metric, quarter }) => {
    const row = await ledgerRepo.metric(metric, quarter);
    if (!row) return { found: false };
    return { found: true, value: row.value, unit: row.unit };
  },
});

const calculatorTool = ai.tool({
  name: "calculator",
  description: "Evaluate a basic arithmetic expression and return the numeric result.",
  action: ({ expression }) => `Calculating ${expression}`,
  input: v.object({ expression: v.string() }),
  execute: async ({ expression }) => {
    // A real implementation uses a safe expression evaluator, not eval().
    const result = safeEval(expression);
    return { result };
  },
});
```

## The agent

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const researchAgent = ai.agent({
  name: "research-assistant",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a precise financial research assistant.")
    .instruction("Use db_lookup for any figure we recorded internally, and web_search for any public figure.")
    .instruction("Never do arithmetic in your head — always call calculator for the final number.")
    .instruction("State which source each number came from."),
  tools: [webSearchTool, dbLookupTool, calculatorTool],
  maxTrips: 8,
});
```

`maxTrips: 8` gives the agent room for a few tool round-trips (lookup → search → calculate → answer) without letting a confused loop run forever.

## Surface the tool-call event stream

Subscribe to the `agent.tool.*` events to drive a live UI. `agent.tool.calling` fires when the model requests a tool (carries the resolved `action` label); `agent.tool.called` fires when it finishes (carries the output, duration, and status); `agent.tool.failed` fires when it errors.

```ts
const question =
  "How many days of runway do we have if our balance is the Q2-2026 figure on file, " +
  "and burn is the monthly rate from our latest investor update?";

const { text, report, error } = await researchAgent.execute(question, {
  on: {
    "agent.tool.calling": ({ tool, tripIndex }) => {
      // tool.action is the pre-resolved human label, e.g. 'Searching the web for "..."'
      console.log(`[trip ${tripIndex}] ${tool.action ?? tool.name}…`);
    },
    "agent.tool.called": (call) => {
      // `call` is the full ToolCall record + a `tool` meta object.
      console.log(`  ↳ ${call.name} ${call.status} in ${call.duration}ms`);
    },
    "agent.tool.failed": ({ tool, error }) => {
      console.log(`  ↳ ${tool.name} failed: ${error.message}`);
    },
  },
});

if (error) {
  console.error(`research failed: ${error.message}`);
} else {
  console.log("\nAnswer:", text);
}
```

A representative run prints something like:

```
[trip 0] Looking up balance for Q2-2026…
  ↳ db_lookup completed in 12ms
[trip 1] Searching the web for "Acme investor update monthly burn rate 2026"…
  ↳ web_search completed in 430ms
[trip 2] Calculating 1840000 / 95000…
  ↳ calculator completed in 1ms

Answer: Your balance on file for Q2-2026 is $1,840,000 (source: internal ledger).
The latest investor update lists a monthly burn of $95,000 (source: web).
That's about 19.4 days... — i.e. roughly 19 months of runway.
```

## Walk the tool calls after the fact

The same data is on the report tree once the run finishes — useful for audit logs, not just live UI. Tool dispatches are child nodes on `report.children`; filter by `type === "tool"` to isolate the leaf tool calls.

```ts
import type { ToolCall } from "@warlock.js/ai";

const toolCalls = report.children.filter((c): c is ToolCall => c.type === "tool");

for (const call of toolCalls) {
  console.log(
    `${call.name} (trip ${call.tripIndex}) ` +
    `input=${JSON.stringify(call.input)} → ${JSON.stringify(call.output)} ` +
    `[${call.status}, ${call.duration}ms]`,
  );
}
```

## When a tool fails mid-research

If `web_search` throws (network blip, rate limit), the agent doesn't crash. It records the error on that `ToolCall`, appends a tool-result message telling the model the call failed, and keeps looping up to `maxTrips`. The model can retry with a different query or fall back to stating what it couldn't verify.

```ts
execute: async ({ query }) => {
  const hits = await searchClient.search(query, { limit: 3 });
  if (hits.length === 0) {
    // Returning an empty-but-valid result is gentler than throwing —
    // the model reads "no results" and adapts instead of seeing an error.
    return { results: [], note: "no results found" };
  }
  return { results: hits.map((h) => ({ title: h.title, snippet: h.snippet, url: h.url })) };
},
```

Inspect any failure post-hoc on the failed tool node's `error` — find it via `report.children.filter((c) => c.type === "tool")`.

## Production notes

- **`action` is for humans, `description` is for the model.** Keep `description` precise enough that the model picks the right tool; keep `action` short and present-tense for the UI. The framework resolves a function-form `action` against the validated input at emit time, so consumers receive a plain string.
- **`agent.tool.called` payload is the `ToolCall` itself plus a `tool` meta.** It carries `status`, `duration`, `input`, and `output` — everything you need for both a live spinner and a persisted audit row, in one event.
- **Bound the loop with `maxTrips`.** A research agent that can call three tools repeatedly is exactly the shape that benefits from a cap. If the model exhausts it while still requesting tools, the run ends with an `AgentMaxTripsError` on `result.error` — distinguishable from a real answer.
- **Prefer graceful tool results over throws for recoverable cases.** "No results" or "not found" as data lets the model adapt within the same run; reserve throwing for genuine failures the model can't reason around.
- **The live events and the final report tree are the same data, different timing.** Drive the UI from `agent.tool.*` events during the run; reconcile and persist from `report.children` (filtered to `type === "tool"`) after it. You don't need to buffer events yourself to get the final picture.
