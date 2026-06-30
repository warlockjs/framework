---
title: "Troubleshooting"
description: Common @warlock.js/ai errors and their fixes — adapter construction, satellite side-effect imports, capability gating, cost truth, optional peers, dashboard auth, orchestrator drift.
sidebar:
  order: 5
  label: "Troubleshooting"
---

The errors you're most likely to hit first, and the one-line fix for each. Most are the framework failing *loud and early* on purpose — a boundary throw beats a silent mid-run surprise.

## `ai.openai.model is not a function` (or `ai.openai` is undefined)

There is no auto-registered `ai.openai` namespace. The provider adapter is a separate package you construct yourself:

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const agent = ai.agent({ model: openai.model({ name: "gpt-4o" }) });
```

Same shape for every adapter — `new AnthropicSDK(...)`, `new BedrockSDK(...)`, etc. See [Pick a provider](./03-pick-a-provider).

## `ai.tools` / `ai.workspace` / `ai.mcp` is undefined

Those verbs live in **satellite packages** and register onto the shared `ai` object only through a side-effect import. Import the package once (anywhere in your app) and they light up, fully typed:

```ts
import "@warlock.js/ai-tools";     // → ai.tools.*, ai.mcp(...)
import "@warlock.js/ai-workspace"; // → ai.workspace(...)
```

A bare `import` is enough; any named import from the package pulls the side effect in too. See [Use AI tools](../the-basics/use-ai-tools) and [Use a workspace](../digging-deeper/use-workspace).

## Passing `attachments` throws at the boundary

The agent gates image / audio / PDF attachments on the model's declared capability flags and throws **upfront** rather than dropping them at the wire layer. If you see a capability error, the model either doesn't support that modality or doesn't declare it. Use a capable model, or override the flag on the model call:

```ts
const model = openai.model({ name: "my-org/custom-finetune", vision: true });
```

The six flags are `structuredOutput`, `vision`, `reasoning`, `promptCaching`, `audio`, `pdf` — see [Pick a provider](./03-pick-a-provider).

## "`execute()` never throws" — but I got an exception

`execute()` funnels *runtime* failures (provider errors, guardrail trips, budget breaches, schema failures) into `result.error` as a typed `AIError`. Branch on it:

```ts
const { data, error } = await agent.execute(input);
if (error) {
  // typed AIError subclass — branch on error.code / error.category
}
```

An actual thrown exception means something earlier broke — a malformed config, a missing required option, or a bug in your own callback — not a model failure. See [Handle errors](../digging-deeper/handle-errors).

## `usage.cost` is `undefined`

Cost is computed only when the adapter has pricing. No pricing → `usage.cost` is `undefined` (honest absence over a false zero). Configure `pricing` on the SDK or per-model:

```ts
const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: { "gpt-4o-mini": { input: 0.15, output: 0.6 } }, // USD per 1M tokens
});
```

`usage.total` (tokens) is always present; only the per-channel `usage.cost` breakdown depends on pricing. See [Cost tracking](../recipes/cost-tracking).

## An "install this package" error at first use

Heavy SDKs and a few utility peers are **lazy optional peers** — the glue ships, the SDK doesn't. The first time you touch a feature that needs one, you get a curated message carrying the exact install command (e.g. `npm install @mozilla/readability jsdom` for `fetchUrl`'s text extraction, or the provider SDK for an adapter). Run the command it names — it's never a raw import-time stack trace.

## The Panoptic dashboard won't start off-loopback

By default the dashboard binds `127.0.0.1`. Binding a non-loopback `host` exposes raw prompt content, so it's **gated**: pass an `authToken` or `dashboard()` rejects at start.

```ts
ai.config({
  panoptic: { dashboard: { host: "0.0.0.0", authToken: process.env.PANOPTIC_TOKEN! } },
});
```

With a token set, every request needs `Authorization: Bearer <token>` and its `Host` is checked against `allowedHosts`. See [The local dashboard](../observability/local-dashboard).

## My model ignores the output schema

If the adapter declares native `structuredOutput`, the schema is enforced at the token level. If it doesn't, the framework falls back to a soft "respond in JSON only" system-prompt hint — looser, so a weak model can drift. Two checks: confirm the model declares `structuredOutput`, and make sure you didn't downgrade it by passing `responseFormat: "json_object"` or `"text"` on the model call (both flip strict structured output off).

## `OrchestratorDriftError` on resume

The orchestrator computes a structural signature from its definition and refuses to run a session whose stored signature no longer matches — the definition changed under a live session. If the change is safe, bypass the check:

```ts
await orchestrator.execute(message, { sessionId, history, force: true });
```

See [Run orchestrator](../digging-deeper/run-orchestrator) for the full recovery paths.

## Related

- [Pick a provider](./03-pick-a-provider) — adapter construction and capability flags.
- [Handle errors](../digging-deeper/handle-errors) — the `AIError` hierarchy and the `cause` chain.
- [API reference](../reference/api) — every public export grouped by primitive.
