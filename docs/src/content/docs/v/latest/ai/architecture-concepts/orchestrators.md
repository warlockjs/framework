---
title: "Orchestrators"
description: ai.orchestrator — the stateful capstone of the ladder. Durable sessions across turns, drift detection, history compaction, mid-turn resume, commands, asTool.
sidebar:
  order: 5
  label: "Orchestrators"
---

`ai.orchestrator()` is the top rung of the ladder — a **stateful session manager wrapped around a supervisor**. Where an agent, workflow, or supervisor each handle a single run, an orchestrator owns a *session* that spans many turns: it persists session state, windows and compacts history, detects when the definition drifts out from under a live session, resumes an interrupted turn, and exposes typed built-in commands.

```text
ai.agent()        →  single LLM turn, tool loop, structured output
ai.workflow()     →  deterministic multi-step pipeline, resumable
ai.supervisor()   →  multi-intent router with specialists, iterative
ai.orchestrator() →  stateful session-aware orchestration       ← you are here
```

## When to reach for it

- **`agent`** — one model with tools, single task.
- **`workflow`** — fixed step order, resumable.
- **`supervisor`** — the right specialist is decided per call; you may iterate to a goal within one run.
- **`orchestrator`** — **the session matters across runs.** A support conversation, a multi-turn assistant, anything where turn N+1 must see what happened in turn N without you re-threading the whole world by hand.

The orchestrator does NOT replace the supervisor — it *delegates* to one. Every "what runs" field you'd give a supervisor (`intents`, `route`/`router`, `evaluate`, `state`, `output`, `initialAgent`, `maxIterations`) is the supervisor's surface spread directly onto the orchestrator config. The orchestrator builds the supervisor lazily per turn and adds the session lifecycle around it.

## The mental model

```text
                       ┌────────────────────────────────────────┐
   execute(input,      │            ONE TURN                     │
     { sessionId,      │                                         │
       history })  ──▶ │  1. load checkpoint (session state)     │
                       │  2. drift check (signature compare)     │
                       │  3. wait on compaction lock (if held)   │
                       │  4. window history (router / agents)    │
                       │  5. dispatch → internal supervisor      │
                       │  6. persist checkpoint (turn N)         │
                       │  7. maybe compact history               │
                       └────────────────────────────────────────┘
                                       │
                          OrchestratorResult<TOutput>
```

Each `execute()` is **one turn**. The session is identified by the `sessionId` string you pass per call — there is no implicit "current session" and no stateful session object. Every method names the session it acts on.

## Two stores, two jobs

The orchestrator persists through **two distinct stores**, and confusing them is the most common mistake:

| Store | Holds | When written | Factory |
| --- | --- | --- | --- |
| **CheckpointStore** | Cross-turn **session state** — `state`, `turn_index`, drift `signature`, `last_route`, compaction progress, locks | One row per settled turn (append-only) | `ai.checkpoint.{memory,pg,redis}()` |
| **SnapshotStore** | The internal supervisor's **mid-turn run state** for `iterate: true` resume | During an in-flight iterating turn | `ai.snapshot.{memory,pg,redis}()` |

A `CheckpointStore` is how the session survives between turns. A `SnapshotStore` is how a single `iterate: true` turn survives a crash *mid-iteration*. You only need a `snapshotStore` when `iterate: true` — the factory throws at construction if you set `iterate: true` without one (or a `defaultSnapshotStore`).

Set them per orchestrator, or once globally:

```ts
import { ai } from "@warlock.js/ai";

ai.config({
  defaultCheckpointStore: ai.checkpoint.memory(),
  defaultSnapshotStore: ai.snapshot.memory(),
});
```

> All three drivers — `memory`, `pg`, `redis` — ship for both the checkpoint and snapshot stores. Schema is never auto-migrated — each store exposes `.schema()`, a DDL string you run through your own migration tool.

## A minimal orchestrator

```ts
import { ai, END } from "@warlock.js/ai";

type SessionState = { category?: string; reply?: string };

const supportBot = ai.orchestrator<SessionState>({
  name: "refund-support",
  intents: { classify, lookup, process, compose },
  route: (ctx) => (ctx.iteration === 0 ? "classify" : END),
  checkpointStore: ai.checkpoint.memory(),
});

const result = await supportBot.execute(message, {
  sessionId: "user-42",
  history: priorTurns,   // you own the message history (Path 2)
});

if (result.report.status === "awaiting-input") {
  // session paused — wait for the user's next turn, then execute() again
}
```

`history` is **required** every call. The framework never persists raw messages itself — you hold them and pass the prior turns in. The orchestrator persists *session state*, not the transcript.

## Drift detection

At construction the orchestrator computes a structural **signature** from its definition (name + intent shape + routing). Every checkpoint row stores the signature in force when it was written. On the next turn the orchestrator compares the live signature against the checkpoint's — a mismatch means the definition changed underneath a live session, and it throws `OrchestratorDriftError` *before running anything*, rather than silently corrupting the session.

```ts
await supportBot.execute(message, { sessionId, history, force: true });
```

`force: true` bypasses the check for edits you know are safe. This mirrors the supervisor / workflow drift model — see [Run orchestrator](/v/latest/ai/orchestration/run-orchestrator/) for the recovery paths.

## History compaction

Long sessions outgrow the context window. The `summarize` policy compacts older turns after a turn settles — keep the most-recent `keep` messages verbatim, summarize the rest:

```ts
ai.orchestrator({
  name: "assistant",
  intents,
  route,
  summarize: {
    afterTurns: 20,           // start compacting once the session crosses 20 turns
    keep: 8,                  // keep the last 8 messages raw
    onCompact: async (compaction, { sessionId }) => {
      // apply the produced summary to YOUR message store
      await messages.replaceRange(sessionId, compaction);
    },
  },
});
```

Pass a callback instead of the object form for full control. You can also trigger it manually with the `compact` command (below). Either way the *application* of the summary to your message store is your call — the orchestrator computes the compaction; surfacing it stays explicit.

## Three-tier events

The orchestrator emits its own `orchestrator.*` lifecycle events under the same three-tier subscription model as the supervisor and workflow — **definition** (`config.on`), **instance** (`orchestrator.on(...)`), and **per-call** (`options.on`), fired in that order:

```ts
const supportBot = ai.orchestrator({
  name: "refund-support",
  intents, route,
  on: { "orchestrator.turn.routed": (e) => log(e.source, e.raw) },  // tier 1
});

const off = supportBot.on("orchestrator.drift.checked", (e) => {     // tier 2
  if (e.drifted) alert("definition drifted");
});

await supportBot.execute(message, {
  sessionId, history,
  on: { "orchestrator.turn.awaiting-input": (e) => done(e.turnIndex) },  // tier 3 — a clean turn ends here
});
```

Child `supervisor.*` and `agent.*` events **bubble up unmodified under their own identity** — subscribers filter the bubbled stream by namespace. The orchestrator's own events are session-scoped: `turn.starting`, `session.loaded`, `drift.checked`, `lock.waiting`, `history.windowed`, `turn.routed`, `turn.streaming`, `checkpoint.persisted`, `compaction.suggested`, `compaction.applied`, `compaction.failed`, and the terminals `turn.completed` / `turn.failed` / `turn.cancelled` / `turn.awaiting-input`.

## Commands

`orchestrator.command(name, args)` invokes a typed built-in. v1 ships exactly one — `compact`:

```ts
const compaction = await supportBot.command("compact", {
  sessionId: "user-42",
  history: priorTurns,
});
// { summary, replacesFromIndex, replacesToIndex }
```

The command map is open for module augmentation — declaring extra keys in your own `.d.ts` widens it without a framework release.

## Composing — `asTool()`

An orchestrator wraps as a tool so an outer agent can drive a whole session inside its tool-call loop:

```ts
const supportTool = supportBot.asTool({
  description: "Handle a customer support conversation turn",
  inputSchema: v.object({ message: v.string() }),
  sessionScope: "fresh",   // "fresh" (default) — new session per call
});

const concierge = ai.agent({ model, tools: [supportTool] });
```

`sessionScope: "fresh"` (default) opens a brand-new session per tool call.

`sessionScope: "shared"` joins an **existing** session — but the id is bound by the developer, never by the model. A `sessionId` is bearer-equivalent to full read/write on that session, so before 4.15.0 it was read straight out of the model-visible tool-call payload (a documented pattern), and any prompt injection reaching the outer agent — a summarized document, a poisoned tool result — could say "continue session `<victim-id>`" and splice an attacker-directed turn into a stranger's live conversation. As of 4.15.0 that channel is closed: `"shared"` requires the new `session` option, resolved **out-of-band** of the model-visible schema, either a literal id fixed at construction or a resolver reading the invocation's `ToolContext` (the same out-of-band channel `signal` / `artifacts` already travel on):

```ts
const supportTool = supportBot.asTool({
  description: "Continue this customer's support session",
  inputSchema: v.object({ message: v.string() }),
  sessionScope: "shared",
  session: (ctx) => String(ctx?.artifacts?.supportSessionId), // developer-controlled, not model-visible
  // or a fixed id: session: "sess_42",
});
```

Building a `"shared"` tool without `session` throws at construction. `sessionId` / `history` in the tool-call payload are stripped, not honored, so a model can no longer redirect the join target even if it tries. The pre-4.15.0 payload-driven behavior is still reachable behind `unsafeAllowModelSessionId: true` — only for a fully trusted outer context where the caller independently verifies session ownership.

## Memory

An orchestrator can recall and accumulate **memory** across turns — see [Memory](/v/latest/ai/architecture-concepts/memory/). Wire a `memory` store and the orchestrator recalls relevant memories before routing (injecting them into `ctx.context[injectKey]`) and remembers the settled turn outcome afterward:

```ts
ai.orchestrator({
  name: "assistant",
  intents, route,
  memory: ai.memory({
    semantic: { embedder, store },
  }),
});
```

Omit `memory` and behavior is unchanged — orchestrators without memory work exactly as before.

## Related

- [Run orchestrator](/v/latest/ai/orchestration/run-orchestrator/) — the full config surface, resume, drift recovery, production boot-drain.
- [Supervisors](/v/latest/ai/architecture-concepts/supervisors/) — the engine the orchestrator delegates to.
- [Memory](/v/latest/ai/architecture-concepts/memory/) — working + semantic recall across turns.
- [Persist AI data](/v/latest/ai/reliability/persist-ai-data/) — checkpoint vs snapshot stores.
