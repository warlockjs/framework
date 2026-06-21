---
name: observe-with-panoptic
description: 'Wire @warlock.js/ai-panoptic into an agent/workflow/supervisor/orchestrator with the one-call `panoptic({ exporters })` subscriber. Triggers: `panoptic`, `Panoptic`, `PanopticOptions`, `.attach`, `.middleware`, `.collect`, `.toTrace`, `observe.attach(agent)`, `panoptic().middleware()`, `completedEvents`, `middlewareName`; ''observe a warlock agent'', ''trace an agent run'', ''attach observability to a workflow/supervisor'', ''add a tracing middleware'', ''collect an orchestrator turn report'', ''wire OTel/Langfuse into my agent''; typical import `import { panoptic } from "@warlock.js/ai-panoptic"`. Skip: writing/choosing an exporter (the sink end) — `@warlock.js/ai-panoptic/export-traces/SKILL.md`; the core report shape / running the agent itself — `@warlock.js/ai/run-ai-agent/SKILL.md`.'
---

# Observe a run with Panoptic — the one-call subscriber

`panoptic(...)` is the entry point. It builds a collector, registers your exporters on it, and hands back a subscriber with **three ways to feed traces** in. All three converge on the same collector, so each run reaches every exporter exactly once.

```ts
import { panoptic } from "@warlock.js/ai-panoptic";
import { consoleExporter, otelExporter } from "@warlock.js/ai-panoptic";

const observe = panoptic({
  exporters: [consoleExporter(), otelExporter({ tracerName: "my-app" })],
});
```

## Three feed paths

| Path | Use when | API |
|---|---|---|
| **Events** | You want every run captured automatically and the primitive emits a `*.completed` event (agent / workflow / supervisor). | `observe.attach(target)` |
| **Middleware** | The app already composes cross-cutting concerns through the agent middleware pipeline. | `panoptic().middleware()` |
| **Direct** | The primitive carries no result-bearing event (the orchestrator), or you captured a report out of band. | `observe.collect(report)` |

### 1. Attach to the event stream

`attach` subscribes to the terminal `*.completed` events and returns a **detach** function:

```ts
const agent = ai.agent({ model });
const detach = observe.attach(agent); // agent | workflow | supervisor

await agent.execute("Summarize this");

// ...later, on teardown:
detach();
await observe.shutdown();
```

By default Panoptic subscribes to `agent.completed`, `workflow.completed`, and `supervisor.completed` — the terminal events that carry the finalized `result.report`. These fire **once per run regardless of outcome** (the matching `*.error` fires first on failure, then `*.completed` still fires), so attaching captures completed, failed, and cancelled runs alike. Panoptic silently ignores the names a given target doesn't emit, so the same subscriber attaches to any of the three primitives.

Narrow or widen the surface with `completedEvents`:

```ts
panoptic({ exporters, completedEvents: ["agent.completed"] }); // agents only
```

### 2. Wire it as agent middleware

```ts
const observe = panoptic({ exporters: [langfuseExporter({ /* ... */ })] });

const agent = ai.agent({
  model,
  middleware: [observe.middleware()],
});
```

The middleware feeds the collector from the `execute`-level `after` (success) and `onError` (failure) hooks. It never returns a value, so it never mutates the agent's result. Register more than one Panoptic middleware on the same agent by passing a distinct `middlewareName`:

```ts
panoptic({ middlewareName: "panoptic-secondary" }).middleware();
```

### 3. Collect a report directly

The **orchestrator** emits `orchestrator.turn.*` events that carry only session identity — no result. Feed its report straight in:

```ts
const result = await orchestrator.execute(input, { sessionId });
await observe.collect(result.report);
```

`collect(report)` also covers any report captured out of band (e.g. replayed from a store).

## Failure isolation

An observability fault never escapes onto the AI run's hot path:

- The collector wraps every exporter invocation in `Promise.allSettled`, so a throwing exporter can't crash the run or block its siblings.
- The event handler and the middleware additionally swallow the `collect` rejection, so even a collector-level fault stays contained.

A broken backend degrades to *missing telemetry*, never a failed agent run.

## Lifecycle

```ts
await observe.flush();    // drain buffered exporters (between batches / checkpoints)
await observe.shutdown(); // flush + release every exporter (process teardown)
```

Call `shutdown()` on teardown so buffered exporters (`fileExporter` batches, the Langfuse client) send their last records before exit.

## Bring your own collector or store

The in-memory trace store doubles as an `ExporterContract`, so the simplest way to retain runs for later querying is to pass it as an exporter — it then receives every trace alongside your other sinks:

```ts
import { panoptic, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();        // an ExporterContract + queryable store
const observe = panoptic({ exporters: [store, consoleExporter()] });

// store now receives every trace — query/aggregate it later:
store.query({ status: "failed" });
store.aggregate({ sessionId });
```

Pass a pre-built `collector` instead when you want to share one collector across several subscribers (each subscriber's `attach` / `middleware` feeds the same exporters):

```ts
import { panoptic, createCollector } from "@warlock.js/ai-panoptic";

const collector = createCollector().use(store);
const observe = panoptic({ collector, exporters: [consoleExporter()] });
```

Add exporters after construction with `observe.use(exporter)` (chainable, deduped by `ExporterContract.name`). `observe.toTrace(report)` projects a report into a `Trace` **without** dispatching — handy for inspection or tests.

> The store's full query / aggregate / capacity surface is its own skill — see [`query-traces/SKILL.md`](@warlock.js/ai-panoptic/query-traces/SKILL.md).

## See also

- [`@warlock.js/ai-panoptic/export-traces/SKILL.md`](@warlock.js/ai-panoptic/export-traces/SKILL.md) — the sink end: choosing/writing an exporter, the `gen_ai.*` / `warlock.*` attribute mapping.
- [`@warlock.js/ai-panoptic/query-traces/SKILL.md`](@warlock.js/ai-panoptic/query-traces/SKILL.md) — retaining traces in the queryable in-memory store and slicing them (`query` / `aggregate` / `capacity`).
- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md) — running the agent and the `BaseReport` shape Panoptic consumes.
