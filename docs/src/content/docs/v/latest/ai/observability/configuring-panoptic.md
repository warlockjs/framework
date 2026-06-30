---
title: "Configuring Panoptic"
description: Wire Panoptic declaratively through ai.config({ panoptic }) — exporters, observeAll, the per-flow observe option on every primitive, idempotent side-effect registration, and how it relates to the imperative panoptic() API.
sidebar:
  order: 3
  label: "Configuring Panoptic"
---

There are two ways to turn Panoptic on. The [imperative `panoptic()` API](./ai-panoptic) hands you a subscriber you `attach()` / `collect()` yourself — full control, explicit wiring. This page covers the **declarative** path: set `ai.config({ panoptic: { … } })` once and let a side-effect import register the collector onto core's observe seam for you. App code never hand-wires a store, a collector, or a subscriber.

Both paths drive the **same** collection pipeline. The declarative config is sugar layered over the `panoptic()` factory — it builds the same collector and the same exporters. Reach for it when you want "observe everything, ship it to these sinks, maybe open a dashboard" with zero plumbing; reach for the imperative API when you need to attach to a specific primitive instance or collect a report out of band (an orchestrator turn).

## The declarative path

Two imports and one config call:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic"; // side-effect wiring — see below
import { createInMemoryTraceStore, consoleExporter } from "@warlock.js/ai-panoptic";

ai.config({
  panoptic: {
    exporters: [createInMemoryTraceStore({ capacity: 5000 }), consoleExporter()],
    observeAll: true,
    dashboard: { port: 4319, open: true },
  },
});
```

That is the whole setup. From here, every `ai.agent` / `ai.workflow` / `ai.supervisor` / `ai.team` run is collected and fanned out to the listed exporters, and (because `dashboard` is set) a local UI is serving over the store. No `attach()`, no `collect()`, no subscriber variable to thread through your code.

### The `PanopticConfig` shape

The `panoptic` slot on `ai.config` accepts:

```ts
type PanopticConfig = {
  exporters?: ExporterContract[];        // sinks the collector feeds
  cache?: CacheDriverInput;              // persist traces across restarts
  dashboard?: boolean | DashboardOptions; // serve the local dashboard
  observeAll?: boolean;                  // observe every flow by default
};
```

| Field | Default | Meaning |
| --- | --- | --- |
| `exporters` | `[]` | The sinks the collector fans each trace out to — a store, `consoleExporter()`, `otelExporter()`, `langfuseExporter()`, … Exactly the array you'd pass to `panoptic({ exporters })`. |
| `cache` | _unset_ | A `@warlock.js/cache` `CacheDriver` (or a `() => CacheDriver \| Promise<CacheDriver>` factory) that backs a [persistent trace store](./querying-traces#persisting-traces-across-restarts). When set — and no store-shaped exporter was supplied — the dashboard reads a cache-backed store that **survives a process restart** instead of a fresh in-memory one. |
| `observeAll` | `false` | When `true`, every flow is observed unless it opts out. When `false`, only flows that set `observe: true` (or a flow-local observer) are collected. |
| `dashboard` | _unset_ | `true` uses the [dashboard defaults](./local-dashboard); an object overrides them. See [the local dashboard](./local-dashboard) for the full option set. |

### Persisting traces across a restart

By default the dashboard reads an in-memory store that's wiped on process exit. Set `cache` to a `@warlock.js/cache` `CacheDriver` and panoptic backs the dashboard with a [cache-persistent store](./querying-traces#persisting-traces-across-restarts) instead — traces are written through to the cache and **re-hydrated on the next boot**, so a restart no longer loses your trace history:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";

ai.config({
  panoptic: {
    observeAll: true,
    dashboard: { port: 4319, open: true },
    cache: () => ai.config().cache!,   // any CacheDriver, or an async factory
  },
});
```

`cache` accepts a driver instance or a (possibly async) `() => CacheDriver | Promise<CacheDriver>` factory, resolved lazily on first use — so production can defer the Redis connect, and the dashboard wires up without a live connection at import time. Panoptic awaits the store's hydration before the server starts serving. If you pass your own store-shaped exporter in `exporters`, that one wins and `cache` is ignored; with neither, panoptic falls back to the in-memory store, so the dashboard always works.

## How the side-effect import wires it

`ai.config()` only **stores** the `panoptic` slot — core knows nothing about Panoptic and never imports it. The actual wiring lives in `@warlock.js/ai-panoptic`'s side-effect import. A bare:

```ts
import "@warlock.js/ai-panoptic";
```

subscribes Panoptic to core's config seam (`onConfigApplied`). Any export from the package pulls this in transitively, so importing `createInMemoryTraceStore` (or anything else) already activates it — the bare import above is only needed when you reference nothing else from the package.

When config is applied, Panoptic:

1. Builds a collector via the existing `panoptic({ exporters })` factory — the same pipeline the imperative API uses.
2. Registers that collector once as a core `Observer` (via core's `registerObserver`). The subscriber's `collect(report)` structurally **is** an `Observer`.
3. Sets the global observe-all flag from `observeAll`.
4. When `dashboard` is set, resolves the store the dashboard reads — a store-shaped exporter you supplied, else a `cache`-backed persistent store, else a fresh in-memory one — **awaits its hydration** (a cache store re-loads prior traces; an in-memory store resolves instantly), then starts the dashboard over it.

The import also catches config that was applied **before** the import ran — if your app called `ai.config({ panoptic })` and only then imported the package, the slot is read on import and wired anyway. Order doesn't matter.

### Idempotency

`ai.config()` merges, and it can be called many times. Panoptic's apply step is **idempotent**:

- The collector is registered as a core observer **exactly once** — repeat config calls never double-register, so a trace never reaches an exporter twice.
- The dashboard is started **at most once**.
- Only `observeAll` is refreshed on a repeat call — the latest config wins for the flag, but the collector and dashboard are untouched.

So calling `ai.config({ panoptic: { observeAll: false } })` later flips observe-all off without tearing down the collector or the dashboard.

## Choosing what gets observed

`observeAll` is the global default; each flow can override it through the `observe` option it carries. The option exists on **all four** executable primitives — `ai.agent`, `ai.workflow`, `ai.supervisor`, and `ai.team` — with identical semantics:

```ts
type FlowObserveOption = boolean | Observer;
```

| `observe` value | Effect |
| --- | --- |
| _omitted_ | Follow the global `observeAll` flag. |
| `true` | Always route this flow's completed report to the registered observers — **even when `observeAll` is off**. |
| `false` | Opt this flow out entirely — **even when `observeAll` is on**. |
| an `Observer` object | A flow-local collector: only this flow's report is routed, and only to that observer (the global ones are skipped). |

### Pattern A — opt-in (observeAll off, default)

Leave `observeAll` unset and tag only the flows you care about. Everything else stays silent.

```ts
ai.config({ panoptic: { exporters: [store] } }); // observeAll defaults to false

const audited = ai.agent({ model, observe: true });    // collected
const noisy = ai.agent({ model });                     // not collected
```

### Pattern B — observe-all with surgical opt-outs

Flip `observeAll` on and silence the chatty flows.

```ts
ai.config({ panoptic: { exporters: [store], observeAll: true } });

const main = ai.agent({ model });                    // collected (observeAll)
const healthCheck = ai.agent({ model, observe: false }); // explicitly excluded
```

### Pattern C — a flow-local collector

Pass an `Observer` to route one flow to its own sink, bypassing the global observers entirely. A Panoptic subscriber is an `Observer`, so a `panoptic({...})` instance can be handed straight in:

```ts
const local = panoptic({ exporters: [fileExporter({ path: "./this-flow.jsonl" })] });

const isolated = ai.agent({
  model,
  observe: local, // only this flow, only this exporter
});
```

> Observer errors are **isolated** — a throwing exporter never breaks the run — but not silently swallowed: core surfaces a warn-once log per observer so a broken sink stays visible.

## The imperative API still works

Declarative config does not replace `panoptic()` — it sits on top of it. Everything on the [overview page](./ai-panoptic) is intact:

```ts
const observe = panoptic({ exporters: [consoleExporter()] });

observe.attach(myAgent);                 // subscribe to one primitive's events
observe.middleware();                    // feed via the middleware pipeline
await observe.collect(result.report);    // feed a report directly (orchestrator turns)
```

The two coexist. Use declarative config for the broad "observe my whole app" stroke, and the imperative `attach()` / `collect()` for the cases the global seam can't cover — most notably an **orchestrator turn**, whose completed event carries only session identity and no result-bearing report. That still needs an explicit `collect()`; see the orchestrator-turn section of [What Panoptic traces](./what-panoptic-traces).

## Gotchas

- **The side-effect import is mandatory.** `ai.config({ panoptic })` alone does nothing — core just stores an opaque slot. You must import `@warlock.js/ai-panoptic` somewhere (a bare `import "@warlock.js/ai-panoptic"`, or any named import from it) for the wiring to activate.
- **`observeAll: false` is the default** — declaring `exporters` without `observeAll` or per-flow `observe: true` captures nothing. This is deliberate: observability is opt-in.
- **The dashboard needs a queryable store.** If you set `dashboard` but pass no store among `exporters`, Panoptic creates an in-memory store and registers it for you. If you do pass one, it's reused — see [the local dashboard](./local-dashboard).
- **One collector, one registration.** Because apply is idempotent, you can't register two different declarative collectors by calling `ai.config({ panoptic })` twice with different exporters — the first wins. Use the imperative `panoptic()` API (or a flow-local `observe` collector) when you genuinely need a second, independent pipeline.

## Related

- [@warlock.js/ai-panoptic](./ai-panoptic) — the package overview and the imperative `panoptic()` entry point.
- [The local dashboard](./local-dashboard) — the zero-setup UI the `dashboard` option starts.
- [Querying traces](./querying-traces) — the in-memory store you register as an exporter, then `query()` / `aggregate()`.
- [What Panoptic traces](./what-panoptic-traces) — the `Trace` / `TraceSpan` shape every exporter receives.
