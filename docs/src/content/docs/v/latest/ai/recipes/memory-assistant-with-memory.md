---
title: "Recipe — A personal assistant that remembers you"
description: Wire ai.memory (working + semantic tiers) into an orchestrator so a personal assistant recalls user preferences across turns and across sessions.
---

You are building "Atlas", a personal assistant a single user talks to every day. The complaint that ships it to production is always the same: *"I told it last week I'm vegetarian, and it still suggested a steakhouse."* The assistant has no memory beyond the messages you hand it each turn, and you don't want to stuff a user's entire history into every prompt.

This recipe wires `ai.memory` into an orchestrator so Atlas does three things automatically:

1. **Recalls** the preferences most relevant to the current message *before* it answers.
2. **Remembers** the outcome of each turn so a later turn can recall it.
3. Keeps a fast **working** scratchpad for the current session, while durable **semantic** recall survives across sessions via a vector store.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/cache
```

The semantic tier needs an embedder (to turn preferences into vectors) and a vector-capable cache driver (to index and search them). For local development the in-memory driver is enough — it does an O(N) cosine scan with zero infrastructure. Production swaps it for `pg` + pgvector or `redis` + RediSearch without touching the rest of the code.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { MemoryCacheDriver } from "@warlock.js/cache";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const embedder = openai.embedder({ name: "text-embedding-3-small" });

// Dev / local: zero-config in-memory vector store.
const store = new MemoryCacheDriver();
store.setOptions({});
```

## Build the memory store

A `memory` with both tiers enabled gives you the best of both: the **working** tier is an in-run scratchpad recalled in recency order, and the **semantic** tier is durable cosine-similarity recall over the cache driver. The working tier is on by default; the semantic tier activates the moment you pass `semantic`.

```ts
const assistantMemory = ai.memory({
  name: "atlas-user-memory",
  // working: true is the default — in-run scratch for the live session.
  semantic: {
    embedder,
    store,
    // Namespacing lets every user share one driver without collisions.
    namespace: "atlas.user.u-42",
  },
  // New turn outcomes should accumulate durably, not just live for the session.
  defaultTier: "semantic",
  // Recall the 4 most relevant memories, and only ones that actually match.
  k: 4,
  threshold: 0.75,
});
```

Seed a few known preferences up front. `remember` accepts a single item or an array; `metadata` is round-tripped verbatim onto the recalled memory, which is handy for tagging where a preference came from.

```ts
await assistantMemory.remember([
  { text: "The user is vegetarian and avoids all meat and fish.", metadata: { source: "onboarding" } },
  { text: "The user prefers concise, bullet-point answers.", metadata: { source: "onboarding" } },
  { text: "The user lives in Berlin and uses metric units.", metadata: { source: "onboarding" } },
]);
```

## Wire memory into the orchestrator

The orchestrator owns the recall-then-remember lifecycle. Pass the store under `memory` and, before each turn dispatches, the orchestrator recalls the memories relevant to the incoming message and injects them into the per-turn `context` bag under `injectKey` (default `"memories"`). After a clean turn settles, it remembers the outcome.

Your intent reads the recalled set at `ctx.context.memories` as a `RecalledMemory[]` and decides how to surface it — memory never mutates the prompt itself, so the injection point stays explicit.

```ts
import { END } from "@warlock.js/ai";
import type { RecalledMemory } from "@warlock.js/ai";

type AssistantState = {
  reply?: string;
};

const atlas = ai.orchestrator<AssistantState>({
  name: "atlas-assistant",
  state: {},
  intents: {
    respond: {
      description: "Answer the user, grounded in what we remember about them.",
      run: async (ctx) => {
        const recalled = (ctx.context.memories as RecalledMemory[] | undefined) ?? [];

        // Surface the recalled preferences as a context block the model reads.
        const remembered = recalled
          .map((memory) => `- ${memory.text}`)
          .join("\n");

        const reply = await composeReply(String(ctx.input), remembered);

        return { reply };
      },
      next: () => END,
    },
  },
  // Deterministic single-intent dispatch — every turn goes to `respond`.
  route: (ctx) => (ctx.iteration === 0 ? "respond" : END),
  // Durable session state across turns (swap for ai.checkpoint.pg in prod).
  checkpointStore: ai.checkpoint.memory(),
  // The whole point of this recipe.
  memory: {
    store: assistantMemory,
    recall: { k: 4, threshold: 0.75, tier: "semantic" },
    remember: true,
    rememberTier: "semantic",
  },
});
```

`END` is the terminal sentinel re-exported from the package — it tells `route` and `next` to stop the session.

`composeReply` is wherever you call your model — an `ai.agent`, a raw model call, anything. The point is that it receives the remembered preferences as grounding:

```ts
const writer = ai.agent({
  name: "atlas-writer",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You are Atlas, a warm personal assistant.")
    .instruction("Honor everything in the WHAT YOU REMEMBER block — never contradict it.")
    .instruction("If the block is empty, answer normally without inventing preferences."),
});

async function composeReply(message: string, remembered: string): Promise<string> {
  const block = remembered
    ? `WHAT YOU REMEMBER ABOUT THE USER:\n${remembered}`
    : "WHAT YOU REMEMBER ABOUT THE USER:\n(nothing yet)";

  const { text } = await writer.execute(`${block}\n\nUSER: ${message}`);

  return text;
}
```

## Use it across turns

A `sessionId` ties turns to one conversation, and `history` is the prior messages (the framework never persists messages itself — you own that store). The memory wiring is what carries preferences *across* sessions, even when the message history is empty.

```ts
// Turn 1 — Atlas recalls the seeded vegetarian preference.
const lunch = await atlas.execute("Suggest somewhere for lunch near me.", {
  sessionId: "u-42",
  history: [],
});

if (lunch.error) {
  console.error("turn failed:", lunch.error.code);
} else {
  console.log(lunch.report.turns[0]?.state); // { reply: "...a vegetarian spot in Berlin..." }
}

// The turn's outcome was just remembered — a brand-new fact the user states
// now is recalled on the next, unrelated turn.
await atlas.execute("By the way, I'm trying to cut back on dairy too.", {
  sessionId: "u-42",
  history: [],
});

// Turn 3 — even days later in a fresh session, the dairy note resurfaces.
const dinner = await atlas.execute("What should I cook tonight?", {
  sessionId: "u-42",
  history: [],
});

console.log(dinner.report.turns[0]?.state);
```

Typical flow per turn:

1. Orchestrator embeds the incoming message and runs a semantic `recall` against the store.
2. The top-`k` memories above `threshold` are injected at `ctx.context.memories`.
3. The `respond` intent surfaces them as a context block and composes the reply.
4. After the turn settles cleanly, the orchestrator remembers the input + outcome into the semantic tier — so the next turn can recall it.

## Production notes

- **Swap the driver, not the code.** `MemoryCacheDriver` is dev-only (O(N) scan, lost on restart). For production pass a vector-indexed driver and the wiring is identical: `store: cache.driver("pg", { client: pgPool, vector: { dimensions: 1536, index: "hnsw" } })`. `text-embedding-3-small` emits 1536-dimensional vectors, so the driver's `dimensions` must match. A driver without similarity support throws `CacheUnsupportedError`.
- **Namespace per user.** The semantic tier prefixes every key with `namespace` and filters recall to that prefix, so one shared driver holds every user's memories without leakage. Make the namespace include the user id (`atlas.user.<id>`), as above.
- **Threshold is your noise filter.** A low `threshold` recalls loosely-related memories the model will then treat as fact. Start at `0.75` and raise it if the assistant starts "remembering" things the user never said. `recall` returns an empty array — it never throws — when nothing clears the bar.
- **Cancelled and failed turns never remember.** Only a clean turn writes its outcome back, so an aborted or errored turn won't pollute long-term memory with a half-finished thought.
- **`clear("working")` between sessions** drops the in-run scratch while leaving durable semantic recall intact — useful if you reuse one memory instance across sessions in-process.
- **Episodic / procedural tiers and decay are deferred.** v1 ships `working` and `semantic` only; the `MemoryTier` union is deliberately closed so the 4.4 additions are a non-breaking widening.

## Related

- [Semantic recall of past answers](./memory-semantic-recall) — store and recall Q&A pairs via cache similarity.
- [RAG with cache similarity](./rag-with-cache-similarity) — the same `.similar()` delegation, applied to a knowledge base.
