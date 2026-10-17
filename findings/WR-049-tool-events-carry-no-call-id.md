# WR-049 — Agent tool events carry no provider call id

- **Package:** `@warlock.js/ai` 5.30.0 (agent stream events)
- **Classification:** feature request / correctness gap for parallel tools
- **Found:** 2026-10-17, while mapping `agent.stream` events onto a host UI that pairs each tool result with its call.

## Observed

`agent.tool.calling` and `agent.tool.failed` carry only `tool.name`, and `agent.tool.called` carries `toolCall.runId`.
None carries the provider's tool-call id (`ModelToolCallRequest.id`). With concurrent dispatch (the 5.30 default),
two calls to the same tool in one trip cannot be told apart. A host pairing results to calls by name can attribute
a result to the wrong call.

## Request

Add `callId` (the provider tool-call id) to `tool.calling`, `tool.called` and `tool.failed`, and to the matching
middleware contexts.
