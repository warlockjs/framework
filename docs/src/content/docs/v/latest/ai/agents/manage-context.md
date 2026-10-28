---
title: "Manage context"
description: Keep long agent runs inside the context window with contextEditing (clear old tool results, no model call, native on Anthropic) and compaction (summarize), and when to use which.
sidebar:
  order: 9
  label: "Manage context"
---

A tool-heavy run grows with every trip: each result stays in the history and is re-sent on every later call. Two agent options keep that in check. Both are off by default and both work with every provider.

|                      | `contextEditing`                                                      | `compaction`                                                 |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| What it does         | Replaces the content of **old tool results** with a short placeholder | Replaces an **old slice of the conversation** with a summary |
| Extra model call     | No                                                                    | Yes (your `summarize` callback)                              |
| Provider-native form | Anthropic `clear_tool_uses`                                           | Anthropic server-side compaction (`providerOptions`)         |
| Loses                | Tool output (the call and its arguments stay visible)                 | Detail of everything in the slice                            |

When both are set, editing runs first and compaction summarizes what is still too large.

## Clear old tool results

```ts
const worker = ai.agent({
  model,
  tools,
  contextEditing: {
    clearToolResults: {
      afterTokens: 60_000, // start once the history is estimated at this size; omit to clear every trip
      keep: 4, // newest tool results that stay intact (default 3)
      exclude: ["plan"], // tools whose results are never cleared
      placeholder: "[cleared]", // default: "[tool result cleared to save context]"
    },
  },
});
```

`clearToolResults: true` uses the defaults (keep 3, no size threshold).

Only the `content` of old `tool` messages changes. Every tool call still has its result, so the history stays valid for every provider, and the model still sees which tool ran with which arguments. Results are cleared in the agent's history, so they stay cleared on later trips (this also keeps provider prompt caches stable after the first edit) and in `report.messages` and durable snapshots.

`afterTokens` is compared with an offline character estimate of messages and tool schemas. Pass `countTokens(messages, options)` for an exact count (`model.countTokens` when the model has one).

### Native providers

A model that sets `capabilities.nativeContextEditing` (the Anthropic adapter does) handles the edit server-side: the agent sends the rule as `ModelCallOptions.contextEditing` and leaves the history alone. The Anthropic adapter turns it into a `clear_tool_uses_20250919` edit (`afterTokens` is the input-token trigger, `keep` the number of tool uses kept, `exclude` becomes `exclude_tools`) and adds the context-management beta. An explicit `providerOptions.anthropic.contextManagement.clearToolUses` still wins over the neutral rule.

Set `contextEditing.native: false` to edit on the client even on such a model. Other adapters ignore the hint, so the agent clears client-side for them.

The model needs to support context editing on Anthropic's side (Claude 4 and later); pass `native: false` for a proxy or older model that does not.

## Summarize

`compaction` is covered in [Run an agent](/v/latest/ai/agents/run-agent/#automatic-compaction-inside-an-agent-run): `afterTokens`, `keep` and a `summarize` callback (`ai.compaction.summarize({ model })` builds one). Reach for it when the conversation itself, not just tool output, outgrows the window.

## Which one

- Large tool outputs (file reads, search results, API payloads): `contextEditing`. Cheap, no extra call.
- Long chats with little tool use: `compaction`.
- Both for long autonomous runs.
- Anthropic only: its server-side compaction is available through `providerOptions.anthropic.serverCompaction` as well.
