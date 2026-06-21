---
title: "Recipe — Stateful refund support bot"
description: A multi-turn refund bot built on ai.orchestrator — one session per customer, state that survives across turns, history compaction, and a boot-drain resume loop.
sidebar:
  order: 20
  label: "Stateful support bot"
---

A customer opens a chat: "I want a refund for order A-7711." Three turns later they're still talking to the same bot, which remembers the order it already looked up, the refund it already classified, and the policy it already quoted. Between turns the process can crash and restart — when the customer sends turn four, the session rehydrates as if nothing happened.

That is exactly the job of `ai.orchestrator()`: a **session-state manager wrapped around a supervisor**. Each `execute()` call is ONE turn against a named `sessionId`. The session's accumulated state, drift signature, and compaction progress live in a `CheckpointStore` between calls — your process stays stateless.

This recipe builds that bot end to end: per-turn state, dev-passed history, auto-compaction after a long conversation, and a startup loop that drains any session interrupted mid-turn.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The session state

The orchestrator accumulates a typed state object across turns. Each intent contributes a slice; the merged result is what gets checkpointed.

```ts
type SupportState = {
  category?: "refund" | "shipping" | "other";
  order?: { id: string; total: number; status: string };
  refundEligible?: boolean;
  reply?: string;
};
```

## The intents

Four dispatchable units. `classify` and `compose` are agents; `lookup` and `decide` are plain callbacks (deterministic-route mode allows bare async functions). Each declares the state slice it owns via an `output` schema, so only validated keys merge into session state.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { ordersRepo } from "./repos";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const classifyAgent = ai.agent({
  name: "classify-intent",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You triage customer support messages.")
    .instruction("Classify the message into one of: refund, shipping, other."),
  output: v.object({ category: v.enum(["refund", "shipping", "other"]) }),
});

const composeAgent = ai.agent({
  name: "compose-reply",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You are a warm, concise refund support agent for Acme Corp.")
    .instruction("Write the customer-facing reply. Be specific about the order and the decision."),
  output: v.object({ reply: v.string() }),
});

const intents = {
  classify: {
    agent: classifyAgent,
    description: "First-pass message classifier.",
    placeholders: (ctx) => ({ message: ctx.input }),
    output: v.object({ category: v.enum(["refund", "shipping", "other"]) }),
  },
  lookup: {
    run: async (ctx) => {
      const orderId = String(ctx.input).match(/[A-Z]-\d+/)?.[0];
      if (!orderId) return { order: undefined };
      const order = await ordersRepo.find(orderId);
      return { order };
    },
    description: "Fetch the order referenced in the message.",
    output: v.object({
      order: v
        .object({ id: v.string(), total: v.number(), status: v.string() })
        .optional(),
    }),
  },
  decide: {
    run: (ctx) => {
      const order = (ctx.state as SupportState).order;
      // Acme policy: refundable while still "processing".
      return { refundEligible: order?.status === "processing" };
    },
    description: "Apply the refund-eligibility policy to the looked-up order.",
    output: v.object({ refundEligible: v.boolean() }),
  },
  compose: {
    agent: composeAgent,
    description: "Write the final reply from the accumulated state.",
    output: v.object({ reply: v.string() }),
  },
} satisfies Record<string, unknown>;
```

## The orchestrator

`route` runs once per turn and walks the pipeline deterministically: classify on the first turn, then lookup, decide, and compose. `END` stops the turn. Because each step needs the previous step's state, `iterate: true` lets a single turn loop through all four intents inside an internal supervisor — which is why a `snapshotStore` is required.

```ts
import { END } from "@warlock.js/ai";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  version: "2024.06-refund-policy", // metadata only — bump it on purpose (see drift note)
  intents,
  // Deterministic per-iteration pipeline.
  route: (ctx) => {
    const state = ctx.state as SupportState;
    if (ctx.iteration === 0) return "classify";
    if (state.category !== "refund") return "compose"; // hand non-refunds straight to a reply
    if (!state.order) return "lookup";
    if (state.refundEligible === undefined) return "decide";
    if (!state.reply) return "compose";
    return END;
  },
  iterate: true, // one turn loops through the pipeline; requires snapshotStore
  maxIterations: 6,
  historyWindow: { agents: 20 }, // cap what each agent sees of the running transcript
  summarize: {
    afterTurns: 12, // start compacting once the conversation gets long
    keep: 6, // keep the 6 most recent messages verbatim
    summarizer: openai.model({ name: "gpt-4o-mini" }), // cheap model writes the memo
    onCompact: async (compaction, { sessionId }) => {
      // Apply the produced summary to YOUR message store.
      await messageStore.applyCompaction(sessionId, compaction);
    },
  },
  keepSnapshots: 100, // turn checkpoints retained per session
  checkpointStore: ai.checkpoint.pg({ client: pool }),
  snapshotStore: ai.snapshot.pg({ client: pool }),
});
```

## One turn

Every `execute()` call names the `sessionId` it acts on and re-supplies the prior `history`. The framework owns session *state*, not the raw message log — that stays in your store, and you pass it back each call.

```ts
import { ai } from "@warlock.js/ai";
import type { Message } from "@warlock.js/ai";

async function handleMessage(sessionId: string, userMessage: string) {
  // Load the running transcript from YOUR store.
  const history: Message[] = await messageStore.load(sessionId);

  const result = await supportBot.execute(userMessage, {
    sessionId,
    history,
    context: { requestId: crypto.randomUUID() }, // request-scoped, never persisted
    signal: AbortSignal.timeout(60_000),
  });

  // execute() never throws on a runtime failure — it returns a typed error.
  if (result.error) {
    logger.error("support turn failed", {
      sessionId: result.sessionId,
      code: result.error.code,
    });
    return { reply: "Sorry — something went wrong. Please try again." };
  }

  // Persist the turn into your own message log.
  await messageStore.append(sessionId, [
    { role: "user", content: userMessage },
    { role: "assistant", content: result.data?.reply ?? "" },
  ]);

  // A turn may have compacted history. When you supply `onCompact`, the
  // orchestrator already applied it for you, so `result.compaction` is absent.
  // Without `onCompact`, apply it here instead:
  if (result.compaction) {
    await messageStore.applyCompaction(result.sessionId, result.compaction);
  }

  return { reply: result.data?.reply ?? "" };
}
```

`result.report.status` is `"completed"` for a settled turn. The orchestrator adds one non-terminal status, `"awaiting-input"` — the session is paused waiting for the next user turn. Code that branches on `status === "completed"` must treat `"awaiting-input"` as *the session continues*, not a failure:

```ts
if (result.report.status === "awaiting-input") {
  // Prompt the user for the next turn — do NOT close the session.
}
```

## Three turns, one session

The point of the orchestrator is that `handleMessage` above is the *whole* per-turn surface — call it once per user message against the same `sessionId` and the state accumulates. Here is the same session over three turns. Two things move between turns: the `sessionId` (constant — it names the session) and the `history` array (grows — you load it from your store each call). Everything else — `category`, `order`, `refundEligible` — lives in the checkpoint and rehydrates on its own.

```ts
const sessionId = `support:${customer.id}`; // stable per customer

// ── Turn 1 ─────────────────────────────────────────────────
// history is empty for a brand-new session.
const t1 = await supportBot.execute("I want a refund for order A-7711.", {
  sessionId,
  history: await messageStore.load(sessionId), // []
});
// The turn looped classify → lookup → decide → compose internally.
// Checkpoint now holds: { category: "refund", order: { id: "A-7711", ... },
//                         refundEligible: true, reply: "..." }
// t1.report.status === "awaiting-input"  (session continues)
// t1.data?.reply  → "Good news — order A-7711 is still processing, so it's
//                    eligible for a refund. Want me to start it?"
await messageStore.append(sessionId, [
  { role: "user", content: "I want a refund for order A-7711." },
  { role: "assistant", content: t1.data?.reply ?? "" },
]);

// ── Turn 2 ─────────────────────────────────────────────────
// history now carries turn 1; the bot never re-looks-up A-7711 because the
// order already sits in the rehydrated session state.
const t2 = await supportBot.execute("Yes please, and how long does it take?", {
  sessionId,
  history: await messageStore.load(sessionId), // [user, assistant] from turn 1
});
// route() sees state.order present + state.refundEligible set, so it skips
// straight to `compose`. No second lookup, no re-classification.
// t2.data?.reply → "Started the refund for A-7711 — it lands in 3–5 business days."
await messageStore.append(sessionId, [
  { role: "user", content: "Yes please, and how long does it take?" },
  { role: "assistant", content: t2.data?.reply ?? "" },
]);

// ── Turn 3 ─────────────────────────────────────────────────
// The customer pivots off the refund. A `state` patch shallow-merges over the
// rehydrated session state for THIS turn — pinning category to "other" so
// route() sends an address change straight to `compose`, skipping a refund
// re-classification.
const t3 = await supportBot.execute("Actually, can you also update my address?", {
  sessionId,
  history: await messageStore.load(sessionId), // turns 1 + 2
  state: { category: "other" }, // Partial<SupportState>, shallow-merged
});
// t3.data?.reply → "Sure — what's the new shipping address?"
```

The `state` patch on turn 3 is the only way the caller writes into session state directly; it is shallow-merged over the loaded checkpoint before `route` runs (`OrchestratorExecuteOptions.state: Partial<SupportState>`). Everything else is produced by the intents.

## Resume after a crash — the boot-drain loop

With `iterate: true`, a turn can be interrupted mid-flight (the process dies between two internal-supervisor iterations). The internal run state lives in the `snapshotStore`; the session state lives in the `checkpointStore`. On startup, enumerate every known session and `resume()` it. `resume()` returns `null` when there is nothing in flight — a harmless no-op — so it is safe to call for every session.

```ts
async function drainInterruptedSessions() {
  const store = ai.checkpoint.pg({ client: pool });

  // The checkpoint store can enumerate session ids for the orchestrator.
  const sessionIds = (await store.list?.(supportBot.name)) ?? [];

  for (const sessionId of sessionIds) {
    const result = await supportBot.resume(sessionId, {
      context: { resumedAt: new Date().toISOString() },
    });

    if (result && !result.error) {
      logger.info("drained interrupted session", { sessionId });
    }
  }
}

// Call once during boot, after the pool is connected.
await drainInterruptedSessions();
```

`resume()` re-supplies the request-scoped `context` (it is never persisted) and rehydrates state from the checkpoint. It runs the same drift check as `execute()` — see below.

## Compaction — bounding history growth

A refund thread can run for dozens of turns. The session *state* stays small (it's the `SupportState` accumulator), but the `history` you replay each turn grows without bound. `summarize` is the post-turn compaction policy that keeps it in check. Re-reading the config block above:

```ts
summarize: {
  afterTurns: 12, // fire once turnIndex >= 12
  keep: 6,        // leave the 6 most recent messages verbatim
  summarizer: openai.model({ name: "gpt-4o-mini" }), // cheap model does the memo
  onCompact: async (compaction, { sessionId }) => {
    await messageStore.applyCompaction(sessionId, compaction);
  },
},
```

What each knob does, verified against `SummarizeConfig`:

- **`afterTurns`** is a count-based trigger: compaction runs after a turn settles once `turnIndex >= afterTurns`. Below the threshold nothing fires.
- **`keep`** is how many of the most-recent messages stay verbatim. The summarizer collapses everything *before* the kept tail into one synthetic `system` memo. With `keep: 6` and a 20-message history, messages `0..13` become one memo and `14..19` survive untouched.
- **`summarizer`** is the model that writes the memo — deliberately the cheap model, never your specialists. Omit it and you get a degenerate placeholder memo (`"Summary of N prior message(s)."`), which is only useful as a wiring smoke-test.

The produced value is a `CompactionResult`:

```ts
type CompactionResult = {
  summary: Message;          // the system memo that replaces the range
  replacesFromIndex: number; // inclusive start in YOUR history array
  replacesToIndex: number;   // inclusive end
};
```

Because the framework never owns your message log, *applying* the compaction is your store's job. With `onCompact` configured, the orchestrator calls it for you after the memo is built — so `result.compaction` is **absent** on that turn (you already handled it). Without `onCompact`, the orchestrator instead surfaces `result.compaction` for you to apply inline. A correct `applyCompaction` splices the inclusive range out and drops the memo in its place:

```ts
class MessageStore {
  async applyCompaction(sessionId: string, compaction: CompactionResult) {
    const messages = await this.load(sessionId);

    // Replace the inclusive [from..to] range with the single summary memo.
    const next = [
      ...messages.slice(0, compaction.replacesFromIndex),
      compaction.summary,
      ...messages.slice(compaction.replacesToIndex + 1),
    ];

    await this.save(sessionId, next);
  }
}
```

:::note[Compaction never blocks the turn]
A summarizer or `onCompact` failure is skip-and-log: the turn still settles, history is left unchanged, and the orchestrator returns no compaction for that turn. Compaction is best-effort — it never fails a customer's reply.
:::

## Tuning the history window

Compaction bounds how big `history` *grows*; `historyWindow` bounds how much of it each consumer actually *sees* per turn. The two are independent — windowing is applied to the dev-supplied `history` on every turn, before any agent runs, and it never mutates your store.

There are two role-level windows. The config above only set `agents`; the full shape is:

```ts
historyWindow: {
  router: 5,   // what an LLM router sees when deciding the route
  agents: 20,  // what each dispatched intent/agent sees
},
```

- Each value is either a **number** (keep the last N messages, chronological order preserved) or a **callback** `(messages: Message[]) => Message[]` for full control — the escape hatch for token-counting or semantic windowing.
- When a role is omitted, the framework default applies: **5 for the router, 15 for agents**. This recipe uses `route` (a deterministic callback, not an LLM router), so the `router` window is moot here — it only matters once you switch to `router:`.
- Keep `agents` generous enough that `compose` can reference the actual back-and-forth, but small enough to stay inside the model's context once a thread runs long. `agents: 20` with `summarize.keep: 6` means a long session shows the agent: the compaction memo, then up to ~19 recent live messages.

A token-aware window is just a callback:

```ts
historyWindow: {
  agents: (messages) => {
    let budget = 4000; // rough token budget
    const kept: typeof messages = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const cost = estimateTokens(messages[i]);
      if (budget - cost < 0) break;
      budget -= cost;
      kept.unshift(messages[i]);
    }
    return kept;
  },
},
```

:::caution[Swapping a number for a callback drifts the signature]
The drift fingerprint records the *shape* of `historyWindow` per role (`number` vs `callback` vs absent), but **not** the value. Tuning `agents: 20` → `agents: 8` is signature-stable — old sessions keep loading. But changing `agents: 20` → `agents: (messages) => …` flips the role from `"number"` to `"callback"` and drifts the signature, refusing old checkpoints until you recover. Pick number-vs-callback up front; tune the number freely afterward.
:::

## Manual compaction outside the auto-trigger

`summarize.afterTurns` fires compaction automatically, but you can also force one with the built-in `compact` command — for example from an admin "trim this session" button:

```ts
const compaction = await supportBot.command("compact", {
  sessionId,
  history: await messageStore.load(sessionId),
});

await messageStore.applyCompaction(sessionId, compaction);
// compaction === { summary, replacesFromIndex, replacesToIndex }
```

## Production notes

:::note[Run the schema migration once]
`ai.checkpoint.pg(...)` and `ai.snapshot.pg(...)` never auto-migrate. Run each store's `schema()` through your own migration tool before first use: `await pool.query(store.schema())`. A single `pg.Pool` can back both stores (and your cache) at once.
:::

:::caution[Drift detection refuses stale sessions]
The orchestrator fingerprints its structure — name, intents map, route/router presence, `evaluate` presence, `initialAgent`, `maxIterations`, `iterate`, and `historyWindow` shape. If you redeploy with a changed shape, loading an old checkpoint throws `OrchestratorDriftError` (`code: "ORCHESTRATOR_DRIFT"`) **synchronously** — nothing dispatches. The error carries `savedSignature`, `currentSignature`, and `sessionId`. Recover by discarding the session, migrating the persisted checkpoint, or passing `{ force: true }` to accept the new signature on the next write. Bake a recovery branch into `handleMessage` rather than letting the throw escape:

```ts
import { OrchestratorDriftError } from "@warlock.js/ai";

try {
  return await supportBot.execute(userMessage, { sessionId, history });
} catch (error) {
  if (error instanceof OrchestratorDriftError) {
    // Config changed since this session was last persisted. Decide per session:
    // here we discard and restart it clean.
    await checkpointStore.delete(supportBot.name, error.sessionId);
    return await supportBot.execute(userMessage, { sessionId, history: [] });
  }
  throw error;
}
```
:::

:::tip[`version` is metadata — bump it intentionally]
The drift signature deliberately **excludes** `config.version` (it's recorded on every checkpoint as metadata but never compared). The two move together by hand, not automatically: when you ship a config change that you *intend* to break old sessions on — a new intent, a different route shape, a policy rewrite — bump `version` alongside it. Drift then fails loudly on the structural change, and the matching `version` tag on the persisted checkpoint tells you exactly which definition wrote each row. Bumping `version` on its own (no structural change) is signature-stable and never triggers drift — it's a label, not a trigger. With `iterate: true`, `version` also partitions in-flight run ids (`${sessionId}.${version}.${turnIndex}`), so a version bump cleanly orphans any mid-turn snapshot from the previous definition instead of resuming it under new rules.
:::

- **History is yours, state is the orchestrator's.** Always pass `history` on every `execute()` call — the framework never persists the raw message log. Keep your message store and the checkpoint store consistent (append the turn's messages only after `execute()` returns clean).
- **`keepSnapshots` bounds the checkpoint table**, not your message log. After each successful save the pg store prunes to the most recent N turns; `"all"` disables pruning. Compaction (`summarize`) is what bounds *history* growth.
- **`AbortSignal.timeout(...)`** on each turn caps a runaway model loop; `maxIterations` caps the in-turn pipeline length. Use both.

## Related

- [Orchestrator with production stores](./orchestrator-production-stores) — wiring `ai.checkpoint.pg` + `ai.snapshot.redis` with dev-owned clients and the migration.
- [Orchestrator as a tool](./orchestrator-as-tool) — nesting this bot inside a concierge agent.
