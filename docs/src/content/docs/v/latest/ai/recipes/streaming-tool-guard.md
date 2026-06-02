---
title: "Recipe — Streaming Tool-Call Guard"
description: streamingToolGuard on ai.agent — recover tool calls when cheap models leak the structured input as text in the content stream.
sidebar:
  order: 6
  label: "Streaming tool guard"
---

> **What it is.** A `streamingToolGuard` config on `ai.agent({...})` that catches a tool call when the model emits its structured input as **text** in the content stream instead of as a real `tool_call`. The leaked JSON gets dropped from visible output; the tool dispatches as if the model had called it correctly.
>
> **When you want it.** Production chat surfaces where customers see streamed deltas live and you've registered tools known to leak — `suggest_followups`, side-channel widgets, anything where the model writes the tool input as a JSON envelope in plain prose.
>
> **When you don't.** Agents whose primary output IS a JSON blob the user explicitly asked for (`agent.execute("give me a raw JSON config")`). The guard's buffering adds a small latency penalty there. Also: agents with no tools at all — there's nothing to recover.

---

## The bug it fixes

A cheap or fast model decides to emit:

```
Sure, here are some options.

{"name": "suggest_followups", "arguments": {"suggestions": [...]}}
```

as **text content**, not as a structured tool call. Your customer watches that JSON build up character-by-character on the chat surface. Every `delta` already shipped before the consumer could intervene.

Across providers — Google SDK, OpenAI via OpenRouter — we've reproduced this with multiple models. It correlates with model capability: flagship models rarely do it; budget / fast models do it often.

---

## Quick start

```ts
import { ai } from "@warlock.js/ai";
import { suggestFollowupsTool } from "./tools/suggest-followups.tool";

const talker = ai.agent({
  name: "customer-support-talker",
  model: gemini31Flash,
  tools: [suggestFollowupsTool, searchCatalogTool],
  // Empty object = on with defaults. That's it.
  streamingToolGuard: {},
});
```

The guard turns on. No other wiring. The next time the model leaks the tool's JSON envelope as text, the framework:

1. Suppresses the JSON from `agent.trip.streaming` deltas — the customer never sees it.
2. Synthesizes a real `ModelToolCallRequest` and runs it through the normal dispatch path.
3. Stamps `recoveredFrom: "stream-text"` on the request so your telemetry can count it.

The continuation trip produces the prose the customer DOES see, narrating the tool result the way the rest of your agents do.

---

## How the guard decides

The guard runs only when:

1. The streamed text contains either a `{` or a ```` ```json ```` fence opener.
2. The JSON between that opener and its balanced closer parses cleanly.
3. The parsed object has both:
   - A `name` (or `tool`) key matching a registered tool's `name`, AND
   - An `arguments` (or `input`) key whose value validates against that tool's input schema.

If ANY check fails — unknown tool name, args fail validation, JSON doesn't close — the buffer flushes back as text. The customer sees whatever the model wrote. The guard never invents tool calls.

---

## Configuration

```ts
type StreamingToolGuardConfig = {
  /** Max bytes buffered while inspecting a suspect JSON window. Default: 4096. */
  maxBufferBytes?: number;
};
```

Set it on `AgentConfig` for "always on for this agent," on `AgentExecuteOptions` for per-call override:

```ts
// Agent-level — applies to every execute / stream call.
ai.agent({ model, tools, streamingToolGuard: {} });

// Per-call override — disable for one specific call.
await agent.execute(input, { streamingToolGuard: undefined });

// Per-call override — enable for an agent that has it off.
agent.stream(input, { streamingToolGuard: { maxBufferBytes: 2048 } });
```

Per-call wins. Setting it explicitly to `undefined` in options disables it for that call even if the agent-level config has it on.

---

## What gets through, what doesn't

### Suppressed (recovered as a real tool call)

```
Sure: {"name":"suggest_followups","arguments":{"suggestions":[{"label":"...","value":"..."}]}}
```

→ Customer sees `Sure: `. Tool dispatches. Continuation trip narrates the result.

### Passed through (legitimate JSON the developer asked for)

```
Here's your config: {"foo":"bar","items":[1,2,3]}
```

→ Customer sees the whole thing verbatim. No registered tool named `foo`, so no recovery. The guard is silent.

### Passed through (fenced JSON the model is documenting)

````
Here's an example:
```json
{"example":"data"}
```
````

→ Customer sees the whole fenced block. The classifier ran against `{"example":"data"}`, found no registered tool named `example`, flushed.

### Suppressed (recovered, fenced variant)

````
Here:
```json
{"name":"search_catalog","arguments":{"query":"shoes"}}
```
````

→ Customer sees `Here:\n`. Tool dispatches. Same recovery path as the unfenced version.

---

## Telemetry

The guard stamps `recoveredFrom: "stream-text"` on every recovered `ModelToolCallRequest`. The field is absent on real provider tool-calls — that's the dispatch primitive.

Surface this in your turn-completed log so you can dashboard per-model leak rate:

```ts
const toolsCalled = result.report.children
  .filter(child => child.type === "tool")
  .map(child => ({
    name: child.name,
    // child.input is the validated tool input; for a recovered call you'd
    // also want the `recoveredFrom` provenance, which lives on the model
    // request that produced this dispatch. Walk back through the trip's
    // toolCalls if you want it.
  }));
```

A model with `recovered / total > 0.10` is a strong "drop it from rotation" signal — you're paying full prompt-token cost for output the customer never sees.

---

## Performance

- **Hot path (no opener).** Character-by-character pass-through. Adds a negligible cost to the agent's existing content-accumulation loop.
- **Buffering window.** When the guard engages on a `{`, the customer's WS stream pauses for that envelope. Typical envelope is <1 KB — sub-second pause. The customer was going to see broken JSON anyway; trading that for a brief gap is the whole point.
- **Failed match.** When a buffer doesn't match an envelope, it flushes as one large delta. The customer sees the JSON appear in one shot rather than character-by-character — visually cleaner than the raw streamed leak it replaces.

---

## Constraints

- **Named envelope only (v1).** A buffer that *isn't* envelope-shaped (no `name|tool` + `arguments|input` keys) doesn't match — even if it happens to validate against one of your tool schemas. We avoid bare-object matching while tool input schemas can be permissive; a `v.record(v.any())` schema would match every JSON the user asked for.
- **One pattern.** Right now the guard looks for `{...}` and ```` ```json ... ``` ````. Other markdown wrappers (`<json>` tags, language-tagged fences other than `json`) aren't classified. Expand the recognizer if you ship a workflow that needs it.
- **Per-trip, not per-stream.** A fresh guard instance per LLM trip — tool-result trips are a new turn; envelope state doesn't carry over.

---

## Common questions

**Q: My agent has the guard on but the leak still appears.**
Probably the named-envelope didn't match. Two diagnoses:

1. The tool name in the leaked JSON doesn't match a registered tool exactly. Look at the streamed text — the model might have renamed it (`suggest-followups` vs `suggest_followups`, etc.).
2. The args object doesn't validate against the tool's input schema. Check `tool.input` — if it's strict and the leak is loose, the guard correctly flushes as text. Loosen the schema or rewrite the tool description so the model emits valid args when it does leak.

**Q: Two calls dispatched when only one was meant to.**
Model emitted both a real tool-call AND a narrated JSON envelope for the same call. The framework dedupes structurally identical calls (`name + sorted-key-stringified args`) and drops the synthesized duplicate. If you're seeing TWO dispatches, the args differed — the model emitted slightly different JSON in the two channels. Look at the structured call's input vs. the recovered call's input.

**Q: Customer sees a delay mid-reply.**
Expected when the guard engages on a `{`. The pause matches "time to finish emitting the suspect JSON." If you want shorter pauses, drop `maxBufferBytes` — the guard then gives up faster on long blobs and flushes them as text instead of waiting forever.

---

## Related

- `@warlock.js/ai/src/contracts/streaming-tool-guard-config.type.ts` — `StreamingToolGuardConfig` type with full JSDoc.
- `@warlock.js/ai/src/agent/json-stream-guard.ts` — the state machine.
- `domains/ai/design/streaming-tool-call-guard.md` — internal spec (why this layer, why opt-in, classifier tiers).
- `domains/ai/design/decisions.md` — locked decision §52.
- `domains/ai/plans/2026-05-22-streaming-tool-call-guard.md` — implementation plan + unresolved questions log.
