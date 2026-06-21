---
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
| **working** | In-run scratch threaded across turns of one session | Insertion order (recency proxy score) | Volatile |
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
  working: true,               // default true; set false for semantic-only
  semantic: { embedder, store, namespace: "ai.memory" },
  defaultTier: "working",      // where a remember() without `tier` lands
  k: 5,                        // default recall count
  threshold: 0.7,              // default semantic similarity floor [0,1]
});
```

At least one tier must be enabled — enabling neither is a construction-time error (a memory with no tiers can't store or recall). The working tier is on by default; the `semantic`, `episodic`, and `procedural` tiers each activate only when their config is supplied.

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
    injectKey: "memories",     // ctx.context.memories — a RecalledMemory[]
  },
});
```

Pass a bare `MemoryContract` for recall + remember with defaults, or the object form above for finer control. `recall.k: 0` disables recall (write-only memory); `remember: false` recalls but never writes (read-only). Memory never mutates the prompt — your route / router / evaluate / dispatch callbacks read `ctx.context[injectKey]` and decide what to do with the recalled text.

## Related

- [Orchestrators](./orchestrators) — the primary memory consumer.
- [Persist AI data](../digging-deeper/persist-ai-data) — the cache-driver model memory shares.
- [Attach middleware](../digging-deeper/attach-middleware) — `semanticCache`, the sibling delegation.
