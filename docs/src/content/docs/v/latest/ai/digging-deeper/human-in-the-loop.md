---
title: "Human in the loop"
description: ai.human.approval gates a tool call to a reviewer (approve/reject/edit) and ai.human.resume re-runs the turn out of process via an InterruptStore.
sidebar:
  order: 10
  label: "Human in the loop"
---

Some tool calls are too consequential to let the model run unattended — issuing a refund, sending an email, deleting a record. `ai.human.*` pauses **before a specific tool call**, routes it to a human, and applies their ruling. Two shapes share one API: an in-process `await` (a reviewer rules while the run is blocked) and a durable suspend-and-resume (the run unwinds, the request is persisted, a reviewer rules out of process hours later).

## When to reach for it

- **Approval gate** — a tool's side-effect is irreversible or sensitive, and a human should sign off per call. Wire `ai.human.approval(...)` as agent middleware.
- **In-process** — the reviewer is reachable synchronously (a CLI prompt, a blocking UI). The handler resolves a decision and the run continues.
- **Durable** — the reviewer is in another process / another hour (a Slack button, a webhook). The handler persists the request and suspends; `ai.human.resume(...)` re-drives the turn once the decision lands.

It is **middleware on the agent**, so it composes with everything else — guardrails, budget, semantic cache. See [Attach middleware](./attach-middleware).

## The three pieces

| Surface | Role |
| --- | --- |
| `ai.human.approval(options)` | The `tool.before` gate. Evaluates a policy; gated calls go to a handler; the decision is applied. |
| `ai.human.resume(id, decision, options)` | Out-of-process, idempotent resume. Loads the persisted interrupt, applies the ruling, optionally re-runs the turn. |
| `ai.human.interrupt.{memory,pg,redis}()` | `InterruptStore` factories — where a suspended request is persisted for durable resume. |

## `ai.human.approval(options)`

Returns an `AgentMiddleware` declaring a single `tool.before` hook. On each tool dispatch it evaluates the policy; an ungated call runs the real tool untouched; a gated call is routed to the handler and the returned decision is applied.

```ts
import { ai } from "@warlock.js/ai";

const support = ai.agent({
  model,
  tools: [refundCustomer, lookupOrder],
  middleware: [
    ai.human.approval({
      policy: { type: "allowlist", tools: ["refundCustomer"], tags: () => ["money"] },
      handler: async (request) => ui.prompt(request), // resolves an ApprovalDecision
    }),
  ],
});
```

### Options

```ts
interface HumanApprovalOptions {
  name?: string;          // middleware name — must be unique per agent (default "human-approval")
  policy: InterruptPolicy; // which tool calls require a human
  handler: ApprovalHandler; // how a gated call reaches a human and yields a decision
  store?: InterruptStore;  // durable persistence (only used in suspend-and-resume mode)
}
```

`lookupOrder` above is never gated — only `refundCustomer` matches the allowlist, so every other tool runs untouched with zero overhead.

### Policies — which calls get gated

`policy` is a discriminated union keyed on `type`:

```ts
// (a) allowlist — gate ONLY the listed tools
{ type: "allowlist", tools: ["refundCustomer"], tags: (name) => ["money"] }

// (b) denylist — gate EVERY tool EXCEPT the listed ones
{ type: "denylist", tools: ["lookupOrder", "search"] }

// (c) predicate — gate when requiresApproval returns truthy
{
  type: "predicate",
  requiresApproval: (ctx) => {
    const args = ctx.args as { amount?: number };
    if ((args.amount ?? 0) > 1_000) return ["money", "high-value"]; // gate + tags
    return false;                                                    // let it through
  },
}
```

For the `predicate` form, the callback receives a read-only `PolicyContext` (`toolName`, `toolDescription`, `args`, `agentName`, `tripIndex`, `sessionId`). Its return value is overloaded:

- `false` (or an **empty** `string[]` — "no rule matched") → the call passes through.
- `true` → gate the call with no tags.
- a non-empty `string[]` → gate the call **and** use the array as `context.tags`.

For the list variants, the optional `tags(toolName)` callback derives the tags surfaced on `request.context.tags` — a reviewer surface can group or prioritize on them.

### Decisions — what the reviewer returns

The `handler` returns (sync or as a promise) an `ApprovalDecision`, a union keyed on `type`:

```ts
type ApprovalDecision =
  | { type: "approve" }                              // run the real tool, args unchanged
  | { type: "reject"; reason: string }               // short-circuit; model sees a typed error
  | { type: "edit"; args: unknown; reason?: string }; // run the tool with replaced args
```

- **`approve`** — the gate returns and the real tool runs with the model's original arguments.
- **`reject`** — the gate short-circuits an `ApprovalRejectedError` onto the failed tool result. The reviewer's `reason` reaches the model on the next trip as a `role: "tool"` message, so the model can **self-correct** — exactly the existing tool-error feedback path.
- **`edit`** — the gate rewrites the pending arguments to `decision.args`, then lets the real tool run with the edited args. The tool's own schema validation still applies, so a bad edit surfaces as an ordinary tool error.

### The `ApprovalRequest` a handler sees

```ts
interface ApprovalRequest {
  interruptId: string;        // stable id; durable mode keys the store on it
  toolName: string;
  toolDescription?: string;
  args: unknown;              // the exact args the model produced
  context: {
    agentName: string;
    tripIndex: number;        // which model round-trip produced the call
    sessionId?: string;
    originalInput?: string;   // the run's original prompt — re-used on resume
    tags?: string[];          // from the policy match
  };
  requestedAt: string;        // ISO-8601
}
```

### The middleware never throws out of the pipeline

Every outcome — skip, approve, reject, edit, suspend — returns normally. `reject` and durable-suspend short-circuit a **failed** `ToolInvokeResult` carrying a typed `AIError`, which the agent dispatch funnels onto `result.error`. So `agent.execute()` still **never throws**; you branch on `result.error`:

```ts
const result = await support.execute("Refund my last order");

if (result.error instanceof ApprovalRejectedError) {
  console.log(`${result.error.toolName} rejected: ${result.error.reason}`);
}
```

Only a *handler bug* (a non-sentinel throw) propagates, and even then it lands on `result.error`.

## Durable mode — pause, persist, resume

In-process `await` only works while the run is blocked. For a reviewer who rules minutes or hours later in another process, the run must **unwind** and the request must be **persisted**.

### Step 1 — the handler persists and suspends

Configure a `store`, then have the handler write the request to it and throw `InterruptSuspendedError`:

```ts
import { ai, InterruptSuspendedError } from "@warlock.js/ai";

const store = ai.human.interrupt.memory();

const support = ai.agent({
  model,
  tools: [refundCustomer],
  middleware: [
    ai.human.approval({
      policy: { type: "allowlist", tools: ["refundCustomer"] },
      store,
      handler: async (request) => {
        // Persist the pending interrupt out-of-band…
        await store.save({
          interruptId: request.interruptId,
          request,
          status: "pending",
          savedAt: new Date().toISOString(),
        });
        await notifyReviewer(request); // Slack message, email, queue, …

        // …then suspend the run. The middleware recognizes its OWN sentinel.
        throw new InterruptSuspendedError("Awaiting human approval", {
          interruptId: request.interruptId,
        });
      },
    }),
  ],
});
```

The middleware catches its own `InterruptSuspendedError`, short-circuits a failed result carrying it, and the run ends. The caller reads the id off `result.error`:

```ts
const result = await support.execute("Refund order #4821", { sessionId: "sess_42" });

if (result.error instanceof InterruptSuspendedError) {
  return { status: "awaiting-approval", interruptId: result.error.interruptId };
}
```

### Step 2 — resume out of process

Hours later, in a webhook handler, apply the reviewer's decision with `ai.human.resume(interruptId, decision, options)`:

```ts
// Re-run the turn with the decision pre-seeded:
const outcome = await ai.human.resume(
  interruptId,
  { type: "edit", args: { amount: 5 } },
  { store, agent: support },
);

if (outcome.type === "applied" && outcome.result) {
  console.log(outcome.result.text); // the completed re-run
}
```

`resume` loads the `PendingInterrupt`, validates the decision, **deletes the record**, then (when an `agent` is supplied) re-executes the original turn with the decision **pre-seeded** — so the gated tool call this time resolves to the ruling instead of pausing again. The original prompt is recovered from `request.context.originalInput` unless you pass `input` to override.

> **Durable v1 model — re-run, not mid-flight suspend.** Resume re-executes the turn from the top with the decision seeded; it does **not** rehydrate an in-flight supervisor at the exact suspended step. Keep the gated tool deterministic up to the gate, or pass a fresh `input` that reflects what already happened.

### `ResumeOptions` and `ResumeResult`

```ts
interface ResumeOptions<TOutput = unknown> {
  store: InterruptStore;                       // required — where the interrupt lives
  agent?: AgentContract<TOutput>;              // omit for apply-only (no re-run)
  input?: string;                              // override the re-run prompt
  executeOptions?: AgentExecuteOptions<TOutput>; // forwarded to agent.execute on re-run
}

type ResumeResult<TOutput = unknown> =
  | { type: "applied"; interruptId: string; decision: ApprovalDecision; result?: AgentResult<TOutput> }
  | { type: "already-resolved"; interruptId: string };
```

**Two shapes:**

- **apply-only** — omit `agent`. `resume` loads, validates, deletes, and returns `{ type: "applied", decision }` for a caller-owned re-drive (e.g. a custom transport). No turn is re-run.
- **re-run** — pass `agent`. `resume` additionally re-executes the turn; the `AgentResult` rides `outcome.result`.

**Idempotent.** A second resume of an already-resolved (deleted) or never-raised interrupt is a no-op — it returns `{ type: "already-resolved" }` without re-applying the decision or re-running the turn. The record is deleted *before* the re-run, so even a re-run that itself raises a fresh interrupt cannot collide with the one being resolved. Webhook retries are safe.

`resume` also validates the decision payload (a webhook can hand it anything): a `reject` without a string `reason`, an `edit` without `args`, or an unknown `type` throws a `TypeError` loudly rather than mis-driving the re-run.

## Interrupt stores — `ai.human.interrupt.{memory,pg,redis}()`

All three implement the same `InterruptStore` contract (`save` / `load` / `delete` / optional `list` / `schema`), shaped like the orchestrator's `SnapshotStore` so a single `pg.Pool` or redis client can back both.

```ts
interface InterruptStore {
  save(record: PendingInterrupt): Promise<void>;
  load(interruptId: string): Promise<PendingInterrupt | undefined>;
  delete(interruptId: string): Promise<void>;
  list?(prefix?: string): Promise<string[]>;
  schema(): string; // DDL string for stores with a table; "" otherwise
}
```

### Memory

Pure in-process `Map`, zero dependencies. Good for tests and single-process apps where the reviewer rules within the process lifetime.

```ts
const store = ai.human.interrupt.memory();
```

### Postgres (lazy optional `pg` peer)

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = ai.human.interrupt.pg({ client: pool });

// Once, via your migration tooling — the store NEVER auto-migrates:
await pool.query(store.schema());
```

Pass `{ client }` (a `pg.Pool` / `pg.Client` — `@warlock.js/ai` never imports `pg` in that case) **or** `{ connectionString }` and let the store lazily `import("pg")` to build its own pool. `table` defaults to `warlock_ai_human_interrupts` and must be a safe SQL identifier (`[A-Za-z_][A-Za-z0-9_]*`). When `pg` is absent, a curated install string surfaces on first use, never at import.

### Redis (lazy optional `redis` peer)

```ts
import { createClient } from "redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const store = ai.human.interrupt.redis({ client });
```

Pass `{ client }` (a connected redis client) **or** `{ url }` to let the store lazily `import("redis")`, build, and connect its own. `prefix` defaults to `warlock:ai-human:interrupt:`. `schema()` returns an empty string (Redis needs no migration); `list()` is backed by a self-maintained id index since the structural client surface exposes no `SCAN`.

> **Optional peers.** `pg` and `redis` are **not** hard dependencies. A memory-only app never installs either, and importing `@warlock.js/ai` never forces them to resolve. The driver loads only the first time a pg/redis store actually does IO.

## Lifecycle at a glance

1. Model produces a tool call.
2. `tool.before` runs the policy. Not gated → the real tool runs.
3. Gated → build an `ApprovalRequest`, call the handler.
4. **In-process**: handler resolves a decision → approve / reject / edit applied immediately.
5. **Durable**: handler persists the request and throws `InterruptSuspendedError` → run unwinds, caller reads `result.error.interruptId`.
6. Reviewer rules later → `ai.human.resume(id, decision, { store, agent })` re-runs the turn with the decision pre-seeded; the gate resolves to the ruling.

## Errors

Both surface via `result.error` like every other `AIError` — they never escape `execute()`:

- **`ApprovalRejectedError`** (`code: "APPROVAL_REJECTED"`) — carries `reason` and `toolName`. The model also sees `reason` on the next trip and can self-correct.
- **`InterruptSuspendedError`** (`code: "INTERRUPT_SUSPENDED"`) — carries `interruptId`, the key a later `resume` uses.

```ts
import { ApprovalRejectedError, InterruptSuspendedError } from "@warlock.js/ai";
```

## Related

- [Attach middleware](./attach-middleware) — how approval composes with budget, guardrail, cache; ordering invariants.
- [Guardrails](./guardrails) — automated content gating (`escalation.onBlock` can hand off to a human-review hook).
- [Run agent](../the-basics/run-agent) — the agent the gate wraps; `result.error` handling.
- [Define tools](../the-basics/define-tools) — the tools a policy gates.
