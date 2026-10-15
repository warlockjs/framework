---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Memory"
description: ai.memory — a provider-neutral agent memory store with working, semantic, episodic, and procedural tiers.
sidebar:
  order: 7
  label: "Memory"
---

`ai.memory()` builds a **provider-neutral agent memory store** — a single place to hold and retrieve what an agent or orchestrator should remember. It does NOT mutate prompts. It returns scored memories; *where* you surface them stays your call, so the injection point is always explicit.

Four tiers ship in 4.3.0:

| Tier | What it holds | Retrieval | Durability |
| --- | --- | --- | --- |
| **working** | In-run scratch threaded across turns of one session | Insertion order (recency proxy score) | Volatile, size-bounded (`maxItems`, default `1000`) |
| **semantic** | Durable *facts* stored as embeddings | Cosine similarity via the cache driver's `.similar()` | Persisted in a `@warlock.js/cache` driver |
| **episodic** | Durable *events* — a timestamped log | Similarity **blended with recency** (recent episodes rank higher) | Persisted in a `@warlock.js/cache` driver |
| **procedural** | Durable *how-tos* — learned procedures | Similarity **blended with reinforcement** (well-used procedures rank higher) | Persisted in a `@warlock.js/cache` driver |

`working` + `semantic` are the everyday pair; `episodic` and `procedural` add time- and usage-aware recall on top of the same embedder-and-cache delegation. All three vector tiers are wired the same way (embedder + store); they differ only in how they *score* a hit.

> **Still deferred** — decay / forgetting (TTL-based relevance falloff, eviction). The four tiers above are the full 4.3.0 surface. The `MemoryTier` union widened from `"working" | "semantic"` to add `"episodic" | "procedural"` — a non-breaking change.

## Delegated, not reinvented

Memory mirrors the `semanticCache` middleware's model exactly: it does **not** implement similarity search itself. It stores embeddings in a `@warlock.js/cache` driver and retrieves them with the driver's native `.similar()`. You supply the embedder (text → vectors) and the store (indexes them).

```ts
import { ai } from "@warlock.js/ai";
import { MemoryCacheDriver } from "@warlock.js/cache";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const store = new MemoryCacheDriver();
store.setOptions({});

const mem = ai.memory({
  semantic: {
    embedder: openai.embedder({ name: "text-embedding-3-small" }),
    store,                      // falls back to ai.config({ defaultStore }) when omitted
  },
});
```

- **Dev / tests** — `new MemoryCacheDriver()` (zero config, O(N) scan).
- **Production** — a driver with a real ANN index: `pg` with pgvector, `redis` with RediSearch.

Drivers without similarity support throw `CacheUnsupportedError` from `set({ vector })` / `similar()`.

## The contract

```ts
await mem.remember({ text: "User prefers metric units.", tier: "semantic" });

const hits = await mem.recall("which units does the user like?", { k: 3 });
//    ^? RecalledMemory[] — { id, text, tier, score, metadata? }

await mem.clear("working");   // end-of-session cleanup; semantic recall survives
```

- **`remember(items)`** — store one or many. Each lands in its `tier` (or the factory's `defaultTier`). Re-remembering an item whose id (explicit or text-derived) already exists **overwrites in place** rather than duplicating.
- **`recall(query, options?)`** — returns `RecalledMemory[]` scored and ordered by descending relevance. Queries every enabled tier by default; `options.tier` narrows to one, `options.k` caps the count, `options.threshold` raises the semantic floor. Returns `[]` when nothing clears the threshold — never throws on "no hits".
- **`clear(tier?)`** — no arg clears every tier; a `tier` clears just one.

`score` is in `[0, 1]` for **every** tier — cosine similarity (semantic), a recency proxy (working, most-recent = 1), similarity blended with recency (episodic), or similarity blended with reinforcement (procedural) — so you can sort a mixed recall set on one field without special-casing the tier.

## Episodic & procedural tiers

Both are durable, embedder-backed tiers (wired exactly like `semantic` — `{ embedder, store? }`), but they re-rank hits so retrieval reflects *time* and *use*, not just similarity:

```ts
const mem = ai.memory({
  semantic:   { embedder, store },                          // facts
  episodic:   { embedder, store, recencyWeight: 0.3,        // events: similarity × recency
                halfLifeMs: 7 * 24 * 60 * 60 * 1000 },      // an episode's recency halves every 7 days
  procedural: { embedder, store, reinforcementWeight: 0.3 },// how-tos: similarity × reinforcement
});

await mem.remember({ text: "Refunded order 5821 after a cracked-item complaint.", tier: "episodic" });
await mem.remember({ id: "refunds", text: "Escalate refunds over $500 to a human.", tier: "procedural" });
await mem.remember({ id: "refunds", text: "Escalate refunds over $500 to a human.", tier: "procedural" }); // reinforce
```

- **Episodic** stamps each entry with the time it was remembered and decays its recency contribution on an exponential half-life. At equal similarity, a recent episode outranks a stale one. `recencyWeight: 0` opts back into pure-similarity (semantic-style) ranking; the similarity `threshold` still gates relevance, so recency never surfaces an irrelevant-but-recent episode. (`now` is injectable for deterministic tests/replay.)
- **Procedural** keeps a per-procedure use count: re-remembering a procedure (same `id`, or same text → same derived id) **reinforces** it, nudging it up the ranking with diminishing returns. Strengthen a procedure by remembering it again after it works.

Each vector tier defaults to its own namespace (`ai.memory.semantic` / `ai.memory.episodic` / `ai.memory.procedural`) so they never collide when sharing one cache driver — override per tier with `namespace`.

## Configuration

```ts
const mem = ai.memory({
  name: "support-mem",         // logs + working-tier scope key
  working: { maxItems: 2_000 },// default true → maxItems: 1000; set false for semantic-only
  semantic: { embedder, store, namespace: "ai.memory" },
  defaultTier: "working",      // where a remember() without `tier` lands
  k: 5,                        // default recall count
  threshold: 0.7,              // default semantic similarity floor [0,1]
});
```

At least one tier must be enabled — enabling neither is a construction-time error (a memory with no tiers can't store or recall). The working tier is on by default; the `semantic`, `episodic`, and `procedural` tiers each activate only when their config is supplied.

### The working tier is size-bounded

`working` holds everything it's told in **process** memory for the lifetime of the `ai.memory()` instance — and `ai.orchestrator({ memory })` resolves that instance once and reuses it for every session, for as long as the process runs. With no cap, a memory-backed orchestrator with `remember` on (the default) is a cheap memory-exhaustion path for anything internet-facing: one permanent entry per request, forever.

`working: { maxItems }` (default `1000`) evicts on overflow, **FIFO over insertion order, not LRU** — deliberately, since recall on this tier already reverses insertion order and slices the newest `k` without ever reordering, so the oldest entries are exactly the ones a bounded recall would never surface anyway. `maxItems` must be an integer `>= 1`; there is no unbounded escape hatch. Raise it for a long-lived single-tenant process, and lean on the semantic / episodic tiers (which delegate retention to a `CacheDriver`, not process memory) for anything that needs durable, large-scale recall. The bound is global rather than per-scope, so a busy scope can push another scope's older entries out of the buffer — a recall-quality trade-off on a volatile tier, never a disclosure (the isolation check below still applies).

## Isolation — `scope`

One `ai.memory()` instance is normally shared by every caller — built once at boot, passed into `ai.orchestrator({ memory })`, serving every end user. Without isolation, `recall()` has no way to keep user A's remembered turns out of user B's semantically-similar query. `MemoryItem.scope` (on `remember()`) and `RecallOptions.scope` (on `recall()`) are opaque isolation keys, enforced by **exact-equality match inside every tier** — `working`, `semantic`, `episodic`, and `procedural` alike — before hits are scored, merged, or sliced:

```ts
await mem.remember({ text: "User A's account email is a@example.com", scope: "user-a" });

await mem.recall("what is my email?", { scope: "user-b" }); // [] — never sees user A's memory
await mem.recall("what is my email?", { scope: "user-a" }); // user A's own memories
await mem.recall("what is my email?");                       // only the UNSCOPED pool — omitting scope is not a wildcard
```

Identical text remembered under two different scopes stays two independent entries (including the procedural tier's own reinforcement counter). `clear(tier?)` is scope-agnostic — it drops the tier for every scope.

`ai.orchestrator({ memory })` sets this automatically, deriving `"session:<id>"` from the turn's own `sessionId` (see `memory.scope` in the next section). Memories written before adopting scoping are unscoped and stay visible only to unscoped (or explicitly `"shared"`-scoped) recalls.

## Memory in an orchestrator

The orchestrator's `memory` field wires recall + write-back into every turn — recall relevant memories *before* routing (injected into `ctx.context[injectKey]`, default `"memories"`), remember the settled turn outcome *after*:

```ts
ai.orchestrator({
  name: "assistant",
  intents, route,
  memory: {
    store: mem,
    recall: { k: 4, threshold: 0.75, tier: "semantic" },
    remember: true,            // default; cancelled/failed turns never remember (they revert)
    rememberTier: "semantic",  // durably accumulate turns for cross-session recall
    scope: "session",          // default — isolate recall/remember to the executing sessionId
    injectKey: "memories",     // ctx.context.memories — a RecalledMemory[]
  },
});
```

Pass a bare `MemoryContract` for recall + remember with defaults, or the object form above for finer control. `recall.k: 0` disables recall (write-only memory); `remember: false` recalls but never writes (read-only). Memory never mutates the prompt — your route / router / evaluate / dispatch callbacks read `ctx.context[injectKey]` and decide what to do with the recalled text.

`OrchestratorMemoryConfig.scope` defaults to `"session"` — every turn's recall and write-back are keyed off that turn's `sessionId`, so one user's session can never recall another's remembered turns. Set `scope: "shared"` to pool every session into one namespace (the pre-4.15.0 behavior — only safe when every session is trusted to see every other's memories), or `scope: (sessionId) => key` to derive your own boundary, e.g. per tenant.

## Related

- [Orchestrators](/v/v4/ai/architecture-concepts/orchestrators/) — the primary memory consumer.
- [Persist AI data](/v/v4/ai/reliability/persist-ai-data/) — the cache-driver model memory shares.
- [Attach middleware](/v/v4/ai/reliability/attach-middleware/) — `semanticCache`, the sibling delegation.
