---
title: "Stream structured output"
description: ai.streamObject streams raw token deltas, progressively-parsed partial-object snapshots, and a single strictly-validated final object against a Standard Schema.
sidebar:
  order: 9
  label: "Stream structured output"
---

`ai.streamObject` is the first-class primitive for *streaming a structured object*. It does three things at once from a single model call:

1. **`text-delta`** — the raw token text as it arrives, for a live "typing" view.
2. **`partial`** — a best-effort snapshot of the object *so far*, re-parsed from the accumulated text on each delta (only re-emitted when it actually changed). Use it to render a form that fills in field-by-field.
3. **`done`** — the terminal event: the complete text is strictly `JSON.parse`'d and validated against your Standard Schema. On success you get the typed `value`; on failure you get a typed `error`.

The key invariant: the tolerant partial parser only ever feeds the live preview. The authoritative final value is always a strict parse plus schema validation — an over-eager partial parse can never corrupt the result you persist.

It is a standalone async generator, not part of the agent loop. Reach for it when you want to drive a progressively-rendering UI off one structured response; reach for [`ai.agent`](./run-agent) when you need tools, repair, or multi-trip orchestration.

## Signature

```ts
import { ai } from "@warlock.js/ai";

function streamObject<T>(params: {
  model: ModelContract;        // e.g. openai.model({ name: "gpt-4o" })
  messages: Message[];         // the prompt
  schema: StandardSchemaV1<T>; // validates the FINAL object
  options?: ModelCallOptions;  // responseSchema, temperature, …
}): AsyncIterable<ObjectStreamEvent<T>>;
```

`schema` is any Standard Schema — `@warlock.js/seal`'s `v` builder qualifies, so the same schema can both validate the final object and (via `options.responseSchema`) drive a provider's native structured-output mode.

## The event shape

```ts
type ObjectStreamEvent<T> =
  | { type: "text-delta"; delta: string }
  | { type: "partial"; value: unknown }                       // tolerant snapshot
  | { type: "done"; valid: true; value: T; usage: Usage }     // strict + validated
  | { type: "done"; valid: false; error: AIError; usage: Usage };
```

- `partial.value` is `unknown` on purpose — it is a *work-in-progress* object that has not been validated and may be missing fields. Never persist it.
- Exactly one `done` event is yielded, last. `valid: true` carries the typed `value`; `valid: false` carries a `SchemaValidationError` (a subclass of `AIError`) — either the streamed text wasn't valid JSON, or it parsed but failed the schema.
- `usage` on `done` is the token usage reported by the model's terminal stream chunk.

## Basic usage

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.model({ name: "gpt-4o" });

const schema = v.object({
  title: v.string(),
  tags: v.array(v.string()),
  summary: v.string(),
});

const stream = ai.streamObject({
  model,
  schema,
  messages: [
    { role: "user", content: "Summarize this article as JSON: …" },
  ],
});

for await (const event of stream) {
  if (event.type === "partial") {
    render(event.value); // live UI — re-render the form as fields fill in
  }

  if (event.type === "done") {
    if (event.valid) {
      await save(event.value); // typed, schema-validated — safe to persist
    } else {
      console.error(event.error.message);
    }
  }
}
```

The `text-delta` events are emitted alongside `partial` events — pull them out if you also want a raw token stream (a typing cursor) next to the structured preview.

:::tip
Pair `streamObject` with a `structuredOutput`-capable model and pass your schema's JSON Schema through `options.responseSchema` for the cleanest JSON. When the provider can't do native structured output, prompt the model to reply with JSON only — `streamObject` strips a leading/trailing ```json fence before the final parse, so a fenced reply still validates.
:::

## Only need the final object — `collectStreamObject`

When you don't care about the live preview and just want the validated result (or a typed error), wrap the stream with `collectStreamObject`. It drains the stream and returns only the terminal `done` event.

```ts
import { collectStreamObject, ai } from "@warlock.js/ai";

const done = await collectStreamObject(
  ai.streamObject({ model, schema, messages }),
);

if (done.valid) {
  use(done.value);
} else {
  handle(done.error);
}
```

`collectStreamObject` is a named package export — it is not on the `ai` namespace.

## The tolerant partial parser — `parsePartialJson`

The `partial` snapshots are produced by `parsePartialJson`, a tolerant parser that closes open braces/brackets and trims dangling tokens so an incomplete JSON string still yields a usable object. It is exported for advanced cases where you stream tokens yourself:

```ts
import { parsePartialJson } from "@warlock.js/ai";

parsePartialJson('{ "title": "Hel');     // → { title: "Hel" }
parsePartialJson('{ "tags": ["a", "b"'); // → { tags: ["a", "b"] }
```

It returns `undefined` when nothing parseable has arrived yet. This is a preview-only tool — the final `done` event never uses it; it always does a strict `JSON.parse`.

## Options

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `model` | `ModelContract` | yes | The model to stream from (e.g. `openai.model({ name })`). Uses its existing `stream()` seam. |
| `messages` | `Message[]` | yes | The prompt messages. |
| `schema` | `StandardSchemaV1<T>` | yes | Validates the final object. Drives the typed `value`. |
| `options` | `ModelCallOptions` | no | Forwarded to `model.stream(...)` — `responseSchema`, `temperature`, etc. |

## Related

- [Run agent](./run-agent) — when you need tools, repair, and multi-trip orchestration instead of a single structured response.
- [Extract structured data with self-repair](../recipes/agent-extract-structured-data) — the agent-loop counterpart: validate against a `v` schema and re-ask the model on failure.
- [Handle errors](../digging-deeper/handle-errors) — `SchemaValidationError` and the rest of the typed error hierarchy.
- [Embed text](./embed-text) — another standalone SDK primitive that sits outside the agent loop.
