---
title: "Best Practices — Memory"
sidebar:
  label: "Memory"
description: How to give an agent durable memory without poisoning the prompt — separate working scratch from semantic recall, store facts not transcripts, tune k and threshold for signal, and scope per user/tenant so a shared store never leaks.
---

The pillar this page answers: **what should an agent remember, and how do you put it back in front of the model without drowning the prompt in noise?**

`ai.memory` is not a database you dump everything into. Every memory you recall becomes tokens in the next prompt — tokens you pay for, that dilute the signal the model needs, and that can leak one user's data into another's answer if the store is shared. Good memory is a small set of high-signal, durable facts retrieved at the right moment. This page is the opinionated version of that.

Everything below is grounded in the real `ai.memory` surface — two v1 tiers, **working** (in-run scratch, recalled by recency) and **semantic** (durable cosine recall over a `@warlock.js/cache` vector driver). Episodic and procedural tiers, plus decay / forgetting, are **explicitly deferred to 4.4** — so until then you own eviction yourself (see the last section).

## Separate working scratch from semantic recall

The two tiers exist because they answer different questions. **Working** memory is "what happened earlier in *this* run" — volatile, unscored, recalled by recency. **Semantic** memory is "what do we know about this user across *all* runs" — durable, embedded, recalled by meaning. Picking the wrong tier is the most common memory mistake: it either makes durable facts evaporate, or fills a permanent vector index with throwaway turn-by-turn chatter.

**Do this — route by lifetime.** A within-run note goes to `working`; a fact that must survive the session goes to `semantic`.

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
    store,
  },
  // working stays on by default; new remember() items default to it unless told otherwise.
});

// In-run scratch: which records we already looked up this turn. Gone at session end.
await mem.remember({ text: "Already fetched order #4471 — status: shipped.", tier: "working" });

// Durable fact: survives across sessions, recalled by meaning next week.
await mem.remember({ text: "User is allergic to shellfish.", tier: "semantic" });
```

**Avoid this — one tier for both.** Writing transient lookups to `semantic` permanently bloats the vector index with noise no future run wants; writing durable preferences to `working` loses them the moment the session ends. The tiers are not interchangeable — `score` even means different things (cosine similarity for semantic, a recency proxy for working), so a mixed recall sorts on one field only because each tier earns its place honestly.

> Reach for `defaultTier` to make the common case implicit. If a memory is almost always durable, set `defaultTier: "semantic"` so a bare `remember({ text })` lands there and only the rare scratch note carries `tier: "working"`.

## Remember durable facts and preferences, not raw transcripts

The instinct is to remember the conversation. Don't. A raw transcript is the lowest-signal, highest-token thing you can store: it embeds badly (a whole turn is a blurry vector), it recalls poorly (the query rarely matches the phrasing), and it costs you on every recall. What you actually want back later is the *fact the turn established*, distilled to one line.

**Do this — store the distilled fact.** One claim per memory, phrased the way you'd want to read it back.

```ts
await mem.remember([
  { text: "User prefers metric units.", tier: "semantic" },
  { text: "User is on the Enterprise plan.", tier: "semantic", metadata: { source: "crm" } },
  { text: "User's primary project is named 'Helios'.", tier: "semantic" },
]);
```

One claim per item matters: each is embedded independently, so recall can surface "metric units" without dragging the plan tier and the project name along as dead weight. Use `metadata` for the provenance (source id, timestamp, tags) you want back alongside the text — it round-trips verbatim onto the recalled memory and never touches the embedding.

**Avoid this — dumping the turn.** Storing the back-and-forth verbatim gives you a vector that means everything and therefore nothing, and it pays the token tax twice — once to embed, again on every recall.

```ts
// Anti-pattern: a transcript blob embeds as a blurry, low-signal vector.
await mem.remember({
  text: "User: what plan am I on? Assistant: You're on Enterprise. User: ok and use metric please. Assistant: Got it!",
  tier: "semantic",
});
```

When an orchestrator writes turns back for you, that write is the *settled outcome* (input plus the model's answer), and it is opt-in via `rememberTier` — so the durable accumulation is a deliberate choice, not a default that quietly fills your index:

```ts
const assistant = ai.orchestrator({
  name: "assistant",
  // ...intents, route...
  memory: {
    store: mem,
    recall: { k: 4, threshold: 0.75, tier: "semantic" },
    rememberTier: "semantic", // omit, or set remember: false, to recall-only and never accumulate
  },
});
```

> Re-remembering text whose id (explicit or text-derived) already exists **overwrites in place** rather than duplicating. Lean on this: pass a stable `id` for a fact that gets updated ("user's plan") so the new value replaces the old instead of leaving two contradictory memories to both surface.

## Tune `k` and `threshold` for signal, not recall volume

Recall has two knobs and they pull against each other. `k` caps how many memories come back; `threshold` is the minimum cosine similarity (in `[0, 1]`) a semantic hit must clear. The defaults are deliberately modest — `k: 5`, `threshold: 0.7`. The failure mode is loosening them "to be safe": a low threshold and a high `k` inject a pile of marginally-related memories, and the model now has to ignore six wrong facts to use the one right one.

**Do this — inject a few high-signal memories.** Keep `k` small and the threshold high enough that only genuinely relevant facts clear it.

```ts
// A handful of confidently-relevant memories beats a wall of maybes.
const hits = await mem.recall("what should I cook for the user tonight?", {
  k: 3,
  threshold: 0.78,
});
```

`recall` returns `RecalledMemory[]` ordered by descending `score`, and returns `[]` when nothing clears the threshold — it never throws on "no hits". An empty recall is a feature: the model answers from first principles instead of from a forced, low-confidence match.

**Avoid this — recall everything and hope.** A low threshold with a large `k` is how memory becomes noise.

```ts
// Anti-pattern: floods the prompt with weakly-related memories — tokens spent to confuse the model.
const hits = await mem.recall("what should I cook for the user tonight?", {
  k: 50,
  threshold: 0.3,
});
```

**Do this — restrict the tier when you know which one holds the answer.** Querying both tiers and merging is the default; when a recall is purely durable-fact territory, narrow it so the recency-scored working buffer can't crowd out a semantic hit.

```ts
const prefs = await mem.recall("dietary preferences", { tier: "semantic", k: 3 });
```

> Treat the threshold as a per-domain dial, not a global constant. Tightly-worded facts (a plan name, a unit preference) tolerate a higher floor; fuzzy, conversational recall needs a lower one. Start at the `0.7` default, then watch what actually gets injected and move it.

## Isolate per user or tenant — a shared store must never leak

This is the one that becomes a security incident if you skip it. `ai.memory()` is normally built **once** at boot and shared by every end user (the pattern `ai.orchestrator({ memory })` documents), and every tier — including `working` — enforces isolation the same way, not just `semantic`. If nothing isolates recall, a query for User A can surface User B's allergies, plan, or private project name.

**Do this first — `scope` (4.15.0), the built-in isolation key.** Every `remember()` / `recall()` call takes a `scope`, enforced by exact-equality match **inside** every tier before hits are scored, merged, or sliced — so one shared instance is safe by construction, no per-user `ai.memory()` object required:

```ts
await mem.remember({ text: "Allergic to shellfish.", tier: "semantic", scope: `user:${userId}` });

// Bob's recall can never see Alice's facts — the tier checks scope equality, not just the key.
const hits = await mem.recall("any dietary restrictions?", { scope: `user:${bobId}` });
```

Omitting `scope` is **not** a wildcard — an unscoped recall only ever sees unscoped entries, never a scoped one. `ai.orchestrator({ memory })` derives this automatically from the turn's `sessionId` (`memory.scope`, default `"session"` — see [Architecture — Memory](/v/latest/ai/architecture-concepts/memory/)), so wiring memory into an orchestrator is isolated out of the box; reach for `scope` explicitly only when you call `remember` / `recall` directly, outside an orchestrator turn.

**`namespace` is a complementary, coarser tool** — it physically partitions keys in the underlying `@warlock.js/cache` driver, which is useful for routing different users/tenants to different stores or purging one tenant's data independently of the rest. `scope` is the finer, per-call boundary and the one that keeps one *shared* store's reads honest; use `namespace` on top of it, not instead of it, when you need physical separation:

```ts
function memoryForUser(userId: string) {
  return ai.memory({
    semantic: {
      embedder: openai.embedder({ name: "text-embedding-3-small" }),
      store, // one shared driver is fine — the namespace isolates the keys
      namespace: `user:${userId}`, // every key this memory writes is prefixed here
    },
  });
}

const aliceMemory = memoryForUser("alice");
await aliceMemory.remember({ text: "Allergic to shellfish.", tier: "semantic" });

const bobMemory = memoryForUser("bob");
// Bob's recall can never see Alice's facts — different namespace, different keys.
const hits = await bobMemory.recall("any dietary restrictions?");
```

**Avoid this — no `scope` and no `namespace`.** One shared instance with neither means recall is a cross-user query waiting to leak.

```ts
// Anti-pattern: every caller's memory lands in the same, unscoped key space.
const sharedMemory = ai.memory({
  semantic: {
    embedder: openai.embedder({ name: "text-embedding-3-small" }),
    store,
    // no namespace → all callers collide under the default "ai.memory" prefix
  },
});

await sharedMemory.remember({ text: "Allergic to shellfish.", tier: "semantic" }); // no scope
const hits = await sharedMemory.recall("any dietary restrictions?"); // sees EVERY caller's unscoped facts
```

> The same isolation argument applies to **tenants**. In a B2B app, scope on `tenant:${tenantId}` (or `tenant:${tenantId}:user:${userId}` when you need both axes). Whatever the boundary your product promises — that's the `scope` (and, if you also want physical partitioning, the `namespace`) boundary.

## Don't treat memory as a dumping ground

Tie the threads together: every recalled item is tokens in the next prompt. That single fact governs every decision above. The store will happily accept everything you give it — the cost shows up later, as prompt bloat, as a recall that returns ten near-misses, as latency from a vector index full of throwaway turns.

**Do this — clear the volatile tier at session end** so working scratch never accumulates across runs while durable recall survives.

```ts
// End of a session: drop the in-run scratchpad, keep everything durable.
await mem.clear("working");
```

`clear(tier?)` with no argument wipes every tier; with a `tier` it scopes to one — `clear("working")` is the routine session-teardown call, leaving semantic recall intact.

**Avoid this — letting the durable tiers grow unbounded.** Because **decay / forgetting is still deferred**, nothing evicts a stale semantic (or episodic/procedural) memory for you today. A fact you stored a year ago still embeds, still matches, still costs tokens when it surfaces. Until decay ships, *you* own retention on the durable tiers: store fewer, higher-signal facts; overwrite a changing fact in place via a stable `id` rather than appending a new contradictory one; and periodically prune what no longer holds. The **working** tier is the one exception — it's size-bounded (`working: { maxItems }`, default `1000`, FIFO eviction) precisely because it has no durable backing store and no cap was a memory-exhaustion path for a long-lived shared process; see [Architecture — Memory](/v/latest/ai/architecture-concepts/memory/) for the eviction policy.

> **On the deferred tiers.** `MemoryTier` is intentionally closed to `"working" | "semantic"` in v1 — episodic ("what happened in past runs"), procedural ("how to do a recurring task"), and decay land in **4.4** as a non-breaking widening. Don't simulate episodic memory by dumping transcripts into semantic; that recreates exactly the noise this page warns against. Wait for the real tier.

## See also

- [Use the AI memory skill](/skills/) — the `@warlock.js/ai/skills/use-ai-memory` playbook: `ai.memory({...})`, the two tiers, `remember` / `recall` / `clear`, and the loud-at-construction config rules (the docs site projects every package skill under the `/skills` page).
- [Architecture — Memory](/v/latest/ai/architecture-concepts/memory/) — the two-tier model and where recall is injected.
- [Recipe — A personal assistant that remembers you](/v/latest/ai/recipes/memory-assistant-with-memory/) — working + semantic wired into an orchestrator end to end.
- [Recipe — Semantic recall of past answers](/v/latest/ai/recipes/memory-semantic-recall/) — store Q&A pairs and recall the closest by meaning.
- [Architecture — Orchestrators](/v/latest/ai/architecture-concepts/orchestrators/) — the primary memory consumer and the per-turn recall/remember lifecycle.
