---
title: "Recipe — Semantic recall of past answers"
description: Store past question-answer pairs and recall the most similar one on a new question, using ai.memory's semantic tier over a cache driver with an embedder.
---

Your support bot answers the same questions a hundred different ways: *"How do I reset my password?"*, *"I forgot my password"*, *"can't log in, need a new password"*. They are the same question wearing different words — and you have already written a good answer to it. The trick is recognizing that a brand-new phrasing *means* the same thing as one you have answered before, then reusing that answer.

This is **semantic recall**: store each answered question paired with its answer, then on a new question retrieve the closest prior pair by meaning rather than by exact text. `ai.memory`'s semantic tier does exactly this — it embeds the text into a vector and asks a `@warlock.js/cache` driver for the nearest stored entries via the driver's `.similar()`. This recipe shows the full wiring: the embedder that turns text into vectors, the cache driver that indexes them, and the store/recall calls that tie them together.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/cache
```

Semantic recall needs two collaborators:

- an **embedder** — turns a question into a vector so "similarity" is a measurable cosine distance, and
- a **vector-capable cache driver** — indexes those vectors and answers nearest-neighbor queries.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { MemoryCacheDriver } from "@warlock.js/cache";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// The embedder: text -> vector. text-embedding-3-small emits 1536-dim vectors.
const embedder = openai.embedder({ name: "text-embedding-3-small" });

// The vector store. MemoryCacheDriver does an O(N) cosine scan — perfect for
// dev and tests, no infrastructure. Swap for pg/redis in production (below).
const store = new MemoryCacheDriver();
store.setOptions({});
```

## Build a semantic-only memory

For a recall cache you do not want the in-run **working** tier — there is no live session, just a durable index of past pairs. Disable working with `working: false` and configure only the **semantic** tier. That makes this memory a pure cosine-similarity index over the cache driver.

```ts
const qaRecall = ai.memory({
  name: "support-qa-recall",
  working: false, // semantic-only — this is a durable index, not a scratchpad.
  semantic: {
    embedder,
    store,
    namespace: "support.qa", // keeps these pairs isolated on a shared driver.
  },
  defaultTier: "semantic",
  k: 1, // we want the single closest prior answer.
  threshold: 0.82, // only reuse an answer when the questions really match.
});
```

## Store a question-answer pair

Each pair is one memory: the `text` is what gets embedded and searched against, the `metadata` carries the answer (and anything else) back verbatim on recall. Embed the *question* — that is what future questions will be compared to — and stash the answer in `metadata`.

```ts
type QAPair = {
  question: string;
  answer: string;
};

async function rememberAnswer(pair: QAPair): Promise<void> {
  await qaRecall.remember({
    text: pair.question, // embedded + searched against
    metadata: {
      answer: pair.answer, // round-tripped back to us on recall
      answeredAt: new Date().toISOString(),
    },
  });
}

// Seed a few answered questions.
await rememberAnswer({
  question: "How do I reset my password?",
  answer: "Open Settings → Security → Reset password, then follow the email link.",
});

await rememberAnswer({
  question: "What is your refund policy?",
  answer: "Unused items can be refunded within 30 days of purchase.",
});
```

Re-remembering the same question overwrites in place rather than duplicating — the factory derives a stable id from the text, so storing an updated answer for the same phrasing replaces the old one.

## Recall the closest prior answer

On a new question, `recall` embeds it, runs the similarity search through the driver, and returns the scored matches. Because we configured `k: 1` and a `threshold`, you get at most one hit — and only when it clears the bar.

```ts
import type { RecalledMemory } from "@warlock.js/ai";

async function answerFromRecall(question: string): Promise<string | undefined> {
  const hits: RecalledMemory[] = await qaRecall.recall(question);

  const best = hits[0];

  if (!best) {
    // Nothing similar enough — fall through to the live model.
    return undefined;
  }

  const answer = best.metadata?.answer as string | undefined;

  console.log(
    `recalled "${best.text}" @ score ${best.score.toFixed(3)} for "${question}"`,
  );

  return answer;
}
```

## Use it

A differently-worded question still finds the right answer, because recall matches on meaning:

```ts
// Phrased nothing like the stored question, but means the same thing.
const reused = await answerFromRecall("I can't log in — how do I get a new password?");

if (reused) {
  console.log("served from recall:", reused);
  // → "Open Settings → Security → Reset password, then follow the email link."
} else {
  // Genuinely new question — answer it live, then remember it for next time.
  const fresh = await answerLive("I can't log in — how do I get a new password?");
  await rememberAnswer({
    question: "I can't log in — how do I get a new password?",
    answer: fresh,
  });
}
```

`answerLive` is your normal model call — an `ai.agent`, for instance — invoked only on a miss:

```ts
const supportAgent = ai.agent({
  name: "support",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You are a concise support agent.")
    .instruction("Answer in one or two sentences."),
});

async function answerLive(question: string): Promise<string> {
  const { text } = await supportAgent.execute(question);

  return text;
}
```

The loop: recall → on a hit, reuse the stored answer for free; on a miss, answer live and remember the new pair so the *next* phrasing of it is a hit.

## Production notes

- **Swap the driver for a real ANN index.** `MemoryCacheDriver` scans every entry (O(N)) and is lost on restart — fine for dev, wrong for scale. Point `store` at `cache.driver("pg", { client: pgPool, vector: { dimensions: 1536, index: "hnsw" } })` (pgvector) or `cache.driver("redis", { client: redisClient })` (RediSearch). The store/recall code above does not change. The driver's `dimensions` must equal the embedder's output (1536 for `text-embedding-3-small`); a mismatch is a wiring bug, and a driver with no similarity support throws `CacheUnsupportedError`.
- **`threshold` is the whole game.** Too low and you reuse a confidently-wrong answer; too high and you never get a hit. Tune it against real query pairs — `0.82` is a reasonable starting point for `text-embedding-3-small`. `recall` returns an empty array (never throws) when nothing clears the bar, so a miss is just `hits.length === 0`.
- **`namespace` isolates and lets you wipe.** Every key is prefixed with the namespace, and recall filters to that prefix — so one driver can hold many independent recall sets. `qaRecall.clear()` drops just this namespace's entries, leaving sibling caches untouched.
- **Prefer this over raw `.similar()` unless you need the control.** Under the hood `ai.memory` calls `store.set(key, value, { vector })` to index and `store.similar(vector, { topK, threshold })` to retrieve — the same delegation the `semanticCache` middleware uses. Drop to the raw driver only when you need custom keys, tag filters, or to co-locate vectors with other cached data; otherwise let `memory` own the embed + namespace + scoring.
- **This pairs naturally with `ai.middleware.semanticCache`.** When you want the *agent itself* to skip the model call on a near-duplicate prompt (rather than managing the pairs by hand), reach for the middleware. Use this hand-rolled recall when you need the stored answer addressable as data — e.g. to show "we answered this before" or to let a human edit the canned reply.

## Related

- [A personal assistant that remembers you](./memory-assistant-with-memory) — `ai.memory` wired into an orchestrator's recall/remember lifecycle.
- [RAG with cache similarity](./rag-with-cache-similarity) — the same `.similar()` retrieval, applied to a document knowledge base.
