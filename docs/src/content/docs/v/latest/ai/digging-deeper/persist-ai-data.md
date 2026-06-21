---
title: "Persist AI data"
description: Snapshot resume for workflows and supervisors, semantic cache, drift detection. All delegated to @warlock.js/cache.
sidebar:
  order: 5
  label: "Persist AI data"
---

`@warlock.js/ai` owns no persistence primitives. Anything that needs durable state delegates it. As of 4.3.0 there are **two distinct persistence surfaces**, and keeping them straight matters:

- **Snapshot / checkpoint resume** — workflow + supervisor + orchestrator run state goes through the dedicated `SnapshotStore` / `CheckpointStore` contracts, constructed with `ai.snapshot.{memory,pg,redis}()` and `ai.checkpoint.{memory,pg,redis}()`.
- **Cache-backed features** — the `semanticCache` middleware (and `ai.memory()`'s semantic tier) accept a `CacheDriver` from `@warlock.js/cache`. The cache package ships memory, lru-memory, file, redis, and pg drivers; pg adds pgvector for similarity retrieval.

:::caution[⚠ BREAKING in 4.3.0 — snapshot persistence moved off `CacheDriver`]
Before 4.3.0, `snapshotStore` accepted a `CacheDriver` and snapshot resume fell back to `ai.config({ defaultStore })`. That is no longer true. `SupervisorConfig.snapshotStore` and `WorkflowConfig.snapshotStore` are now typed `SnapshotStore`, and the snapshot fallback is `ai.config({ defaultSnapshotStore })`. `ai.config({ defaultStore })` now serves the semantic-cache vector store **only**.

**Migration:**

```diff
- snapshotStore: cache.driver("redis", { client })
+ snapshotStore: ai.snapshot.redis({ client })

- ai.config({ defaultStore: cache.driver("redis", { client }) })  // for snapshot resume
+ ai.config({ defaultSnapshotStore: ai.snapshot.redis({ client }) })
```

Semantic-cache `defaultStore` wiring is unaffected.
:::

## The big picture

```text
┌────────────────────────┐      ┌──────────────────────────────────┐
│  ai.config             │      │  snapshot / checkpoint stores    │
│  defaultSnapshotStore  │ ───▶ │  ai.snapshot.{memory,pg,redis}() │
│  defaultCheckpointStore│      │  ai.checkpoint.{...}()           │
└────────────────────────┘      └──────────────┬───────────────────┘
                                                │
       ┌────────────────────┬───────────────────┴──────────────┐
┌──────────────┐  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐
│ supervisor   │  │   workflow     │  │ orchestrator   │  │ orchestrator │
│ snapshotStore│  │  snapshotStore │  │ snapshotStore  │  │ checkpointStore
└──────────────┘  └────────────────┘  └────────────────┘  └──────────────┘

┌────────────────┐      ┌─────────────────────────┐
│  ai.config     │ ───▶ │  @warlock.js/cache      │   ◀── semanticCache + memory
│  defaultStore  │      │  CacheDriver            │       (vector store ONLY)
└────────────────┘      └─────────────────────────┘
```

## Resolution order

```text
// snapshot / checkpoint
options.snapshotStore   ?? ai.config({ defaultSnapshotStore })   ?? undefined
options.checkpointStore ?? ai.config({ defaultCheckpointStore }) ?? undefined

// cache-backed (semanticCache, memory semantic tier)
options.store ?? ai.config({ defaultStore }) ?? undefined
```

When neither is set:

- **Snapshot / checkpoint consumers** silently skip writes and throw on `resume()`.
- **Semantic cache** throws at construction.

## Set defaults once at boot

```ts
import { ai } from "@warlock.js/ai";
import { cache } from "@warlock.js/cache";

ai.config({
  defaultSnapshotStore: ai.snapshot.redis({ client: redisClient }),    // workflow/supervisor/orchestrator resume
  defaultCheckpointStore: ai.checkpoint.redis({ client: redisClient }), // orchestrator session state
  defaultStore: cache.driver("pg", { client: pgPool }),                 // semanticCache + memory vector store
});
```

Every consumer that doesn't supply its own store picks the matching default up. Per-declaration overrides win.

## Picking a tier

Each store factory ships three tiers, mirroring the cache drivers:

| Tier | Constructor | Durability | Fits |
| --- | --- | --- | --- |
| `memory` | `ai.snapshot.memory()` / `ai.checkpoint.memory()` | Process-local `Map`, volatile | Dev / tests / single-process |
| `redis` | `ai.snapshot.redis({ client })` / `ai.checkpoint.redis({ client })` | Durable, cross-process | Production |
| `pg` | `ai.snapshot.pg({ client })` / `ai.checkpoint.pg({ client })` | Durable, cross-process | Production |

You pass your own `pg` / `redis` client in — `@warlock.js/ai` takes no peer dependency on either; the same pool can back both the cache and these stores. **Schema is never auto-migrated** — each store exposes `.schema()`, a DDL string you run through your own migration tool.

For the semantic-cache and memory vector store, pick a `@warlock.js/cache` driver instead:

| Driver | `similar()` | Fits |
| --- | --- | --- |
| `memory` / `lru-memory` | yes (brute force, O(N)) | Dev / tests |
| `pg` | yes (pgvector) | Production semantic cache / memory |
| `redis` | RediSearch (separate phase) | Production KV |

## Snapshot resume — workflow and supervisor

### Wiring

```ts
ai.config({ defaultSnapshotStore: ai.snapshot.redis({ client }) });

const wf = ai.workflow({
  name: "ticket-processor",
  steps: [/* ... */],
  // snapshotStore optional — falls back to defaultSnapshotStore
});

const sup = ai.supervisor({
  name: "support-team",
  router: routerAgent,
  intents: { triage, billing, resolver },
  snapshotStore: ai.snapshot.pg({ client: pgPool }),
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

The `SnapshotStore` contract is `load(runId)` / `save(snapshot)` / `delete(runId)` / `list?(prefix?)` — not the cache driver's `get` / `set` / `remove`. Three recovery choices:

### 1. Discard — safest when the shape genuinely changed

```ts
await store.delete("ticket-123");
await wf.execute({ input, runId: "ticket-123" });
```

### 2. Force resume — escape hatch for trivial edits you know are safe

```ts
await wf.resume("ticket-123", { force: true });
```

### 3. Manual migration — for changes you can mechanically translate

```ts
const snapshot = await store.load("ticket-123");
if (snapshot) {
  snapshot.steps.newName = snapshot.steps.oldName;
  delete snapshot.steps.oldName;
  snapshot.signature = wf.signature;
  await store.save(snapshot);   // key is derived from snapshot.runId
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

The driver must support `similar()`. Without similarity → `CacheUnsupportedError`. The `defaultStore` here is the **cache driver** — distinct from `defaultSnapshotStore`. See [Attach middleware](./attach-middleware).

## Orchestrator persistence

The orchestrator adds a second store — a `CheckpointStore` for cross-turn **session state** — alongside the `SnapshotStore` (which it uses, like the supervisor, for `iterate: true` mid-turn resume):

```ts
const supportBot = ai.orchestrator({
  name: "refund-support",
  intents, route,
  iterate: true,
  checkpointStore: ai.checkpoint.pg({ client: pgPool }),   // session state, one row per turn
  snapshotStore: ai.snapshot.pg({ client: pgPool }),       // mid-turn supervisor run
});
```

The `CheckpointStore` is append-only (`load` / `save` / `delete` / `list?`), keyed by `(orchestrator_name, session_id, turn_index)`. See [Run orchestrator](./run-orchestrator) for the full session lifecycle and boot-drain pattern.

## Related

- [Run workflow](./run-workflow) — `snapshotStore` and `resume()`.
- [Run supervisor](./run-supervisor) — same on supervisor.
- [Run orchestrator](./run-orchestrator) — checkpoint + snapshot stores, session state.
- [Attach middleware](./attach-middleware) — `semanticCache` middleware.
- [Handle errors](./handle-errors) — drift errors.
