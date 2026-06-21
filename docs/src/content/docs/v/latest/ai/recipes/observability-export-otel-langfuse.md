---
title: "Recipe — Export Panoptic traces to OTel & Langfuse"
description: Ship @warlock.js/ai-panoptic traces to OpenTelemetry (GenAI semantic conventions) and Langfuse with optional-peer install notes and clean teardown.
sidebar:
  order: 21
  label: "Observability — export OTel & Langfuse"
---

Your AI runs work in production, but they live in a silo: your platform team watches everything through an OpenTelemetry collector (Grafana Tempo, Honeycomb, Datadog — whatever's downstream), and your prompt-engineering team wants the same runs in Langfuse to inspect generations and score outputs. You don't want two instrumentation stacks. You want one `panoptic({ exporters })` call that fans every run out to both backends, mapped to each one's native vocabulary.

That's what the OTel and Langfuse exporters do. Both are factories returning an `ExporterContract`; both lazily import their SDK so it stays an **optional peer**; both nest the run's execution tree faithfully so the emitted spans match what actually ran.

## Install the optional peers

`@warlock.js/ai-panoptic` declares `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, and `langfuse` as **optional** peer dependencies — importing the package never pulls them in. Install only the backends you actually use:

```bash
# Base package
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-panoptic

# For the OTel exporter (the app owns SDK wiring):
yarn add @opentelemetry/api @opentelemetry/sdk-trace-base

# For the Langfuse exporter:
yarn add langfuse
```

A missing SDK surfaces as a curated *"install this"* error on first export — never a boot-time stack trace. So you can register the OTel exporter without `langfuse` installed, and vice versa.

## Wire the OpenTelemetry SDK (host app's job)

The exporter emits spans onto a `Tracer`; **it never owns a `TracerProvider`.** You configure `@opentelemetry/sdk-trace-base` (provider, span processors, an OTLP span exporter pointed at your collector) exactly as you would for any OTel instrumentation — that bootstrap is outside Panoptic and follows the OTel SDK's own docs for the version you installed.

Once the global provider is registered, Panoptic only needs a `Tracer`. You have two ways to give it one:

- Pass `tracerName` and let the exporter call `trace.getTracer(tracerName)` against the global provider.
- Or fetch the `Tracer` yourself with `@opentelemetry/api` and pass it as `tracer`.

```ts
import { trace } from "@opentelemetry/api";

// After your OTel SDK bootstrap has registered a global provider:
const tracer = trace.getTracer("release-notes-app");
```

## Register both exporters

```ts
import "./otel-setup"; // your OTel SDK bootstrap — registers the global provider

import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import {
  panoptic,
  otelExporter,
  langfuseExporter,
} from "@warlock.js/ai-panoptic";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const agent = ai.agent({
  name: "release-notes-writer",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You turn raw changelog lines into crisp release notes."),
});

const observe = panoptic({
  exporters: [
    // OTel: fetch a Tracer from the registered global provider by name.
    // `system` backfills gen_ai.system when a span didn't carry one.
    otelExporter({ tracerName: "release-notes-app", system: "openai" }),

    // Langfuse: pass credentials and the exporter builds a client lazily.
    langfuseExporter({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_HOST, // optional; defaults to the SDK default
    }),
  ],
});

const detach = observe.attach(agent);
```

## Run it — the same trace reaches both backends

```ts
const changelog = `
- add retry middleware to the http client
- fix race in the cache invalidation path
- bump node engines to >= 20
`;

const { data, error } = await agent.execute(changelog, {
  sessionId: "release-4.3.0",
});

if (error) {
  // The failed run is still exported — both backends receive a span tree
  // with ERROR status and the recorded exception.
  console.error(error.code, error.category);
} else {
  console.log(data);
}
```

## What lands in each backend

**OpenTelemetry** — each `TraceSpan` becomes one OTel span with the source start/end times and parent relationship reconstructed, so the emitted tree matches the original execution tree. Attributes follow the [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

- `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.usage.total_tokens`
- `gen_ai.usage.cached_tokens` / `gen_ai.usage.reasoning_tokens` (when the span reported them)
- `gen_ai.conversation.id` (from the span's `sessionId`)
- `gen_ai.system` / `gen_ai.request.model` / `gen_ai.operation.name` — emitted only when the span actually carried that key; `otelExporter`'s `system` option backfills `gen_ai.system` when the span supplied none
- `warlock.report.type` / `warlock.version` / `warlock.duration_ms` / `warlock.cost.usd`, plus every scalar entry of the span's own attribute bag (`agent.model.name`, `agent.trips`, …)

Failed / cancelled spans get OTel `ERROR` status plus a recorded exception.

**Langfuse** — the root span becomes a Langfuse **trace**; a token-producing span (`usage.total > 0`) becomes a **generation** carrying `usage`, and a pure tool/callback becomes a plain **span**. Children nest under their parent observation; timing, `version`, and status (failed → `ERROR` level) are mapped.

## Reuse a client you already built

If your app already constructs a Langfuse client (or a custom `Tracer`), hand it in instead of credentials — the exporter then never imports the SDK itself:

```ts
import { Langfuse } from "langfuse";
import { trace } from "@opentelemetry/api";

const langfuse = new Langfuse({ /* ... */ });

panoptic({
  exporters: [
    otelExporter({ tracer: trace.getTracer("my-app") }),
    langfuseExporter({ client: langfuse }),
  ],
});
```

## Teardown — flush before exit

The Langfuse client and any batching exporter hold buffered observations. Call `shutdown()` on teardown so they send their last records; `flush()` drains between batches without releasing the exporters.

```ts
// between batches / at a checkpoint:
await observe.flush();

// on process teardown:
detach();
await observe.shutdown(); // flush + release every exporter
```

## Production notes

- **OTel SDK ownership stays with the app.** Panoptic emits onto a `Tracer` and nothing more — provider, processors, and the OTLP span exporter are your existing instrumentation, so AI spans land in the same pipeline (and the same backend) as the rest of your service.
- **One throwing backend can't take down the others.** The collector isolates each exporter in `Promise.allSettled`; a Langfuse outage degrades to missing Langfuse data while OTel keeps flowing, and neither can crash the agent run.
- **`gen_ai.*` model/system/operation keys are never invented.** They appear only when the span already carried that exact key (the `system` option is the one allowed backfill, and it never overrides a value the span supplied). If a backend dashboard shows an empty `gen_ai.request.model`, the source span didn't populate it — fix it at the collector, not the exporter.
- **Add a retention sink alongside the wire exporters.** Register an in-memory store (or a custom `TraceStoreContract`) in the same `exporters` array to keep runs queryable locally even while they ship out — see [wire Panoptic](./observability-wire-panoptic).

## Related

- [Observability — wire Panoptic](./observability-wire-panoptic) — attach the subscriber and retain traces in the in-memory store.
- [Observability — trace cost dashboard](./observability-trace-cost-dashboard) — per-run cost and latency from the collector.
- [Cost tracking](./cost-tracking) — the `usage.cost` breakdown the exporters map to `warlock.cost.usd` / Langfuse usage.
