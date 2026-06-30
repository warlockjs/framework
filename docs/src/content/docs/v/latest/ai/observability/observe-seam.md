---
title: "The Observer seam"
description: The core observability hook — a per-flow observe option, a tiny global Observer registry, and AgentConfig.captureMessages, all decoupled from any observability tool.
sidebar:
  order: 0
  label: "The Observer seam"
---

Core defines a structural `Observer` and a tiny registry; it **never imports any observability package** (panoptic, OTel, Langfuse, …). A flow that resolves to "observed" hands its completed `ExecutionReport` to every registered observer. An observability tool **implements `Observer` and registers itself**, so `observe: true` / observe-all route reports without coupling core to the tool — the dependency inversion that keeps the two sides decoupled.

```ts
export interface Observer {
  collect(report: ExecutionReport): void | Promise<void>;
}
```

`collect` may be sync or async — the flow awaits it. A throw is **isolated** by the flow — it never breaks the run — but it is **not silently swallowed**: the framework surfaces it with a warn-once log per observer, so a broken collector stays visible instead of failing dark. `ExecutionReport` is the shared base report shape every primitive produces — the same `report` you get back on `result.report`.

> [`@warlock.js/ai-panoptic`](./ai-panoptic) is the batteries-included `Observer`: register it once and every observed flow's report tree is projected into traces and fanned out to OTEL, Langfuse, the console, a file, or a queryable store. This page is the **core seam** panoptic plugs into; you only need it directly when wiring a custom collector.

## Per-flow `observe` option

`observe?: boolean | Observer` (`FlowObserveOption`) is accepted on **`ai.agent`, `ai.workflow`, `ai.supervisor`, and `ai.team`** (a team forwards it verbatim to the supervisor it desugars into):

```ts
const collector: Observer = { collect(report) { exporter.send(report); } };

ai.agent({ model, observe: true });       // → the globally registered observers, even if observe-all is off
ai.agent({ model, observe: false });      // → opt out entirely, even when observe-all is on
ai.agent({ model, observe: collector });  // → a flow-LOCAL collector; only this flow's report, only to it
ai.agent({ model });                      // → undefined: follow the global observe-all flag
```

Resolution (`resolveObservers(observe)`):

| value | observers notified |
| --- | --- |
| `false` | `[]` — opted out |
| `true` | the globally registered observers |
| an `Observer` object | just that one (flow-local; globals skipped) |
| `undefined` | the global observers when observe-all is on **and this is a root (non-nested) run**, otherwise `[]` |

The object form is typed as the structural `Observer` — **not** a panoptic-specific options type — so a panoptic flow-local collector (which implements `Observer`) can be passed straight in, and core stays panoptic-agnostic.

## The global registry

```ts
import {
  registerObserver, getObservers, setObserveAll, isObserveAll, clearObservers,
} from "@warlock.js/ai";

registerObserver(collector);  // an observability tool registers ONE collector when its config is applied
getObservers();               // read-only snapshot of the registered observers (do not mutate)

setObserveAll(true);          // "observe every flow by default" — flows without their own `observe` get observed
isObserveAll();               // read the flag (default false — opt-in observability)

clearObservers();             // test-only: reset observers + the observe-all flag for spec isolation
```

`observeAll` defaults to `false` (opt-in). A flow that never sets `observe` is observed **only** when observe-all is on; individual flows still opt out with `observe: false`. At completion a flow calls `notifyObservers(observe, report)`, which routes the report to each resolved observer, awaiting each `collect` (so async exporters finish before the flow returns) and **isolating** any throw — a failing observer never breaks the run, and the framework surfaces it with a warn-once log per observer rather than swallowing it silently.

```ts
// Register once at boot, then let observe-all carry every flow:
registerObserver(myCollector);
setObserveAll(true);

await ai.agent({ model }).execute("Go");          // observed (observe-all on, no per-flow opt-out)
await ai.agent({ model, observe: false }).execute("…"); // skipped, even with observe-all on
```

## Full-history capture — `captureMessages` → `AgentReport.messages`

Off by default. When `ai.agent({ captureMessages: true })` is set, the agent normalizes the real assembled turn array onto `AgentReport.messages` as a `CapturedMessage[]`:

```ts
const { report } = await ai.agent({ model, tools, captureMessages: true }).execute("Go");

report.messages; // CapturedMessage[] — every role (system/user/assistant/tool), every trip
```

A `CapturedMessage` is a JSON-safe projection:

```ts
type CapturedMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;                  // always a string — tool results stringified
  toolCalls?: ModelToolCallRequest[]; // only on assistant turns that triggered tools
  toolCallId?: string;              // only on tool-result turns
};
```

Unlike `trips[].input` — which stubs non-first trips with `"[tool results]"` — this preserves the **real** turn array. Omitted ⇒ the field is **absent** and the report is byte-for-byte as before. It's opt-in because full messages can be large and sensitive (whole prompts, tool inputs/outputs) — and it is what panoptic needs for **full-history capture**.

## A minimal custom collector

If you don't want the full panoptic stack, the seam alone is enough to ship reports anywhere:

```ts
import { ai, registerObserver, type Observer } from "@warlock.js/ai";

const jsonlSink: Observer = {
  async collect(report) {
    await appendFile("./runs.jsonl", JSON.stringify({
      type: report.type,
      status: report.status,
      duration: report.duration,
      usage: report.usage,
    }) + "\n");
  },
};

registerObserver(jsonlSink);

await ai.agent({ model, observe: true, captureMessages: true }).execute("Summarize this.");
```

For trace projection, span trees, cost rollups, and backend exporters, reach for [`@warlock.js/ai-panoptic`](./ai-panoptic) rather than hand-rolling — it implements `Observer` and registers itself for you.

## Related

- [@warlock.js/ai-panoptic](./ai-panoptic) — the batteries-included `Observer` that turns these reports into traces and exports.
- [What Panoptic traces](./what-panoptic-traces) — the span model panoptic projects the report tree into.
- [Querying traces](./querying-traces) — retain and query completed traces in memory.
- [Run agent](../the-basics/run-agent) — the `report` shape (`trips`, `children`, `status`, `usage`) observers receive.
