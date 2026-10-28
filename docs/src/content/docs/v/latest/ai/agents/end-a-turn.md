---
title: "End a turn from a tool"
description: Stop the agent loop after a tool runs, with no further model call, using stopAfterTools, a tool's endsTurn, or stopWhen. The trip is recorded with finishReason tool_stop.
sidebar:
  order: 8
  label: "End a turn from a tool"
---

By default an agent calls the model again after every round of tool results, so it can read them and answer. Some tools are the answer: "post this message", "hand over to a human", "park this conversation". Another model call after them wastes tokens and often produces a redundant second reply.

Three options end the run right after the tools ran. Use whichever fits.

| Option                                                                   | Where        | Decides from                           |
| ------------------------------------------------------------------------ | ------------ | -------------------------------------- |
| `stopAfterTools: ["post_message"]`                                       | agent config | the tool name                          |
| `endsTurn: true` or `endsTurn: ({ input, output }) => boolean`           | the tool     | the call's input and output            |
| `stopWhen: ({ toolCalls, text, usage, messages, tripIndex }) => boolean` | agent config | anything about the trip, sync or async |

```ts
const support = ai.agent({
  model,
  tools: [searchOrders, postMessage, parkTurn],
  // 1. by name
  stopAfterTools: ["post_message"],
  // 2. by rule (receives this trip's tool calls, with input and output)
  stopWhen: ({ toolCalls }) => toolCalls.some((call) => call.name === "park_turn"),
});

// 3. declared on the tool itself
const parkTurn = ai.tool({
  name: "park_turn",
  description: "Park the conversation until the customer replies.",
  input: parkSchema,
  endsTurn: ({ output }) => output.parked, // or `true`
  execute: async (input) => park(input),
});
```

## What a stopped run looks like

- The trip that requested the tools has `finishReason: "tool_stop"` (`result.report.trips`). Providers never return this value; the agent sets it.
- `result.text` is the text the model wrote beside the tool calls (often empty). No fabricated final answer.
- Usage and cost cover only the model calls that were made, so a stopped run is cheaper than one that went around again.
- The tool calls, their outputs and the tool-result messages are on the report as usual, and the history ends with the tool results. With `ai.session()` the next user message continues from there.
- A run stopped on its last allowed trip does not raise the max-trips error.
- Durable runs: a resumed run whose last trip was `tool_stop` returns without calling the model.

## Rules

- **A failed tool call never stops the run** through `stopAfterTools` or `endsTurn`, so the model can read the error and recover. `stopWhen` sees failed calls too (check `call.error`) and decides for itself.
- When one trip calls several tools, any one that matches stops the run; all of the trip's tools still run first.
- A callback that throws counts as "do not stop" and is logged.
- `mode: "silent"` on a tool is the older, static form: it stops the run when every call of the trip is silent and keeps `finishReason: "tool_calls"`. Prefer `endsTurn` when the decision depends on the call.

See also [Silent tools](/v/latest/ai/recipes/silent-tools/) and [Run an agent](/v/latest/ai/agents/run-agent/).
