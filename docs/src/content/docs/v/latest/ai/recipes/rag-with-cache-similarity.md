---
title: "Recipe — RAG with cache similarity"
description: A retrieval-augmented agent that uses @warlock.js/cache as the vector store. End-to-end, no third-party DB required.
sidebar:
  order: 3
  label: "RAG with cache similarity"
---

A retrieval-augmented agent that answers questions from your knowledge base. The cache package doubles as the vector store — no separate Pinecone / Qdrant required.

This is the cheapest path to a working RAG setup. Production volumes will eventually want a dedicated vector DB, but this gets you to a working prototype in under 100 lines.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/cache @warlock.js/seal
```

You need a Postgres database with pgvector enabled. Locally:

```bash
docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev ankane/pgvector
```

## Wire the cache as a vector store

```ts
import { cache } from "@warlock.js/cache";
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { Pool } from "pg";

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

ai.config({
  defaultStore: cache.driver("pg", {
    client: pgPool,
    vector: { dimensions: 1536, index: "hnsw" },
  }),
});

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const embedder = openai.embedder({ name: "text-embedding-3-small" });
```

The same driver instance handles snapshot resume AND semantic retrieval.

## Index your documents

```ts
async function indexDocument(id: string, title: string, body: string) {
  const { vector } = await embedder.embed(`${title}\n\n${body}`);

  await cache.driver("pg").set(id, {
    title,
    body,
    indexedAt: new Date().toISOString(),
  }, {
    vector,
    tags: ["kb-doc"],
    ttlMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
  });
}

await indexDocument("doc-1", "Returning a product", "Customers may return any unused product within 30 days...");
await indexDocument("doc-2", "Shipping internationally", "We ship to 47 countries via DHL...");
```

## Build the retrieval tool

```ts
import { v } from "@warlock.js/seal";

const searchKb = ai.tool({
  name: "search_kb",
  description: "Search the knowledge base for passages relevant to a customer question. Returns the top matches with titles and body excerpts.",
  action: ({ query }) => `Searching the knowledge base for "${query}"`,
  input: v.object({ query: v.string(), k: v.number().optional() }),
  execute: async ({ query, k }) => {
    const { vector } = await embedder.embed(query);

    const hits = await cache.driver("pg").similar(vector, {
      topK: k ?? 4,
      threshold: 0.75,
      tags: ["kb-doc"],
    });

    return hits.map((hit) => ({
      title: hit.value.title,
      body: hit.value.body.slice(0, 800),
      score: hit.score,
    }));
  },
});
```

`threshold: 0.75` filters out passages that aren't actually relevant — better to return nothing than noise the model will then narrate as fact.

## The agent

```ts
const supportAgent = ai.agent({
  name: "kb-support",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a support agent for Acme Corp.")
    .instruction("ALWAYS search the knowledge base before answering policy questions.")
    .instruction("If the search returns no relevant passages, say so honestly — never make up policy."),
  tools: [searchKb],
  maxTrips: 4,
});
```

## Use it

```ts
const { text, report } = await supportAgent.execute(
  "What's your return policy for international orders?",
);

console.log(text);

// Inspect what the agent retrieved
const searchCalls = report.children.filter(
  (c): c is import("@warlock.js/ai").ToolCall =>
    c.type === "tool" && c.name === "search_kb",
);
for (const call of searchCalls) {
  console.log("retrieved:", call.output);
}
```

Typical flow:

1. Model decides it needs the policy → calls `search_kb({ query: "return policy international" })`.
2. Tool embeds the query, runs pgvector similarity search, returns top 4 passages above threshold.
3. Model reads the passages and composes the reply, grounded in the retrieved text.

## Add semantic response caching

Layer `semanticCache` middleware on top to skip the LLM call entirely when a similar question was answered recently:

```ts
const supportAgent = ai.agent({
  // ...
  middleware: [
    ai.middleware.semanticCache({
      embedder,
      threshold: 0.95,
      ttlMs: 60 * 60 * 1000,   // 1 hour
      namespace: "kb-support",
    }),
  ],
  tools: [searchKb],
});
```

Now the same store handles: vector retrieval for the tool, snapshot resume for workflows, response caching for the agent itself. One driver, three uses.

## What's NOT here

- **Pagination / chunking large documents.** Index per-paragraph for higher recall.
- **Re-ranking.** Top-K vector search is okay; cross-encoder re-ranking is better. Out of scope for v1.
- **Hybrid search.** Combine vector with BM25 for keyword-heavy queries. Out of scope here.

When you outgrow this, swap the cache driver for a dedicated vector DB and keep the tool shape identical.

## Related

- [Embed text](../the-basics/embed-text) — the embedder primitive.
- [Define tools](../the-basics/define-tools) — wrapping retrieval as a tool.
- [Persist AI data](../digging-deeper/persist-ai-data) — driver catalog.
