---
title: "Stream reasoning and tool arguments"
description: Show the model thinking, a long tool input being written, and token counts as they stream — agent events and model stream chunks.
sidebar:
  order: 6
  label: "Stream reasoning and tool args"
---

Text deltas (`agent.trip.streaming`) are not the only thing a model streams. Most providers also stream their **reasoning** (thinking), the **arguments of a tool call** while the model writes them, and on some providers **token usage** before the response ends. `agent.stream()` surfaces all three as events, so a UI can show the model thinking live, or show a file being written before the `write_file` tool runs.

## Agent events

`agent.stream()` turns these on automatically:

| Event                  | Payload                              | When                                                                                |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `agent.trip.reasoning` | `{ delta, tripIndex }`               | A piece of the model's reasoning text. Never part of the answer.                    |
| `agent.tool.streaming` | `{ callId, name, delta, tripIndex }` | A piece of a tool call's argument JSON. `agent.tool.calling` follows for that call. |
| `agent.trip.usage`     | `{ usage, tripIndex }`               | Token counts so far for this trip (a running total, not an increment).              |

Every event also carries `runId` and `rootRunId`, like the other agent events.

```ts
const stream = assistant.stream("Refactor utils.ts");

for await (const event of stream) {
  if (event.type === "agent.trip.reasoning") ui.thinking.append(event.delta);
  else if (event.type === "agent.trip.streaming") ui.answer.append(event.delta);
  else if (event.type === "agent.tool.streaming")
    ui.toolInput(event.callId, event.name).append(event.delta);
  else if (event.type === "agent.trip.usage") ui.tokens.set(event.usage.total);
}

const result = await stream.result;
```

Or with handlers:

```ts
assistant.stream("Refactor utils.ts").on({
  "agent.trip.reasoning": (event) => ui.thinking.append(event.delta),
  "agent.tool.streaming": (event) => ui.toolInput(event.callId, event.name).append(event.delta),
});
```

The deltas of one `callId` concatenate to the raw argument string; it may be invalid JSON until the last piece. The parsed input still arrives on `agent.tool.calling`. The final usage is on `agent.trip.completed` as before.

These events exist only for `agent.stream()`. `agent.execute()` makes non-streaming calls and never emits them. To turn them off for a streaming agent (to cut event volume), set `modelOptions.streamChunks`:

```ts
ai.agent({ model, modelOptions: { streamChunks: false } }); // none of them
ai.agent({ model, modelOptions: { streamChunks: { reasoning: true } } }); // reasoning only
```

## Model stream chunks

Under the agent, the same data arrives as `ModelStreamChunk`s from `model.stream()`:

```ts
type ModelStreamChunk =
  | { type: "delta"; content: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-args"; callId: string; name: string; delta: string }
  | { type: "usage"; usage: Usage }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "done"; finishReason: FinishReason; usage: Usage; blocks?: ProviderContentBlock[] };
```

When you call `model.stream()` yourself, the three new chunk types are **opt-in**. Without `streamChunks`, a model yields exactly the `delta` / `tool-call` / `done` sequence it always did, so existing consumers keep working unchanged:

```ts
for await (const chunk of model.stream(messages, { streamChunks: true })) {
  if (chunk.type === "reasoning") process.stderr.write(chunk.delta);
  else if (chunk.type === "delta") process.stdout.write(chunk.content);
  else if (chunk.type === "done") console.log(chunk.usage.total, "tokens");
}
```

`streamChunks` takes `true` (everything) or `{ reasoning?, toolArgs?, usage? }`. Once you opt in, ignore chunk types you do not handle and read the finish reason only from `type === "done"`.

`fallbackModel()` forwards the chunks. A `usage` chunk alone does not stop it from falling over to the next model; a `reasoning` or `tool-args` chunk does, like a text delta.

## What each provider streams

| Adapter                               | `reasoning`                                                              | `tool-args`                                 | `usage`                                        |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------- |
| Anthropic                             | `thinking_delta`                                                         | `input_json_delta` of client `tool_use`     | after `message_start` and each `message_delta` |
| OpenAI Responses (`api: "responses"`) | `response.reasoning_summary_text.delta`, `response.reasoning_text.delta` | `response.function_call_arguments.delta`    | — (usage only at the end)                      |
| OpenAI Chat Completions + compatible  | `delta.reasoning_content` / `delta.reasoning` (DeepSeek, Groq, …)        | `tool_calls[].function.arguments` fragments | — (usage only on the final chunk)              |
| Google Gemini                         | parts with `thought: true`                                               | — (calls arrive whole)                      | every chunk carrying `usageMetadata`           |
| Bedrock Converse                      | `reasoningContent.text`                                                  | `toolUse.input` deltas                      | — (usage only in the final `metadata` event)   |
| Ollama                                | `message.thinking`                                                       | — (calls arrive whole)                      | — (usage only on the final chunk)              |

Reasoning text only streams when the provider is asked to show it:

- **Anthropic** — thinking must be on (`modelOptions.reasoning`). Adaptive-thinking models (the Claude 5 family) default to `display: "omitted"`, which streams no thinking text; set `providerOptions: { anthropic: { thinkingDisplay: "summarized" } }` to stream readable summaries.
- **OpenAI Responses** — reasoning summaries need `reasoning.summary`, e.g. `providerOptions: { openai: { body: { reasoning: { summary: "auto" } } } }`. Chat Completions streams no reasoning from OpenAI itself.
- **Gemini** — thought parts need `providerOptions: { google: { body: { thinkingConfig: { includeThoughts: true } } } }`.
- **Bedrock / Ollama** — reasoning must be on (`modelOptions.reasoning`).

Server-run tool inputs (an Anthropic `web_search` query, a Bedrock system tool) are not streamed as `tool-args`: the model never hands those calls to your code. See [Provider-defined tools](/v/latest/ai/tools/provider-tools/).

## Related

- [Run agent](/v/latest/ai/agents/run-agent/) — the event model and `agent.stream()`.
- [Control reasoning](/v/latest/ai/agents/control-reasoning/) — turning reasoning on and off.
- [Serve over SSE](/v/latest/ai/agents/serve-over-sse/) — forward the events to a browser.
