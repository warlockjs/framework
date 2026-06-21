---
title: "Run orchestrator"
description: ai.orchestrator in depth — config surface, sessions, turns, the per-turn result, iterate + resume, drift recovery, compaction, commands, asTool.
sidebar:
  order: 3
  label: "Run orchestrator"
---

The [Orchestrators](../architecture-concepts/orchestrators) concept page covers *why*. This page is the working surface: every config field, the per-turn result envelope, `iterate` + `resume`, drift recovery, and the production lifecycle.

## The full config

```ts
import { ai, END } from "@warlock.js/ai";

type SessionState = { category?: string; order?: { id: string }; reply?: string };

const supportBot = ai.orchestrator<SessionState>({
  // identity
  name: "refund-support",                     // required — logs, events, checkpoints, signature
  version: "v3-2026-06",                      // metadata only, never parsed

  // "what runs" — the supervisor surface, spread directly
  intents: { classify, lookup, process, compose },
  route: (ctx) => (ctx.iteration === 0 ? "classify" : END),   // route XOR router
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  state: {},                                  // initial session-state seed
  output: outputSchema,                       // final-state schema → result.data
  initialAgent: "classify",                   // dispatch this on turn 0, skip the first route call
  maxIterations: 8,                           // in-turn cap (iterate: true only); default 10

  // session lifecycle — orchestrator-specific
  iterate: true,                              // delegate each turn to a real internal supervisor
  historyWindow: { router: 5, agents: 20 },   // per-role history slice before each turn
  summarize: { afterTurns: 20, keep: 8 },     // automatic post-turn compaction
  keepSnapshots: 100,                         // turn snapshots retained per session; or "all"
  memory: ai.memory({ semantic: { embedder, store } }),

  // durable stores
  checkpointStore: ai.checkpoint.pg({ client: pg }),
  snapshotStore: ai.snapshot.pg({ client: pg }),   // REQUIRED when iterate: true

  // events
  on: { "orchestrator.turn.routed": (e) => log(e.source) },
});
```

### Author-time validation

The factory throws an `OrchestratorConfigError` *at construction* (never on the first turn) when:

- `name` is missing or not a string.
- `intents` is missing.
- both or neither of `route` / `router` are set (they are mutually exclusive, exactly one required).
- `router` is neither an agent contract nor a `{ agent, ... }` entry.
- `maxIterations` is set below 1.
- `iterate: true` but no `snapshotStore` is resolvable (neither the field nor `ai.config({ defaultSnapshotStore })`).
- `initialAgent` names a key not present in `intents`.

## Running a turn

```ts
const result = await supportBot.execute(message, {
  sessionId: "user-42",        // required — names the session this turn acts on
  history: priorTurns,         // required — you own the message history
  state: { category: "refund" },   // partial seed/patch, shallow-merged into loaded state
  context: { userId, db },     // request-scoped, frozen at intake, NEVER persisted
  signal: AbortSignal.timeout(60_000),
  on: { "orchestrator.turn.awaiting-input": (e) => done(e.turnIndex) },  // a clean turn ends here
  force: false,                // bypass the drift check for this call
});
```

There is no implicit "current session" — `sessionId` is required and names the session explicitly. `history` is required too: the framework never persists raw messages (it persists *session state*), so you pass the prior turns each call.

## The per-turn result

```ts
type OrchestratorResult<TOutput> = {
  data?: TOutput;              // turn output when an `output` schema validated
  sessionId: string;
  turnIndex: number;
  compaction?: CompactionResult;   // present when a compaction was suggested for YOU to apply
  report: OrchestratorReport;
  usage: Usage;
  error?: AIError;
};
```

Narrow on `report.status` — and crucially, **handle `"awaiting-input"` as a session-continues path, not a failure**:

```ts
const result = await supportBot.execute(message, { sessionId, history });

if (result.error) {
  logger.error(result.error.code, { sessionId: result.sessionId });
  return;
}

if (result.report.status === "awaiting-input") {
  // the only non-terminal status across the whole result tree —
  // the session paused waiting for the user's next turn. Re-execute() when it arrives.
  return promptUser(result);
}

if (result.compaction) {
  // the orchestrator computed a history compaction for this session —
  // apply it to YOUR message store (it never touches your transcript itself)
  await myMessageStore.applyCompaction(result.sessionId, result.compaction);
}
```

`report.turns[]` carries the per-turn forensic history (bounded by `keepSnapshots`); `report.children[]` carries ONLY the current turn's dispatched primitive reports.

## `iterate` and `resume`

By default each turn is a single dispatch. Set `iterate: true` and the orchestrator builds a real internal supervisor per turn, looping up to `maxIterations` — and persisting the supervisor's mid-turn run to the `snapshotStore` so a crash *mid-iteration* can resume:

```ts
// turn crashed mid-iteration — pick up where it left off
const resumed = await supportBot.resume("user-42");

if (resumed === null) {
  // nothing to resume for this session
}
```

`resume(sessionId, options?)` continues an interrupted turn from its persisted snapshot — it does NOT open a fresh turn, so it takes no `history` (the snapshot has it). It re-supplies request-scoped `context` (which is never persisted) and rehydrates state from the checkpoint. Returns `null` when there's nothing to resume.

## Drift detection and recovery

The orchestrator stamps a structural `signature` on every checkpoint. On the next turn (or on `resume`) it compares the live signature to the checkpoint's, and a mismatch throws `OrchestratorDriftError` **before running anything** — carrying `savedSignature` and `currentSignature`. This is the framework refusing to corrupt a session whose definition changed underneath it.

Three recovery paths:

```ts
// 1. Force — for edits you KNOW are compatible
await supportBot.execute(message, { sessionId, history, force: true });
await supportBot.resume("user-42", { force: true });

// 2. End the session — start clean (safest when the shape genuinely changed)
await store.delete("refund-support", "user-42");   // CheckpointStore.delete
await supportBot.execute(message, { sessionId: "user-42", history: [] });

// 3. Migrate — load the checkpoint, translate it, re-stamp the signature, write it back
//    (mechanical changes you can translate forward)
```

## Compaction in depth

The `summarize` policy fires after a turn settles. The object form is the built-in policy; the callback form takes full control:

```ts
// object form — keep recent N, summarize the rest, apply via onCompact
summarize: {
  afterTurns: 20,
  keep: 8,
  summarizer: cheaperModel,        // defaults to the orchestrator's own model
  onCompact: async (compaction, { sessionId }) => {
    await myMessageStore.applyCompaction(sessionId, compaction);
  },
  lock: { maxWait: 5000 },         // bound the per-turn wait on the compaction lock
}

// callback form — you produce the CompactionResult directly
summarize: async (history) => ({
  summary: { role: "system", content: await summarize(history) },
  replacesFromIndex: 0,
  replacesToIndex: history.length - 9,
})
```

When you supply `onCompact`, the orchestrator applies the compaction for you and does NOT surface `result.compaction`. Without it, the compaction rides out on `result.compaction` for you to apply. Force a compaction outside the automatic trigger with the `compact` command:

```ts
const compaction = await supportBot.command("compact", {
  sessionId: "user-42",
  history: priorTurns,
});
```

## Production lifecycle

- **CheckpointStore** is append-only — one row per settled turn, primary key `(orchestrator_name, session_id, turn_index)`, and the highest `turn_index` is the live state.
- **No auto-migration** — call `store.schema()` to get the DDL string and run it through your own migration tool.
- **Boot-drain** — `CheckpointStore.list(orchestratorName, prefix?)` enumerates sessions so a production boot loop can resume interrupted `iterate: true` turns after a deploy.
- **Idempotency is your responsibility** — agents and steps may re-run on resume.

## Related

- [Orchestrators](../architecture-concepts/orchestrators) — the concept and mental model.
- [Run supervisor](./run-supervisor) — the engine the orchestrator delegates to.
- [Persist AI data](./persist-ai-data) — checkpoint vs snapshot stores, the snapshot API.
- [Memory](../architecture-concepts/memory) — the `memory` field.
- [Handle errors](./handle-errors) — `OrchestratorDriftError`. A turn cancelled via its `AbortSignal` surfaces `SUPERVISOR_CANCELLED` on `result.error` (the orchestrator delegates each turn to the supervisor, so the supervisor's typed cancellation passes straight through) with `report.status: "cancelled"`.
