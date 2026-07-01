---
title: "Durable execution"
description: Opt-in mid-run crash-resume for agents and planners — durable on the config, a stable runId on execute(), and agent.resume() / planner.resume() to continue from the last settled trip or plan node after a crash.
sidebar:
  order: 17
  label: "Durable execution"
---

`durable` is opt-in mid-run crash-resume for the two long-running primitives — the **agent** and the **planner**. Turn it on, give a run a stable `runId`, and after a process crash `resume(runId)` re-hydrates the persisted state and continues from where it stopped — never re-issuing a settled trip's model call or re-invoking a completed node's capability.

:::caution[Not the same as human-in-the-loop resume]
This is **crash-resume of an in-flight run**: the process died mid-run, you restart, and continue the same trip / plan from an `AgentSnapshot` / `PlannerSnapshot` in a `SnapshotStore`. That is a different verb (`agent.resume` / `planner.resume`) and a different store than [`ai.human.resume`](./human-in-the-loop), which resumes a **gated tool call** hours later after a human rules on a `PendingInterrupt` in an `InterruptStore`. Different trigger (a crash, not a human), different store, different resume.
:::

## Opt in — `durable` on the config

```ts
import { ai } from "@warlock.js/ai";

const writer = ai.agent({
  name: "writer",
  model,
  tools: [searchTool, draftTool],
  durable: {
    store: ai.snapshot.pg({ client: pgPool }), // reuses the ai.snapshot.* stores
    deleteOnComplete: false,                    // default — keep for the completed-run short-circuit + audit
  },
});
```

The `durable` shape is identical on the agent and planner config:

- **`store?`** — a `SnapshotStore`. Falls back to `ai.config({ defaultSnapshotStore })`. When neither resolves, snapshot writes **silently skip** and `resume()` throws.
- **`deleteOnComplete?`** — drop the snapshot once the run completes successfully. Default `false`.

Absent `durable`, there is **zero behavior change** — the loop starts at trip 0 / the first node, never writes a snapshot, and runs byte-for-byte as before.

## Run with a stable `runId`, then resume

The `runId` is the store key. Pass a stable one to `execute()` (or read the generated one off `result.report.runId`) so a later `resume()` can find the snapshot:

```ts
const result = await writer.execute("research X", { runId: "run-42" });

// ...process crashes mid-run, restarts...

const recovered = await writer.resume("run-42");
// continues from the next unsettled trip; recovered.report.status === "completed"
```

Planners are the mirror image — `durable` on the config, `runId` on `execute(goal)`, `planner.resume(runId)`:

```ts
const research = ai.planner({
  name: "research-assistant",
  model,
  capabilities: [
    { name: "search", executable: searchAgent },
    { name: "write", executable: writerAgent },
  ],
  durable: { store: ai.snapshot.pg({ client: pgPool }) },
});

const first = await research.execute("compare A vs B", { runId: "plan-7" });
// ...crash...
const done = await research.resume("plan-7");
```

## Checkpoint granularity

| Primitive | Written | Contains | Resume continues at |
| --- | --- | --- | --- |
| **agent** | after every settled **trip** | `messages`, `trips`, `toolCalls`, `usage`, resolved `systemPrompt` / `responseSchema`, `signature`, `status` | `trips.length` (the next trip index) |
| **planner** | after every settled **plan node** | the frozen `plan`, `executedSteps` ledger, `usage`, child reports, `replanCount`, `signature`, `status` | the unfinished frontier (from `executedSteps`) |

The write happens only where the persisted arrays are mutually consistent — for the agent, after every tool a trip requested has been dispatched and its result appended. A crash **mid-trip** loses only that in-flight trip (never checkpointed), which the resume re-issues cleanly. The planner **never re-calls the planning LLM** on resume — the plan is frozen on the first run; re-asking would burn tokens and risk a plan that no longer matches the ledger. Every field on both snapshots is JSON-serializable, so they round-trip through any `ai.snapshot.{memory,pg,redis}` backend verbatim.

## Idempotency — what does and doesn't re-run

```ts
// Completed run: resume is a no-op that re-returns the stored result.
const again = await writer.resume("run-42"); // runs nothing when status === "completed"
```

- **Completed trips / nodes never re-run their tools.** On agent resume, `trips.length` is the starting trip index — earlier trips' model calls are not replayed and their tool dispatches are not re-invoked. On planner resume, a completed node's capability dispatch is skipped.
- **Usage is never double-counted.** The running `usage` total is restored from the snapshot; only the newly-executed trips / nodes add to it.

:::danger[A crash mid-trip re-runs that trip's tools]
The in-flight trip was never checkpointed, so on resume its tools fire again. **Side-effectful tools — charging a card, sending an email — must be idempotent**, the same caller-responsibility boundary the supervisor and workflow primitives document. Guard them with your own dedupe key, e.g. `${runId}:${toolCallId}`.
:::

## Drift — the definition changed since the snapshot

Every agent / planner carries a structural `signature` (`agent.signature`, computed at factory time), stamped on each snapshot. `resume()` compares the stored signature against the current definition; a mismatch throws before executing anything:

- **agent** covers: model name + provider, sorted tool names, `maxTrips`, whether a default `output` schema is set, and `version`. It does **not** cover system-prompt text, middleware, per-event handlers, placeholders, or `modelOptions` — runtime knobs that don't change a resumable run's shape.
- **planner** covers: name + ordered capability names. A mid-run **re-plan is NOT drift** (the plan changed, not the definition); `replanCount` is persisted so the replan budget survives a resume.

```ts
import { AgentDriftError } from "@warlock.js/ai";

try {
  await writer.resume("run-42");
} catch (error) {
  if (error instanceof AgentDriftError) {
    // The definition changed (a tool was added, the model swapped). Either roll the
    // definition back, or — only when you've verified the change is snapshot-safe:
    await writer.resume("run-42", { force: true }); // bypasses the drift check
  }
}
```

`{ force: true }` is the escape hatch (`PlannerDriftError` mirrors it for planners). `resume()` also throws `AgentExecutionError` / `PlannerFailedError` when no store is configured or no snapshot exists for the `runId`.

## Real-world — a boot-drain resume loop

On restart, resume every run the store still has in flight. Snapshots carry a `status`, so you only resume the live ones:

```ts
const store = ai.snapshot.pg({ client: pgPool });
const runIds = (await store.list?.()) ?? [];

for (const runId of runIds) {
  const snapshot = await store.load(runId);
  if (snapshot?.status === "running") {
    await writer.resume(runId); // completed/failed snapshots short-circuit or re-throw — skip them
  }
}
```

Pair `deleteOnComplete: true` with this loop when you don't need the completed-run audit trail — the store then holds only genuinely-unfinished runs, so the drain never touches settled ones.

Checkpointing costs one store write per settled trip / node — a `JSONB` upsert on `pg`, a `Map` set on `memory` — and a failed checkpoint is surfaced via logs, not thrown: it loses resume-ability from that point but never breaks an otherwise-healthy run. For tests, drive `ai.snapshot.memory()` against a flaky model that throws once, `resume(runId)`, then assert `status === "completed"` and that each side-effecting tool spy fired exactly once.

## Related

- [Human in the loop](./human-in-the-loop) — the OTHER resume: `ai.human.resume` of a gated tool call, not a crash.
- [Persist AI data](./persist-ai-data) — the supervisor / workflow snapshot resume (the sibling `iterate`-style durability), the `ai.snapshot.{memory,pg,redis}` factories, the `SnapshotStore` contract, and the never-auto-migrated `schema()`.
- [Handle errors](./handle-errors) — the typed `AgentDriftError` / `PlannerDriftError` / `AgentExecutionError` / `PlannerFailedError` and how `result.error` surfaces a failed run.
