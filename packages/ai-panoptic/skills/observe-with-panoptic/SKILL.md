---
name: observe-with-panoptic
description: 'Wire @warlock.js/ai-panoptic into an agent/workflow/supervisor/orchestrator — declaratively via `ai.config({ panoptic })` (registers panoptic on core''s Observer seam) or with the one-call `panoptic({ exporters })` subscriber. Triggers: `panoptic`, `Panoptic`, `PanopticOptions`, `PanopticConfig`, `ai.config({ panoptic })`, `observeAll`, per-flow `observe`, `FlowObserveOption`, `registerObserver`, `Observer`, `.attach`, `.middleware`, `.collect`, `.toTrace`, `observe.attach(agent)`, `panoptic().middleware()`, `completedEvents`, `middlewareName`; ''observe a warlock agent'', ''trace an agent run'', ''attach observability to a workflow/supervisor'', ''observe every flow by default'', ''add a tracing middleware'', ''collect an orchestrator turn report'', ''wire OTel/Langfuse into my agent''; typical import `import { ai } from "@warlock.js/ai"` + `import "@warlock.js/ai-panoptic"` (or `import { panoptic } from "@warlock.js/ai-panoptic"`). Skip: the zero-setup local dashboard — the `use-local-dashboard` topic; writing/choosing an exporter (the sink end) — the `export-traces` topic; the core report shape / running the agent itself — the `run-ai-agent` topic of the `warlock-js-ai` skill.'
---

# Observe a run with Panoptic — the one-call subscriber

There are two levels. **Declarative** (`ai.config({ panoptic })`) is the high-level path: panoptic registers itself on core's generic `Observer` seam and every observed flow routes its report in automatically — no per-target wiring. **Imperative** (`panoptic(...)`) is the underlying subscriber, with three explicit feed paths. The declarative path is sugar over the imperative one; both reuse the same collection pipeline.

## Declarative — `ai.config({ panoptic })` + the Observer seam

The simplest wiring. Importing `@warlock.js/ai-panoptic` (even bare, for side effects) subscribes panoptic to core's config seam; a later `ai.config({ panoptic })` then builds the collector and **registers it once on core's `Observer` registry** via `registerObserver`. Core itself never imports panoptic — it depends only on the structural `Observer` interface (`{ collect(report) }`), the dependency inversion that keeps the two sides decoupled.

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic"; // side-effect wiring — do this once at boot

ai.config({
  panoptic: {
    exporters: [consoleExporter()],   // optional; a store-shaped exporter also feeds the dashboard
    observeAll: true,                 // observe every flow by default
    dashboard: true,                  // optional local viewer — see use-local-dashboard
  },
});
```

`PanopticConfig`: `exporters?` (the collector's sinks), `observeAll?` (default `false`), `dashboard?` (`boolean | DashboardOptions`). Applying it is **idempotent** — the observer registers once, the dashboard starts at most once; repeat `ai.config(...)` merges only refresh `observeAll`.

### `observeAll` + per-flow `observe`

Once a collector is registered, which flows actually route to it is controlled by core's `observe` seam:

| Setting | Effect |
|---|---|
| `observeAll: true` (config) | Every `ai.agent` / `ai.workflow` / `ai.supervisor` / `ai.team` that left `observe` unset routes its completed report to the registered observers. |
| `observe: true` (per-flow) | Force-observe **this** flow even when `observeAll` is off → the globally registered observers. |
| `observe: false` (per-flow) | Opt **this** flow out entirely, even when `observeAll` is on. |
| `observe: <Observer>` (per-flow) | A **flow-local** collector — only this flow's report, routed only to it (the global observers are skipped). A panoptic flow-local collector implements `Observer`, so pass it directly. |
| (unset, `observeAll: false`) | Not observed — opt-in default, identical to legacy behavior. |

```ts
ai.agent({ model, observe: true });                       // always traced
ai.workflow({ name: "billing", steps, observe: true });   // always traced
ai.supervisor({ name: "triage", ..., observe: false });   // never traced, even under observeAll

const flowLocal = panoptic({ exporters: [fileExporter({ path: "billing.jsonl" })] });
ai.team({ name: "research", ..., observe: flowLocal });   // only this flow, only this collector
```

The flow awaits each observer's `collect`, and a throwing observer is **swallowed** — observability never breaks the run (mirrors `onUsage` / `onComplete`). `observe` lives on **all four** flow configs — `ai.agent`, `ai.workflow`, `ai.supervisor`, and `ai.team` (the agent additionally supports the imperative `attach()` / `middleware()` paths below).

## Imperative — `panoptic(...)`, the one-call subscriber

`panoptic(...)` builds a collector, registers your exporters on it, and hands back a subscriber with **three ways to feed traces** in. All three converge on the same collector, so each run reaches every exporter exactly once. Use it when you want explicit control, a flow-local collector, or to wire a target the declarative seam doesn't cover (the orchestrator).

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

> The store's full query / aggregate / capacity surface is its own skill — see the `query-traces` topic.

## See also

- The `use-local-dashboard` topic — the zero-setup local viewer the `ai.config({ panoptic: { dashboard } })` switch starts over the collector's store.
- The `export-traces` topic — the sink end: choosing/writing an exporter, the `gen_ai.*` / `warlock.*` attribute mapping.
- The `query-traces` topic — retaining traces in the queryable in-memory store and slicing them (`query` / `aggregate` / `capacity`).
- The `run-ai-agent` topic of the `warlock-js-ai` skill — running the agent and the `BaseReport` shape Panoptic consumes.
