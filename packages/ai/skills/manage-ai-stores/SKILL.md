---
name: manage-ai-stores
description: 'Durable orchestrator stores — ai.checkpoint.{memory,pg,redis}() for cross-turn SESSION STATE and ai.snapshot.{memory,pg,redis,file,sqlite}() for in-flight SUPERVISOR/WORKFLOW/agent run state (and ai.session conversations). Two distinct contracts (CheckpointStore vs SnapshotStore), dev-owned pg/redis clients (no peer dep), never-auto-migrated schema(), global defaults via ai.config({defaultCheckpointStore, defaultSnapshotStore}). Triggers: `ai.checkpoint`, `ai.snapshot`, `checkpointStore`, `snapshotStore`, `CheckpointStore`, `SnapshotStore`, `CheckpointRecord`, `checkpoint.pg`, `checkpoint.redis`, `snapshot.pg`, `snapshot.redis`, `snapshot.file`, `snapshot.sqlite`, `node:sqlite`, `better-sqlite3`, `store.schema()`, `keepSnapshots`, `defaultCheckpointStore`, `defaultSnapshotStore`, `PgClientLike`, `RedisClientLike`; ''persist orchestrator sessions'', ''wire a pg checkpoint store'', ''run the store DDL'', ''checkpoint vs snapshot''; typical import `import { ai } from "@warlock.js/ai"`. Skip: orchestrator lifecycle — the `run-orchestrator` topic; cache-backed snapshot resume / semanticCache store — the `persist-ai-data` topic; competing libs `temporal`, `inngest`.'
---

# Orchestrator stores — checkpoint vs snapshot

`ai.orchestrator()` persists through **two distinct stores** with two distinct contracts. Confusing them is the #1 wiring mistake.

| Store          | Contract          | Persists                                                                      | Keyed by                                      | Factories                                     |
| -------------- | ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| **checkpoint** | `CheckpointStore` | cross-turn SESSION STATE (one append-only row per settled turn)               | `(orchestrator_name, session_id, turn_index)` | `ai.checkpoint.{memory,pg,redis}()`           |
| **snapshot**   | `SnapshotStore`   | in-flight internal SUPERVISOR run state (for `iterate: true` mid-turn resume) | `runId`                                       | `ai.snapshot.{memory,pg,redis,file,sqlite}()` |

- A **checkpoint** is what lets `execute()` rehydrate a session across calls — state, `turn_index`, drift `signature`, `version`, `last_route`, compaction progress, lock metadata.
- A **snapshot** is what lets a crashed mid-turn `iterate: true` turn resume — it round-trips the existing `SupervisorSnapshot` envelope (the same shape the supervisor's own `snapshotStore` uses).

`iterate: false` orchestrators need only a `checkpointStore`. `iterate: true` needs **both**.

## Wiring

```ts
import { ai, END } from "@warlock.js/ai";
import type { AgentContract, PgClientLike } from "@warlock.js/ai";

declare const triage: AgentContract;
declare const resolver: AgentContract;
declare const pgPool: PgClientLike; // a live pg.Pool

const orch = ai.orchestrator({
  name: "support",
  intents: { triage, resolver },
  route: (ctx) => (ctx.iteration === 0 ? "triage" : END),
  iterate: true,
  checkpointStore: ai.checkpoint.pg({ client: pgPool }),
  snapshotStore: ai.snapshot.pg({ client: pgPool }), // a single pg.Pool backs both
});
```

### Global defaults

```ts
ai.config({
  defaultCheckpointStore: ai.checkpoint.memory(),
  defaultSnapshotStore: ai.snapshot.memory(),
});
```

Resolution: explicit `checkpointStore` / `snapshotStore` on the config wins, else the matching `ai.config({ default… })`, else undefined. `iterate: true` with no snapshot store resolvable throws `OrchestratorConfigError` at construction.

## The three drivers

| Driver                             | Client                          | Durable | Cross-process | Fits                                                    |
| ---------------------------------- | ------------------------------- | ------- | ------------- | ------------------------------------------------------- |
| `memory()`                         | none                            | ❌      | ❌            | dev / tests / single-process; no resume across restarts |
| `pg({ client, table?, ttl? })`     | dev-supplied `pg.Pool`/`Client` | ✅      | ✅            | production with Postgres                                |
| `redis({ client, prefix?, ttl? })` | dev-supplied `redis` client     | ✅      | ✅            | production with Redis                                   |

`@warlock.js/ai` takes **NO peer dependency** on `pg` or `redis` — you install the client, build it, and pass it in via `{ client }` (anything matching `PgClientLike` / `RedisClientLike`). The store never opens or closes the connection. A single `pg.Pool` can back the cache, the checkpoint store, and the snapshot store at once.

```ts
import { ai } from "@warlock.js/ai";
import type { RedisClientLike } from "@warlock.js/ai";
import { Pool } from "pg";

declare const redisClient: RedisClientLike; // a connected redis client

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

ai.checkpoint.pg({ client: pool, table: "warlock_orchestrator_sessions", ttl: 86_400 });
ai.snapshot.pg({ client: pool, table: "warlock_supervisor_snapshots" });

// redis
ai.checkpoint.redis({ client: redisClient, prefix: "warlock:orchestrator", ttl: 86_400 });
ai.snapshot.redis({ client: redisClient, prefix: "warlock:snapshot" });
```

Local-first snapshot stores (no server, single host):

```ts
ai.snapshot.file({ dir: ".warlock/snapshots" }); // one JSON file per runId, written via temp file + rename
ai.snapshot.sqlite({ path: "./data/agent.db" }); // node:sqlite; table warlock_snapshots, created on first use
ai.snapshot.sqlite({ database: betterSqliteDb, table: "runs", createTable: false }); // bring your own exec/prepare database
```

Local snapshot storage is private on POSIX: new directories default to `0700`, and JSON files (including temporary files and rewrites) default to exactly `0600`. Existing directories are never chmod-ed, and directory creation is subject to umask. Untouched older JSON files keep their permissions until rewritten. To allow a trusted group to read:

```ts
ai.snapshot.file({ dir: "./shared-sessions", dirMode: 0o750, fileMode: 0o640 });
```

`dirMode` / `fileMode` must be integer permission modes (`0o000`–`0o777`); group/other write bits are refused. `sqlite({ path })` creates parents with `0700`, sets its database to `0600` before opening and protects journal/WAL/SHM sidecars; existing parent directories are unchanged. `":memory:"` creates no files. With `sqlite({ database })`, the caller manages permissions. Windows ignores POSIX modes; configure filesystem ACLs there.

`ai.snapshot.sqlite` is the one store that creates its own table (an embedded file has no migration step); `createTable: false` turns that off and `schema()` still returns the DDL. Every `ai.snapshot.*` factory is generic over the snapshot shape (`ai.snapshot.file<AgentSnapshot>({ dir })`), so the same factories back `durable` agents and `ai.session()` conversations (the `keep-agent-conversations` topic).

Table / prefix names must be safe SQL identifiers (`[A-Za-z_][A-Za-z0-9_]*`) — interpolated into DDL/DML, so anything outside that subset is rejected. Defaults: pg checkpoint table `warlock_orchestrator_sessions`, pg snapshot table `warlock_supervisor_snapshots`, redis prefix `warlock:orchestrator`.

## Schema is NEVER auto-migrated

The framework never creates or alters tables. Each pg store exposes `schema()` returning the reference DDL — run it through YOUR migration tool once before use:

```ts
const store = ai.checkpoint.pg({ client: pool });
await pool.query(store.schema()); // once, via your migration tooling
```

The memory and redis drivers return an empty `schema()` string (no backing table), so callers can treat `schema()` uniformly.

## `CheckpointRecord` — the persisted row

```ts
type CheckpointRecord = {
  orchestrator_name: string; // PK segment 1
  session_id: string; // PK segment 2
  turn_index: number; // PK segment 3 — highest is live
  state: unknown; // post-merge session accumulator (TState)
  last_route: string | string[] | null;
  signature: string; // drift fingerprint at write time
  version: string | null; // config.version tag — metadata only
  summarized_through: number | null; // exclusive turn index compaction reached
  lock_acquired_at: string | null; // compaction lock metadata
  lock_expires_at: string | null;
  saved_at: string; // ISO write timestamp
};
```

Append-only from v1 — `save()` never overwrites a prior `turn_index`. `load(name, sessionId)` returns the latest row (highest `turn_index`), or `undefined` for a session the store has never seen.

## Store contract methods

Both stores: `load(...)`, `save(...)`, `delete(...)`, optional `list(...)`, `schema()`.

- **`list(orchestratorName, prefix?)`** (checkpoint) / **`list(prefix?)`** (snapshot) — enumerate session/run ids for the production boot-drain loop. Optional: stores that can't enumerate omit it.
- The orchestrator's **`keepSnapshots`** retention policy lives on the orchestrator config, NOT the store — the orchestrator calls the pg store's `prune()` after a successful `save` when `keepSnapshots` is a finite number; `"all"` skips pruning.

## Boot-drain pattern

On startup, resume any session whose last turn was interrupted mid-flight:

```ts
const sessions = (await checkpointStore.list?.(orch.name)) ?? [];
for (const sessionId of sessions) {
  await orch.resume(sessionId); // null when nothing in flight — harmless
}
```

## Distinct from `@warlock.js/cache` snapshot resume

A bare `ai.supervisor()` / `ai.workflow()` uses a `snapshotStore` for `resume(runId)`. That `SnapshotStore` was promoted from the historical `@warlock.js/cache` `CacheDriver` path. ⚠ The CacheDriver overload is deprecated for one minor — new code wires `ai.snapshot.*` stores. See the `persist-ai-data` topic for the supervisor/workflow side and the cache-backed semantic cache.

## See also

- The `run-orchestrator` topic — the consumer of these stores
- The `persist-ai-data` topic — supervisor/workflow snapshot resume + the SnapshotStore migration
- The `handle-ai-errors` topic — `OrchestratorDriftError` / `OrchestratorConfigError`
