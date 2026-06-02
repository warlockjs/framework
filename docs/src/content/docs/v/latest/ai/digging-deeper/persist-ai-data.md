---
title: "Persist AI data"
description: Snapshot resume for workflows and supervisors, semantic cache, drift detection. All delegated to @warlock.js/cache.
sidebar:
  order: 4
  label: "Persist AI data"
---

`@warlock.js/ai` owns no persistence primitives. Anything that needs durable state — workflow / supervisor snapshot resume, semantic cache, future memory — accepts a `CacheDriver` from `@warlock.js/cache`. The cache package ships memory, lru-memory, file, redis, and pg drivers; pg adds pgvector for similarity retrieval.

## The big picture

```text
┌──────────────┐        ┌─────────────────────────┐
│  ai.config   │  ───▶  │  @warlock.js/cache      │
│ defaultStore │        │  CacheDriver            │
└──────────────┘        │  (memory|redis|pg|...)  │
                        └────────────▲────────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
┌──────────────┐         ┌────────────────────┐         ┌──────────────────┐
│ supervisor   │         │   workflow         │         │  semanticCache   │
│ snapshotStore│         │  snapshotStore     │         │  store (vector)  │
└──────────────┘         └────────────────────┘         └──────────────────┘
```

## Resolution order

```text
options.store ?? ai.config({ defaultStore }) ?? undefined
```

When neither is set:

- **Snapshot consumers** silently skip writes and throw on `resume()`.
- **Semantic cache** throws at construction.

## `ai.config({ defaultStore })` — set once at boot

```ts
import { ai } from "@warlock.js/ai";
import { cache } from "@warlock.js/cache";

ai.config({
  defaultStore: cache.driver("redis", { client: redisClient }),
});
```

Every consumer that doesn't supply its own `store` / `snapshotStore` picks this up. Per-declaration overrides win.

## Picking a driver

| Driver | KV | TTL | Tags | `similar()` | Fits |
| --- | --- | --- | --- | --- | --- |
| `memory` / `lru-memory` | yes | yes | yes | yes (brute force) | Dev / tests |
| `file` | yes | yes | yes | no | Single-process persistence |
| `null` | no-op | no-op | no-op | `[]` | Test isolation |
| `redis` | yes | yes | yes | (RediSearch, separate phase) | Production KV + future similarity |
| `pg` | yes | yes | yes | yes (pgvector) | Production semantic cache |

Brute-force memory drivers carry an O(N) similarity scan — fine up to a few thousand entries, not beyond.

## Snapshot resume — workflow and supervisor

### Wiring

```ts
ai.config({ defaultStore: cache.driver("redis", { client }) });

const wf = ai.workflow({
  name: "ticket-processor",
  steps: [/* ... */],
  // snapshotStore optional — falls back to defaultStore
});

const sup = ai.supervisor({
  name: "support-team",
  router: routerAgent,
  intents: { triage, billing, resolver },
  snapshotStore: cache.driver("pg", { client: pgPool, table: "support_runs" }),
});
```

### Snapshot shapes

```ts
type WorkflowSnapshot = {
  runId: string;
  workflowName: string;
  signature: string;             // structural fingerprint
  version?: string;
  input: unknown;
  state: Record<string, unknown>;
  steps: Record<string, StepSnapshot>;
  next: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  savedAt: string;
};

type SupervisorSnapshot = {
  runId: string;
  supervisorName: string;
  signature: string;
  input: string;
  iteration: number;
  snapshots: IterationSnapshot[];
  status: "running" | "completed" | "failed" | "cancelled" | "max-iterations";
  startedAt: string;
  savedAt: string;
};
```

### Checkpoint rules

- Workflow: snapshot after every step settles. Parallel groups checkpoint atomically.
- Supervisor: snapshot after every iteration. Plus once on final completion / cancel / fail.
- Mid-step / mid-iteration crash resumes from the last completed checkpoint — partial work is NOT persisted.
- **Idempotency is your responsibility.** Steps and agents may re-run on resume.

## Fresh run vs resume

```ts
const result = await wf.execute({ input, runId: "ticket-123" });
const result = await wf.resume("ticket-123");

await sup.execute("urgent", { runId: "support-7" });
await sup.resume("support-7");
```

Resume reads the snapshot, rehydrates state, continues from the snapshot's `next`.

## Signature drift detection

`signature` is a structural fingerprint computed at construction. On `resume()`, the current signature is compared to the snapshot's. Mismatch throws `WorkflowDriftError` / `SupervisorDriftError` **without executing**:

```ts
{
  code: "WORKFLOW_DRIFT",
  savedSignature: "abc123…",
  currentSignature: "def456…",
  runId: "ticket-123",
  completedSteps: ["fetch", "extract"],
  pendingStep: "classify",
}
```

This is the framework refusing to silently corrupt your data when the shape changed underneath the snapshot.

## Recovery paths

Three choices:

### 1. Discard — safest when the shape genuinely changed

```ts
await store.remove("ticket-123");
await wf.execute({ input, runId: "ticket-123" });
```

### 2. Force resume — escape hatch for trivial edits you know are safe

```ts
await wf.resume("ticket-123", { force: true });
```

### 3. Manual migration — for changes you can mechanically translate

```ts
const snapshot = await store.get<WorkflowSnapshot>("ticket-123");
if (snapshot) {
  snapshot.steps.newName = snapshot.steps.oldName;
  delete snapshot.steps.oldName;
  snapshot.signature = wf.signature;
  await store.set("ticket-123", snapshot);
  await wf.resume("ticket-123");
}
```

## Semantic cache

```ts
ai.config({
  defaultStore: cache.driver("pg", {
    client: pgPool,
    vector: { dimensions: 1536, index: "hnsw" },
  }),
});

const myAgent = ai.agent({
  model,
  middleware: [
    ai.middleware.semanticCache({
      embedder: openai.embedder({ name: "text-embedding-3-small" }),
      threshold: 0.95,
      ttlMs: 60 * 60 * 1000,
    }),
  ],
});
```

The driver must support `similar()`. Without similarity → `CacheUnsupportedError`. See [Attach middleware](./attach-middleware).

## Related

- [Run workflow](./run-workflow) — `snapshotStore` and `resume()`.
- [Run supervisor](./run-supervisor) — same on supervisor.
- [Attach middleware](./attach-middleware) — `semanticCache` middleware.
- [Handle errors](./handle-errors) — drift errors.
