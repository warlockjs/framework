---
title: "Recipe — Wiring orchestrator stores in production"
description: Wire ai.checkpoint.pg with ai.snapshot.pg or ai.snapshot.redis using dev-owned clients, run the schema migration, and drain interrupted sessions on boot.
sidebar:
  order: 21
  label: "Production stores"
---

You have an orchestrator working in development against `ai.checkpoint.memory()`. Now it has to survive deploys, run across multiple processes, and resume any turn that was in flight when a pod was rotated. That means two durable stores, a real migration, and a boot-drain loop.

This recipe wires the production story: a dev-owned Postgres pool for the checkpoint store, a choice of Postgres or Redis for the snapshot store, the schema migration you run yourself, and the startup loop that resumes interrupted sessions.

## Two stores, two contracts

`ai.orchestrator()` persists through two **distinct** stores. Confusing them is the most common wiring mistake.

| Store | Factory | Persists | Keyed by | Needed when |
|---|---|---|---|---|
| **checkpoint** | `ai.checkpoint.{memory,pg,redis}()` | cross-turn session state (one append-only row per settled turn) | `(orchestrator_name, session_id, turn_index)` | always |
| **snapshot** | `ai.snapshot.{memory,pg,redis}()` | in-flight internal-supervisor run state | `runId` | only with `iterate: true` |

An `iterate: false` orchestrator needs only a checkpoint store. An `iterate: true` orchestrator needs **both**.

:::danger[`iterate: true` requires a resolvable snapshot store]
The snapshot store is validated at **construction time**, not on the first turn. If you set `iterate: true` and neither a per-orchestrator `snapshotStore` nor a global `ai.config({ defaultSnapshotStore })` resolves, `ai.orchestrator()` throws immediately:

```text
OrchestratorConfigError: ai.orchestrator("refund-support"): `iterate: true`
requires a `snapshotStore` (or `ai.config({ defaultSnapshotStore })`) for mid-turn resume
```

The checkpoint store resolves the same way — the per-orchestrator `checkpointStore` field first, then `ai.config({ defaultCheckpointStore })` — but it is required for **every** orchestrator, not just `iterate: true` ones, because every turn writes a checkpoint. Wiring both stores (or both `ai.config` defaults) before you flip `iterate: true` is the only safe order.
:::

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
# the store clients are YOUR dependency — @warlock.js/ai never imports them:
yarn add pg
yarn add redis   # only if you use the redis snapshot store
```

`@warlock.js/ai` takes **no peer dependency** on `pg` or `redis`. You install the client, build it, and pass it in via `{ client }`. The store never opens, closes, or quits the connection — its lifecycle stays entirely yours.

## Build the dev-owned clients

```ts
// db.ts
import { Pool } from "pg";
import { createClient } from "redis";

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();
```

## Wire the stores

A single `pg.Pool` can back both stores. Below, the checkpoint store is Postgres (it needs `list()` for the boot-drain loop) and the snapshot store is Redis — a common production split where session state is queryable in SQL while the high-churn in-flight snapshots live in Redis.

```ts
// support-bot.ts
import { ai } from "@warlock.js/ai";
import { pgPool, redisClient } from "./db";
import { intents } from "./intents";
import { route } from "./route";

export const checkpointStore = ai.checkpoint.pg({
  client: pgPool,
  table: "warlock_orchestrator_sessions", // default; shown for clarity
  ttl: 7 * 24 * 60 * 60, // optional idle-row TTL in seconds
});

export const snapshotStore = ai.snapshot.redis({
  client: redisClient,
  prefix: "warlock:supervisor:snapshot:", // default; shown for clarity
});

export const supportBot = ai.orchestrator({
  name: "refund-support",
  intents,
  route,
  iterate: true,
  checkpointStore,
  snapshotStore,
});
```

### Both stores on Postgres

If you'd rather keep everything in one database, point both factories at the same pool — they use different tables (`warlock_orchestrator_sessions` and `warlock_supervisor_snapshots`):

```ts
export const checkpointStore = ai.checkpoint.pg({ client: pgPool });
export const snapshotStore = ai.snapshot.pg({ client: pgPool });
```

### Global defaults

Instead of passing the stores on every orchestrator, register them once. Explicit config fields still win; the defaults fill in when a field is omitted.

```ts
ai.config({
  defaultCheckpointStore: checkpointStore,
  defaultSnapshotStore: snapshotStore,
});

// Now this orchestrator inherits both stores from the global defaults:
const supportBot = ai.orchestrator({ name: "refund-support", intents, route, iterate: true });
```

## Run the schema migration — once, yourself

The framework **never** auto-migrates. Each pg store exposes `schema()` returning reference DDL; run it through your own migration tool before the store handles any traffic. The Redis and memory drivers return an empty `schema()` string, so you can treat `schema()` uniformly across drivers.

```ts
// migrate.ts — run once at deploy time, before serving traffic.
import { pgPool } from "./db";
import { checkpointStore, snapshotStore } from "./support-bot";

export async function migrateOrchestratorStores() {
  await pgPool.query(checkpointStore.schema());

  // snapshotStore.schema() is "" for the redis driver — harmless to run.
  const snapshotDdl = snapshotStore.schema();
  if (snapshotDdl) {
    await pgPool.query(snapshotDdl);
  }
}
```

The checkpoint DDL provisions `warlock_orchestrator_sessions` with the append-only primary key `(orchestrator_name, session_id, turn_index)` plus the lookup and `saved_at` indexes; the snapshot DDL provisions `warlock_supervisor_snapshots` keyed by `run_id`. Both use `CREATE TABLE IF NOT EXISTS`, so re-running the migration is safe.

### The exact DDL each `schema()` emits

`schema()` is not a black box — it returns the literal SQL below with your configured table name interpolated. Read it before you run it; it is the contract between the store and your column layout.

The checkpoint store (`ai.checkpoint.pg`, default table `warlock_orchestrator_sessions`) returns:

```sql
CREATE TABLE IF NOT EXISTS warlock_orchestrator_sessions (
  orchestrator_name    TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  turn_index           INTEGER NOT NULL,
  state                JSONB NOT NULL,
  last_route           TEXT,
  signature            TEXT NOT NULL,
  version              TEXT,
  summarized_through   INTEGER,
  lock_acquired_at     TIMESTAMPTZ,
  lock_expires_at      TIMESTAMPTZ,
  saved_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (orchestrator_name, session_id, turn_index)
);
CREATE INDEX IF NOT EXISTS idx_warlock_orchestrator_sessions_saved_at
  ON warlock_orchestrator_sessions (saved_at);
CREATE INDEX IF NOT EXISTS idx_warlock_orchestrator_sessions_lookup
  ON warlock_orchestrator_sessions (orchestrator_name, session_id, turn_index DESC);
```

The snapshot store (`ai.snapshot.pg`, default table `warlock_supervisor_snapshots`) returns:

```sql
CREATE TABLE IF NOT EXISTS warlock_supervisor_snapshots (
  run_id    TEXT PRIMARY KEY,
  payload   JSONB NOT NULL,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warlock_supervisor_snapshots_saved_at ON warlock_supervisor_snapshots (saved_at);
```

The index names are derived from the table name (`idx_<table>_saved_at`, `idx_<table>_lookup`), so if you pass a custom `table` the indexes follow it automatically. The snapshot table has no per-session shape because a run carries exactly one live snapshot — `save()` upserts on the `run_id` primary key rather than appending.

### Running it through a real migration tool

`schema()` returns one string containing multiple statements. Most migration runners want each statement as the body of a versioned, reversible migration. The pattern is the same regardless of tool: capture the DDL into an `up` migration and write the matching `DROP`s into `down` yourself (the store never emits teardown SQL).

```ts
// migrations/0001_orchestrator_stores.ts — shape for a node-pg-migrate style runner
import { pgPool } from "../db";
import { checkpointStore, snapshotStore } from "../support-bot";

export async function up(): Promise<void> {
  // schema() is idempotent (CREATE ... IF NOT EXISTS), so it is safe to run
  // inside a forward migration even on a partially-provisioned database.
  await pgPool.query(checkpointStore.schema());

  const snapshotDdl = snapshotStore.schema();
  if (snapshotDdl) {
    await pgPool.query(snapshotDdl);
  }
}

export async function down(): Promise<void> {
  // The store emits no teardown SQL — you own the DROP side.
  await pgPool.query("DROP TABLE IF EXISTS warlock_supervisor_snapshots");
  await pgPool.query("DROP TABLE IF EXISTS warlock_orchestrator_sessions");
}
```

If your runner reads `.sql` files rather than executing TypeScript, generate the file from `schema()` at build time — a one-line script (`fs.writeFileSync("up.sql", store.schema())`) keeps the checked-in SQL in lockstep with the store's reference DDL instead of letting a hand-copied snapshot drift.

## Boot-drain: resume interrupted sessions on startup

With durable stores, a turn interrupted by a pod rotation is recoverable. On boot, enumerate every known session and `resume()` it. Only the **checkpoint** store can enumerate (`list`) — the Redis snapshot store deliberately omits `list()` because its client surface has no `SCAN`/`KEYS`. That is exactly why the boot-drain loop iterates the checkpoint store, not the snapshot store.

```ts
// boot.ts
import { supportBot, checkpointStore } from "./support-bot";
import { migrateOrchestratorStores } from "./migrate";

export async function boot() {
  await migrateOrchestratorStores();
  await drainInterruptedSessions();
}

async function drainInterruptedSessions() {
  // `list` is optional on the contract — guard it.
  const sessionIds = (await checkpointStore.list?.(supportBot.name)) ?? [];

  const results = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      const result = await supportBot.resume(sessionId, {
        context: { resumedAt: new Date().toISOString() },
      });

      // resume() returns null when nothing was in flight — a clean no-op.
      if (result?.error) {
        throw Object.assign(result.error, { sessionId });
      }

      return { sessionId, resumed: result !== null };
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") {
      logger.error("failed to drain session", { error: r.reason });
    } else if (r.value.resumed) {
      logger.info("drained interrupted session", { sessionId: r.value.sessionId });
    }
  }
}
```

`resume()` continues an interrupted `iterate: true` turn from its persisted supervisor snapshot. It re-supplies request-scoped `context` (never persisted) and rehydrates state from the checkpoint — there is no `history` argument, because it continues an in-flight turn rather than opening a fresh one.

### Why the drain is safe to run on every boot

`resume()` is idempotent by construction, which is what makes the unconditional loop above correct. Internally it loads the latest checkpoint, computes the `runId` of the turn that would have been *next* (the one that was in flight), and loads that supervisor snapshot. It only re-dispatches when a snapshot exists **and** its status is still `running`; in every other case — no in-flight snapshot, a snapshot that already settled, or an `iterate: false` orchestrator that has no snapshot store at all — it returns `null` and touches nothing. So a session that completed cleanly before the crash is a no-op on the next boot, and re-running the whole drain after a second crash mid-drain simply resumes whatever is still `running`. That is why the loop treats `result === null` as the common case (`resumed: result !== null`) rather than an error.

`resume()` requires both stores to be wired: it reads the checkpoint to find the latest settled turn and reads the snapshot to find the in-flight run. An `iterate: false` orchestrator has no snapshot store, so `resume()` always returns `null` for it — the boot drain is a no-op and you can skip it entirely.

### Serialize the drain against live traffic

The boot drain and incoming user turns both write checkpoints for the same session. Do not start serving a session's live turns until its drain has settled, or a resumed turn and a fresh `execute()` can race on the same `(orchestrator_name, session_id)` rows. The simplest safe ordering is: run `drainInterruptedSessions()` to completion in your boot sequence **before** the HTTP/WebSocket listener starts accepting requests. If you cannot block startup that long, gate per-session traffic behind the same per-session lock you use for live turns (see the multi-instance note below) so a drain and a live turn never interleave for one session.

## Prune checkpoint rows with `keepSnapshots`

The checkpoint table is append-only — one row per settled turn — so a long-lived session accumulates a row per turn forever unless you bound it. `keepSnapshots` on the orchestrator config is that bound:

```ts
export const supportBot = ai.orchestrator({
  name: "refund-support",
  intents,
  route,
  iterate: true,
  checkpointStore,
  snapshotStore,
  keepSnapshots: 50, // retain the most recent 50 turns per session
});
```

`keepSnapshots` is a `number | "all"` and **defaults to `100`**. After every successful `save()`, the orchestrator calls the store's `prune()` to delete rows whose `turn_index` falls below `(max_turn_index - keepSnapshots)` for that session — so each session keeps at most the latest `keepSnapshots` turns. Setting `keepSnapshots: "all"` disables pruning entirely (the orchestrator skips the `prune()` call); use it only when you genuinely need the full per-turn audit trail and have your own retention story.

A few mechanics worth knowing:

- **Pruning is per-session and synchronous-after-save.** It runs in the same turn that wrote the new row, against that one session — it never sweeps the whole table.
- **`prune()` is an optional store method.** The pg and redis checkpoint stores implement it; a custom store that omits `prune()` is simply never pruned (the orchestrator guards on `typeof store.prune === "function"`). The memory store implements it too, so dev and prod prune identically.
- **It only ever deletes the latest row's predecessors.** The most recent turn is always retained regardless of `keepSnapshots`, so the live session state can never be pruned away.
- **`keepSnapshots` is orthogonal to the store `ttl`.** `keepSnapshots` bounds row *count* per session on every save; `ttl` bounds row/key *age* and is applied at prune time (pg) or as a key expiry (redis). Use `keepSnapshots` to cap unbounded growth and `ttl` to retire sessions that have gone quiet.

## Running multiple instances

Across a horizontally-scaled deployment, the stores are shared but the orchestrator gives you **no distributed lock for live turns**. The durability model assumes one rule, stated in the redis checkpoint store's own design: traffic is **serialized per `sessionId`**. Two turns for the *same* session must not run concurrently — different sessions in parallel are fine.

Why it matters for each store:

- **Redis checkpoint store.** A session is one JSON document, and `save()` is a read-modify-write (load the document, push the new row, write it back). Two concurrent turns for one session would interleave that read-modify-write and lose a row. The store is correct *only* under per-session serialization.
- **Postgres checkpoint store.** `save()` is a single append-only `INSERT`, so the database protects you from a silent clobber — but two concurrent turns would both compute the same next `turn_index` and the second `INSERT` collides on the primary key `(orchestrator_name, session_id, turn_index)` and throws. That is a hard failure, not corruption, but it is still a turn you have to retry. Serializing per session avoids it.

So, regardless of store, route every request for a given `sessionId` through a single in-flight turn at a time. Concretely:

- Pin a session to one instance (sticky routing / consistent hashing on `sessionId`) and keep an in-process per-session mutex there, **or**
- Take a short-lived distributed lock keyed by `(orchestrator_name, sessionId)` — for example a Redis `SET key value NX PX <ttl>` lock — around each `execute()` / `resume()` and release it when the turn settles.

The same lock is what the boot-drain "serialize the drain" note refers to: a `resume()` is just another turn for that session, so it must take the per-session lock too, or it can race a live `execute()` arriving on another instance. None of this is the framework's job — the stores deliberately stay lock-free so you can choose the coordination mechanism that fits your topology.

## Production notes

:::caution[Drift on resume]
`resume()` runs the same structural drift check as `execute()`. If you redeploy with a changed orchestrator shape, draining an old session throws `OrchestratorDriftError`. The boot-drain loop above isolates each `resume()` inside `Promise.allSettled`, so one drifted session can't abort the rest of the drain — but you still need a recovery policy (discard, migrate, or `{ force: true }`) for the sessions that throw.
:::

:::note[The stores never own the connection]
You build the `pg.Pool` / redis client, you keep it, you close it on shutdown. The stores only ever call `query` (pg) or `get`/`set`/`del` (redis). A leaked pool is your bug to fix, not the framework's — wire `pool.end()` / `redisClient.quit()` into your shutdown path.
:::

- **`ttl` is for idle cleanup, not correctness.** The pg checkpoint `ttl` marks old rows eligible for cleanup on prune; the redis `ttl` expires written keys. Don't set it shorter than your longest expected gap between user turns, or a live session can evaporate.
- **`keepSnapshots` (on the orchestrator config) prunes the checkpoint table** to the most recent N turns per session after each save; `"all"` disables pruning. It is independent of the store `ttl`.
- **Table and prefix names are validated** as SQL-safe identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and rejected otherwise — they are interpolated into DDL/DML, so an arbitrary string would be an injection footgun.

## Related

- [Stateful refund support bot](./orchestrator-stateful-support-bot) — the orchestrator these stores back, end to end.
- [Orchestrator as a tool](./orchestrator-as-tool) — nesting a stored orchestrator inside an agent.
