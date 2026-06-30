---
title: "Record / replay testing"
description: ai.vcr(model, { path, mode }) — wrap any model in a record/replay cassette for deterministic, offline, zero-cost tests; a replay miss fails loud instead of calling the live provider.
sidebar:
  order: 12
  label: "Record / replay testing"
---

`ai.vcr(model, options)` wraps any `ModelContract` in a record/replay decorator backed by a JSON **cassette** on disk. The first run records every model call; later runs replay them — so a test that exercises real prompt/tool wiring runs **deterministically, offline, and for free**, and a call that was never recorded fails loud instead of silently hitting the provider.

It intercepts only `complete()` / `stream()` — the single seam every agent trip funnels through — and delegates `name`, `provider`, `capabilities`, and `pricing` to the inner model untouched, so cost accounting is unchanged. Because it depends only on `ModelContract`, it works with any adapter and composes *below* [`ai.fallbackModel`](./resilience).

## The shape

```ts
import { ai } from "@warlock.js/ai";

const model = ai.vcr(liveModel, {
  path: "./cassettes/support.json", // cassette file (JSON)
  mode: "auto",                     // "record" | "replay" | "auto". default "auto"
});

const agent = ai.agent({ model, tools, systemPrompt });

const result = await agent.execute("Where is my order?");
await model.save(); // flush newly recorded entries to `path`
```

`ai.vcr` returns a `VcrModel` — a `ModelContract` plus `save()` and a readable `cassette` for assertions. Drop it in anywhere a model goes.

## Modes

| `mode` | behaviour |
| --- | --- |
| `"record"` | **Always** calls the inner model and appends a cassette entry. Never replays. Use to (re)capture a fresh cassette. The in-memory cassette starts empty so a record run never accidentally replays a stale entry. |
| `"replay"` | **Never** calls the inner model. A cassette hit returns the stored response / chunks / error; a miss throws `VcrCassetteMissError` — never a silent live call. Use in CI. |
| `"auto"` (default) | Replay on a hit, record on a miss. The friendliest mode for local dev: records once, replays thereafter. |

### The typical workflow

1. Write the test against a real model with `mode: "auto"`. Run it once with API keys present — every call records.
2. Commit the cassette JSON alongside the test.
3. CI runs with `mode: "replay"` and **no keys** — every call replays from the cassette, deterministically and for free. A new or changed call (a cassette miss) fails the build with a clear error telling you to re-record.

```ts
const mode = process.env.CI ? "replay" : "auto";
const model = ai.vcr(liveModel, { path: "./cassettes/support.json", mode });
```

## How matching works

On each call VCR computes a stable hash over `{ messages, picked options }` and looks for a matching entry. The hashed option fields default to `["temperature", "maxTokens", "responseSchema", "tools", "reasoning"]` — override with `hashOptions`. `signal` and unknown provider keys are **always excluded**, so an otherwise-identical logical call still matches across runs. `tools` are hashed by name + description + input-schema shape, not object identity, so re-constructing the same tool doesn't bust the cassette.

```ts
ai.vcr(model, {
  path: "./cassettes/strict.json",
  hashOptions: ["temperature", "responseSchema"], // narrow the match key
});
```

Streaming is handled too: on replay the stored `chunks` are re-yielded in order (reproducing the `delta` / `tool-call` / `done` sequence); on record the inner stream is buffered while being re-emitted, then recorded once exhausted.

## Cassette format

A cassette is plain JSON — readable in a diff. It stores the **verbatim** request (`messages`, `options`) and response, so before committing one, treat it like a fixture that may contain sensitive data: prompts, tool arguments, system prompts, model output, and any PII or proprietary context flow into it unredacted. Commit cassettes only after you've confirmed (or sanitized) that they carry no secrets or PII — a redaction hook is on the roadmap.

```jsonc
{
  "version": 1,
  "model": "gpt-4o-mini",
  "provider": "openai",
  "entries": [
    {
      "requestHash": "a1b2c3…",
      "request": { "messages": [/* … sent verbatim … */], "options": { "temperature": 0 } },
      "response": { /* a non-streaming reply */ }
    }
  ]
}
```

Exactly one of `response` / `chunks` / `error` is populated per entry, mirroring the three outcomes of a model call. The `request` is stored verbatim — human-readable, and so the cassette can be re-hashed if the hashing format ever changes. A recorded provider error is replayed by re-throwing a reconstructed `Error` with the same `name` and `message`.

## `save()` — flush new entries

`save()` writes newly recorded entries to `path`. It's a **no-op when nothing was recorded** — pure replay, or a record/auto run that only ever hit cached entries, never dirties the file. Call it after your test body (e.g. in an `afterEach`/`afterAll`) so fresh recordings persist:

```ts
afterAll(async () => {
  await model.save();
});
```

## `VcrCassetteMissError` — deterministic by design

In `replay` mode a miss throws `VcrCassetteMissError` rather than falling back to a live call — that fallback would silently re-introduce network and non-determinism into a test that asked for the opposite. The error carries the looked-up `requestHash` and the cassette `path` so a red CI run names exactly which call was not recorded:

```ts
import { VcrCassetteMissError } from "@warlock.js/ai";

try {
  await vcrModel.complete(messages);
} catch (error) {
  if (error instanceof VcrCassetteMissError) {
    console.error(`Re-record the cassette: ${error.path} (hash ${error.requestHash})`);
  }
}
```

It extends `AIError` directly (not `ProviderError`) — a cassette miss is a harness/config failure, not a provider failure. The fix is to re-run once in `record` / `auto` mode to capture the new call.

## When to reach for VCR vs. mocking

- Use **`ai.vcr`** when you want a test to exercise the **real model's actual output** (real tool-call shapes, real structured output) but run it deterministically and offline thereafter — integration-flavoured tests, and the live half of an [eval suite](./evaluation-and-datasets) you want repeatable.
- Use `MockSDK` / `ai.mockRouter` / `mockAgent` (see [Testing and evals](./testing-and-evals)) for pure **wiring** tests — routing, step order, convergence — where you never want a real call at all and can assert against fabricated responses.

VCR and mocks are complementary: mocks for the deterministic-by-construction wiring layer, VCR for the "real output, captured once" layer.

## Related

- [Evaluation and datasets](./evaluation-and-datasets) — make the live eval suite repeatable by replaying its model calls.
- [Testing and evals](./testing-and-evals) — the wiring-vs-quality split and the mocking primitives VCR complements.
- [Resilience and error handling](./resilience) — `ai.fallbackModel`, which VCR composes below.
