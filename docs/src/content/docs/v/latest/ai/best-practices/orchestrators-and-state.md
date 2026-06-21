---
title: "Best Practices — Orchestrators and state"
sidebar:
  label: "Orchestrators and state"
description: How to run durable orchestrator sessions without losing turns, leaking context, or drifting state — one sessionId per conversation, serialized turns, bounded and compacted history, a deliberately-chosen store, a boot-drain loop, and versioned config you migrate on purpose.
---

The pillar this page answers: **how do you keep a long-running conversation correct across crashes, deploys, and concurrent turns — without the context window (and your bill) growing without bound?**

`ai.orchestrator()` is a session-state manager wrapped around a supervisor. Each `execute()` call is ONE turn against a named `sessionId`; the session's accumulated `state`, drift `signature`, and compaction progress live in a `CheckpointStore` between calls, so your process stays stateless. That design only pays off if you respect its contract: one session per conversation, turns that don't race each other, history you bound and compact, a store chosen for where you're running, a startup loop that drains interrupted turns, and config changes you treat as migrations. This page is the opinionated version of each of those, grounded in the real `ai.orchestrator` surface.

Everything below assumes the shape from the [run-orchestrator skill](../recipes/orchestrator-stateful-support-bot): `intents` keyed by name, `route` XOR `router` for dispatch, `execute(input, { sessionId, history })` per turn, and `result.report.status === "awaiting-input"` meaning the session continues.

## One `sessionId` per conversation — and pass it every call

There is no implicit "current session". Every `execute` / `stream` / `resume` / `command` call names the session it acts on via `sessionId`. The checkpoint row is keyed by `(orchestrator_name, session_id, turn_index)` — so the `sessionId` *is* the conversation's identity. Get it wrong and you either fork one conversation into two unrelated sessions or, worse, collapse two users into one.

**Do this — derive `sessionId` from a stable conversation key.** Mint it once when the conversation starts and reuse it verbatim for every subsequent turn.

```ts
import { ai } from "@warlock.js/ai";
import { supportBot } from "./support-bot";

// One conversation → one id, reused across turns. Here, the chat thread id.
async function handleTurn(threadId: string, message: string, history: Message[]) {
  return supportBot.execute(message, {
    sessionId: `support:${threadId}`, // stable for the life of the thread
    history,
  });
}
```

**Avoid this — a fresh id per turn (or a shared one across users).** A new `sessionId` each call means turn 2 loads an empty checkpoint and forgets everything turn 1 established; a `sessionId` that isn't unique per user leaks one customer's state into another's session.

```ts
// Anti-pattern: a new id every turn — state never rehydrates, the session resets each call.
await supportBot.execute(message, { sessionId: crypto.randomUUID(), history });

// Anti-pattern: a constant id — every user writes into the SAME session.
await supportBot.execute(message, { sessionId: "support-session", history });
```

> Namespace the id the way you namespace anything multi-tenant: `support:${tenantId}:${threadId}`. The orchestrator `name` already partitions sessions across orchestrators (it's the first PK segment), so you only need the id to be unique *within* one orchestrator.

## Serialize turns per session — the checkpoint is last-writer-wins

A checkpoint row is append-only per `turn_index`, but the orchestrator computes the next turn from *the checkpoint it loaded at the start of the turn*. If two `execute()` calls for the same `sessionId` run concurrently, they both load the same latest turn, both compute the same next `turn_index`, and the slower one's persist silently clobbers the faster one's — last writer wins, and a turn's worth of state vanishes. The framework does not lock the session for you (the only lock is the *compaction* lock, which is a different thing).

**Do this — funnel a session's turns through a per-session queue.** Hold a turn until the previous turn for the same `sessionId` has settled.

```ts
const inFlight = new Map<string, Promise<unknown>>();

// Chain each session's turns so turn N+1 starts only after turn N settles.
function runTurnSerialized(sessionId: string, run: () => Promise<OrchestratorResult>) {
  const prior = inFlight.get(sessionId) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(run);

  inFlight.set(sessionId, next);
  next.finally(() => {
    if (inFlight.get(sessionId) === next) inFlight.delete(sessionId);
  });

  return next;
}

await runTurnSerialized("support:thread-42", () =>
  supportBot.execute(message, { sessionId: "support:thread-42", history }),
);
```

In a single-process deploy an in-memory map is enough. Across processes, push the same discipline down to your transport — a per-`sessionId` queue/partition (one consumer per session key) so a session's turns are never processed in parallel by two workers.

**Avoid this — firing concurrent turns at one session and trusting the store to sort it out.** It won't; the checkpoint row is last-writer-wins, not a CAS.

```ts
// Anti-pattern: two turns for the same session race — one persist clobbers the other.
await Promise.all([
  supportBot.execute(msgA, { sessionId: "support:thread-42", history }),
  supportBot.execute(msgB, { sessionId: "support:thread-42", history }),
]);
```

> The `awaiting-input` status is your serialization signal in disguise: a turn that returns `status: "awaiting-input"` is telling you the session is paused, waiting for the *next* user turn. Don't send another turn until you've got it back.

## Bound history per dispatchable with `historyWindow`

`history` is required on every `execute` call — the framework owns session *state*, never the raw message log, so you re-supply prior turns each call. Left unbounded, that array grows every turn and you pay for the whole transcript on every dispatch, forever. `historyWindow` slices it per role *before* the turn runs, so the router and the agents each see only what they need.

**Do this — give the router a tight window and the agents a wider one.** The router only needs the recent gist to pick an intent; the working agents need more context to actually answer.

```ts
const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  intents,
  route,
  historyWindow: {
    router: 5,   // last 5 messages are plenty to choose an intent
    agents: 20,  // the agent doing the work gets more context
  },
  checkpointStore,
});
```

A number keeps the last N messages; a callback takes full control of the slice when "last N" is too blunt:

```ts
historyWindow: {
  // Keep the system message plus the most recent 10 — never drop the framing turn.
  agents: (messages) => [
    ...messages.filter((m) => m.role === "system"),
    ...messages.filter((m) => m.role !== "system").slice(-10),
  ],
},
```

**Avoid this — passing the entire transcript every turn with no window.** By turn 30 every dispatch re-reads 29 turns of history; latency and cost climb linearly with conversation length, and you'll hit the context limit on a long session.

```ts
// Anti-pattern: no historyWindow — the full, ever-growing history hits the model every turn.
const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  intents,
  route,
  checkpointStore,
});
await supportBot.execute(message, { sessionId, history: everyMessageEverSent });
```

> `historyWindow` trims what *this turn* sends to the model; it does not shrink the array you store. Pair it with compaction (next section) so the underlying history you re-supply also stays small.

## Schedule compaction so context stays small

Windowing caps per-turn cost; it doesn't stop the history *you re-supply* from growing. Compaction does — `summarize` replaces a run of old turns with one summary message once the conversation gets long. The object form fires automatically after `afterTurns` and keeps the most recent `keep` verbatim.

**Do this — set a count-based policy and apply the result to your message store.** `onCompact` hands you the `CompactionResult` so you can collapse the range in the store you own.

```ts
const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  intents,
  route,
  summarize: {
    afterTurns: 20,        // start compacting once the session passes 20 turns
    keep: 6,               // keep the 6 most-recent messages verbatim
    summarizer: cheapModel, // summarize with a cheap model, not the turn model
    onCompact: async (compaction, ctx) => {
      // compaction = { summary, replacesFromIndex, replacesToIndex }
      await messages.applyCompaction(ctx.sessionId, compaction);
    },
  },
  checkpointStore,
});
```

When you supply `onCompact`, the orchestrator applies the compaction for you and does **not** surface `result.compaction`. When you omit it, you must apply `result.compaction` yourself on the turn it appears:

```ts
const result = await supportBot.execute(message, { sessionId, history });

if (result.compaction) {
  await messages.applyCompaction(result.sessionId, result.compaction);
}
```

**Avoid this — never compacting, or compacting with the expensive turn model.** No compaction means an unbounded transcript that eventually blows the context window; compacting with your primary model turns a cost-saving measure into a recurring expense on a model you picked for quality, not summarization.

```ts
// Anti-pattern: no summarize policy at all — history grows forever, then a turn fails on context overflow.
const supportBot = ai.orchestrator<SupportState>({ name, intents, route, checkpointStore });
```

> The callback form of `summarize` (`(history) => CompactionResult`) **never auto-fires** — it runs only when you call `command("compact", { sessionId, history })`. Reach for it when you want full control of *what* gets summarized; reach for the object form when you just want "compact every N turns" on autopilot.

## Pick the store deliberately — memory for dev, pg or redis for prod

`ai.orchestrator()` persists through two **distinct** stores, and confusing them is the most common wiring mistake. The **checkpoint** store (`ai.checkpoint.{memory,pg,redis}()`) holds cross-turn session state and is always required. The **snapshot** store (`ai.snapshot.{memory,pg,redis}()`) holds the in-flight internal-supervisor run and is required *only* when `iterate: true` — construction throws `OrchestratorConfigError` if you set `iterate: true` without one (or a `defaultSnapshotStore`).

**Do this — `memory` in dev, a durable store in prod, chosen for what it can do.** Only the checkpoint store needs to enumerate sessions for the boot-drain loop, and the Redis snapshot store deliberately omits `list()` — so the common production split is a Postgres checkpoint store (queryable, `list()`-capable) with a Redis snapshot store (fast, high-churn).

```ts
import { ai } from "@warlock.js/ai";
import { pgPool, redisClient } from "./db"; // YOUR clients — @warlock.js/ai imports neither pg nor redis

export const checkpointStore = ai.checkpoint.pg({ client: pgPool });   // list()-capable → drives boot-drain
export const snapshotStore = ai.snapshot.redis({ client: redisClient }); // fast, high-churn

export const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  intents,
  route,
  iterate: true,        // each turn delegates to a real internal supervisor
  checkpointStore,
  snapshotStore,        // required because iterate: true
});
```

Register them once with `ai.config({ defaultCheckpointStore, defaultSnapshotStore })` if every orchestrator uses the same pair — explicit config fields still win, the defaults only fill an omitted field.

**Avoid this — shipping `ai.checkpoint.memory()` to production, or `iterate: true` without a snapshot store.** The memory store is per-process and dies with the process: a deploy wipes every live session, and a second pod can't see the first's sessions. And `iterate: true` without a snapshot store fails loudly at construction — by design, because a crashed mid-turn iteration would otherwise be unrecoverable.

```ts
// Anti-pattern: in-memory checkpoint in prod — every session evaporates on deploy.
const supportBot = ai.orchestrator({ name, intents, route, checkpointStore: ai.checkpoint.memory() });

// Anti-pattern: iterate without durability — throws OrchestratorConfigError at construction.
const supportBot = ai.orchestrator({ name, intents, route, iterate: true /* no snapshotStore */ });
```

> The stores never own the connection. You build the `pg.Pool` / redis client, you keep it, you close it on shutdown (`pool.end()` / `redisClient.quit()`). The framework never auto-migrates either — run `checkpointStore.schema()` through your own migration tool before the store sees traffic. See the [production-stores recipe](../recipes/orchestrator-production-stores) for the full wiring.

## Run the boot-drain loop on startup

A turn interrupted by a pod rotation mid-iteration (`iterate: true`) is recoverable — but only if you ask for it. On boot, enumerate every known session and `resume()` it: `resume()` continues an interrupted turn from its persisted supervisor snapshot, and returns `null` when there was nothing in flight (a clean no-op). For an `iterate: false` orchestrator `resume()` is always a no-op, so the loop is harmless to run regardless.

**Do this — drain every session on startup, isolating each `resume()`.** `list()` is optional on the contract, so guard it; wrap each resume in `Promise.allSettled` so one bad session can't abort the whole drain.

```ts
import { supportBot, checkpointStore } from "./support-bot";

export async function drainInterruptedSessions() {
  const sessionIds = (await checkpointStore.list?.(supportBot.name)) ?? [];

  const results = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      const result = await supportBot.resume(sessionId, {
        context: { resumedAt: new Date().toISOString() }, // re-supply request-scoped context
      });
      // null = nothing was in flight; non-null = a turn was drained.
      if (result?.error) throw Object.assign(result.error, { sessionId });
      return { sessionId, resumed: result !== null };
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") logger.error("drain failed", { error: r.reason });
  }
}
```

**Avoid this — assuming a restarted process picks up where it left off on its own.** Nothing resumes an interrupted turn implicitly. Skip the drain and a session that was mid-iteration when the pod rotated stays frozen until — if you're lucky — the user sends another turn, at which point `execute()` opens a *fresh* turn on top of a half-finished one.

> `resume()` re-supplies request-scoped `context` (never persisted) and rehydrates `state` from the checkpoint — there's no `history` argument, because it continues an in-flight turn rather than opening a new one. Anything the resumed turn needs from `context` (db handles, request ids) must be re-supplied here.

## Treat `OrchestratorConfig` changes as drift — version and migrate on purpose

The orchestrator computes a structural `signature` from its definition — name, intents map, route/router presence, evaluate presence, `initialAgent`, `maxIterations`, the `iterate` flag, and the `historyWindow` shape. Every checkpoint records the signature at write time; every load compares it. Change the shape and redeploy, and the next turn on an old session throws `OrchestratorDriftError` synchronously — **nothing dispatches**. That's a guardrail, not a bug: it stops a turn from running against state that no longer matches the code.

**Do this — bump `version` when you change the shape, and handle drift with an explicit recovery policy.** Decide per session: discard, migrate the persisted state, or accept the new signature with `{ force: true }` once you've confirmed the old state is still valid.

```ts
import { OrchestratorDriftError } from "@warlock.js/ai";

const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  version: "2025-06-v3", // bump deliberately when the shape changes — metadata, but your migration marker
  intents,
  route,
  checkpointStore,
});

try {
  await supportBot.execute(message, { sessionId, history });
} catch (error) {
  if (error instanceof OrchestratorDriftError) {
    // savedSignature ≠ currentSignature for this session. Recover deliberately:
    await migrateSession(error.sessionId); // migrate the row, then…
    await supportBot.execute(message, { sessionId, history, force: true }); // …accept the new signature
  } else {
    throw error;
  }
}
```

**Avoid this — blanket `{ force: true }` to "make the error go away".** Forcing past drift runs the new code against state shaped for the old definition. If turn 5 added an intent that reads a state slice the old turns never wrote, you don't get an error — you get silently wrong behavior, which is far harder to debug than the drift throw you suppressed.

```ts
// Anti-pattern: force on every call — drift detection is now off, stale state runs against new code.
await supportBot.execute(message, { sessionId, history, force: true });
```

> The orchestrator signature does **not** aggregate the internal supervisor's signature. Internal-supervisor drift surfaces separately, only on `iterate: true` *resume*, via the supervisor's own check — so a change to a router agent's prompt won't trip the orchestrator-level drift guard. Version both layers when you change both.

## Keep session state JSON-serializable and small

Whatever your intents merge into `state` gets checkpointed verbatim — it's the `state` column on every row, round-tripped as JSON. So the same two rules that govern any serialized blob govern session state: it must survive `JSON.stringify` → `JSON.parse` unchanged, and every byte is re-read and re-written on every turn.

**Do this — store small, plain, serializable facts.** IDs and primitives, not live objects.

```ts
type SupportState = {
  category?: "refund" | "shipping" | "other";
  orderId?: string;        // the id, not the hydrated order object
  refundEligible?: boolean;
  replyDraft?: string;
};
```

**Avoid this — stuffing non-serializable handles or whole payloads into state.** A `Date`, a `Map`, a class instance, or a db connection either throws on serialize or silently round-trips into a useless `{}` / ISO string; a fat record (the full order, the entire fetched document) bloats every checkpoint row and every subsequent load.

```ts
// Anti-pattern: live handles and fat payloads in session state.
type SupportState = {
  db: Pool;                 // a connection can't be checkpointed
  fetchedAt: Date;          // round-trips to a string, breaks `instanceof Date`
  fullOrder: Order;         // re-serialized and re-loaded on every single turn
};
```

> Request-scoped, non-serializable things — db handles, the current request id, a logger — belong in the `context` bag, not `state`. `context` is frozen at intake, passed to every callback at `ctx.context`, and **never persisted**; that's exactly why `resume()` makes you re-supply it. Use `state` for what must survive the turn, `context` for what must not.

## See also

- [run-orchestrator skill](../recipes/orchestrator-stateful-support-bot) — the full `ai.orchestrator()` surface and turn lifecycle.
- [Recipe — Stateful refund support bot](../recipes/orchestrator-stateful-support-bot) — session state, history, compaction, and resume end to end.
- [Recipe — Wiring orchestrator stores in production](../recipes/orchestrator-production-stores) — pg/redis stores, the schema migration, and the boot-drain loop.
- [Recipe — Orchestrator as a tool](../recipes/orchestrator-as-tool) — nesting a stored orchestrator inside an agent.
- [Architecture — Orchestrators](../architecture-concepts/orchestrators) — the checkpoint model, the drift signature, and the per-turn lifecycle.
