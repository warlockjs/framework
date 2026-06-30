---
title: "Run RAG"
description: ai.rag() — a chunk → embed → vector-store → retrieve → rerank → cite pipeline that reuses ai.embedder and a @warlock.js/cache driver, with zero new dependencies.
sidebar:
  order: 6
  label: "Run RAG"
---

`ai.rag(config)` is a self-contained retrieval pipeline: **chunk → embed → vector store → retrieve → rerank → cite**. It reuses the embedder you already have (`provider.embedder(...)`), a `@warlock.js/cache` vector-capable `CacheDriver` as the store, and the same tool engine the other primitives use for `asTool()`. **Zero new dependencies.** `ai.rag` is a native core verb — present the moment `@warlock.js/ai` is imported (no module augmentation, no side-effect import).

## The factory

```ts
import { ai } from "@warlock.js/ai";
import { MemoryCacheDriver } from "@warlock.js/cache";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const kb = ai.rag({
  name: "docs",                                                  // default "rag"
  embedder: openai.embedder({ name: "text-embedding-3-small" }), // REQUIRED
  store: new MemoryCacheDriver(),                                // or ai.config({ defaultStore })
  namespace: "ai.rag.docs",                                      // default `ai.rag.<name>`
  chunk: { type: "markdown", size: 800, overlap: 120 },          // index() defaults
  reranker: ai.rag.keywordReranker(),                            // OFF by default (cosine-only)
  retrieve: { topK: 4, threshold: 0.5 },                         // default retrieval knobs
});
```

The factory returns a `Rag` instance:

```ts
interface Rag {
  readonly name: string;
  index(docs: RagDocument[], chunk?: ChunkOptions): Promise<{ chunks: number }>;
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrieveResult>;
  clear(): Promise<void>;
  asTool(options?: RagAsToolOptions): ToolContract<{ query: string }, RetrieveResult>;
}
```

### Resolution is loud at construction

Mirroring [`ai.memory`](../digging-deeper/persist-ai-data), the two hard dependencies are resolved when you build the rag, not at first index:

- `embedder` is **required**. A provider with no embedder must fail here, not silently at the first `index()` call.
- `store` falls back to `ai.config({ defaultStore })`. If neither resolves, the factory throws.

This means a misconfigured knowledge base blows up at app boot, not three layers into a request.

## `index()` — chunk, embed (batched), store

```ts
const { chunks } = await kb.index([
  { id: "guide", text: longMarkdown, metadata: { url: "/guide" }, tags: ["public"] },
  { id: "faq",   text: faqText,      metadata: { url: "/faq" } },
]);

console.log(chunks); // total chunks written across both documents
```

A `RagDocument` is `{ id, text, metadata?, tags? }`. The caller loads and parses documents to text — document loaders are out of scope; `index()` takes already-loaded `{ id, text }`. The `id` propagates to every chunk and citation; `metadata` is round-tripped verbatim onto each citation; `tags` are applied to every chunk so `retrieve({ tags })` can later restrict to a subset of sources.

Internally `index()`:

1. Splits each document with the chunker (see below), preserving order.
2. Sub-batches the embed calls (96 chunk texts per `embedder.embedMany()` call) so one giant document never blows the provider's per-request token cap.
3. Upserts each chunk's record + vector into the store under `namespace.sourceId.chunkIndex`.

Empty or whitespace-only documents yield zero chunks — nothing is written and no empty batch is ever embedded.

### Chunkers — `ChunkOptions`

All sizing is in **characters**, not tokens, so the pipeline stays tokenizer-free (the embedder owns token counting). Pick a strategy with `type`:

| `type` | behaviour |
| --- | --- |
| `"recursive"` (default) | Separator-aware greedy packing; tries `["\n\n", "\n", ". ", " ", ""]` largest-unit first. |
| `"markdown"` | Heading/section-aware, then recursive within each section. Best for docs. |
| `"sentence"` | Packs whole sentences up to `size`. |
| `"fixed"` | Back-to-back character windows. |

```ts
type ChunkOptions = {
  type?: "recursive" | "sentence" | "fixed" | "markdown"; // default "recursive"
  size?: number;        // target chunk size in characters. default 1000
  overlap?: number;     // characters carried between adjacent chunks. default 200
  separators?: string[]; // recursive splitter only
};
```

Defaults set on the factory's `chunk` apply to every `index()`; pass a second argument to override per call: `await kb.index(docs, { type: "sentence", size: 500 })`. Every chunk records its exact `[start, end)` span in the original text, so a citation's `span` is precise.

## `retrieve()` — embed, fetch, rerank, slice, cite

```ts
const { query, chunks } = await kb.retrieve("how do I configure caching?", {
  topK: 4,          // chunks returned AFTER reranking. default 5
  threshold: 0.5,   // cosine floor at the store stage. default 0.5
  candidates: 16,   // pool fetched before reranking. default topK * 4
  tags: ["public"], // restrict to chunks whose source carried one of these tags
});

for (const { text, score, citation } of chunks) {
  console.log(score.toFixed(2), citation.sourceId, citation.span, text);
}
```

`retrieve()` is **return-only** — it never auto-injects into a prompt. The caller formats the cited chunks (or uses `asTool()` for the agent loop). Each hit is a `RetrievedChunk`:

```ts
type RetrievedChunk = {
  text: string;       // the chunk text to inject into a prompt
  score: number;      // [0,1] — cosine, or the reranker's score when one ran
  citation: Citation; // provenance for grounding the answer
};

type Citation = {
  sourceId: string;                  // id of the source RagDocument
  chunkIndex: number;                // 0-based index within that document
  span: [start: number, end: number]; // char span in the original text
  score: number;
  metadata?: Record<string, unknown>; // copied verbatim from the source
};
```

### Failure modes (all graceful)

- **No hits clear the threshold** → `{ query, chunks: [] }`. Never throws.
- **Two rags share one driver** → namespace-prefix filtering keeps them isolated.
- **A reranker throws** → caught; the raw cosine order is used instead. A flaky optional reranker never fails the whole retrieval.
- **Dimension mismatch** (indexed with model A, queried with model B) → throws a clear error rather than returning garbage hits. Index and query must use the same embedding model.

## Reranking — OFF by default

With no `reranker` set, results come back in pure cosine order. Two opt-in rerankers ship, attached to the `ai.rag` namespace:

### `ai.rag.keywordReranker(options?)` — free, lexical

A zero-dependency BM25-lite (IDF-free keyword overlap). For each candidate it computes the fraction of distinct query terms present in the chunk, blends that with the cosine score by `weight` (default `0.5`; `1` = pure lexical, `0` = pure cosine), and sorts descending. No model call, no peer — the recommended opt-in when embedding-only ranking buries a keyword-rich chunk.

```ts
const kb = ai.rag({
  embedder, store,
  reranker: ai.rag.keywordReranker({ weight: 0.4 }),
});
```

### `ai.rag.llmReranker(options)` — precise, model-backed

Asks an LLM to grade each over-fetched candidate's relevance on a `0..1` scale, then sorts by the model's score. Candidates the model doesn't score keep their cosine score, so a partial/garbled reply degrades gracefully. Scoring is batched (`batchSize`, default 10) to bound prompt length.

```ts
const kb = ai.rag({
  embedder, store,
  reranker: ai.rag.llmReranker({
    model: openai.model({ name: "gpt-4o-mini" }),
    batchSize: 8,
  }),
});
```

Unlike the keyword reranker, this costs one or more model calls per retrieval — opt in only when precision matters more than latency and cost.

## `asTool()` — hand retrieval to an agent loop

Expose `retrieve()` as a tool so the model can search the knowledge base mid-conversation:

```ts
const searchDocs = kb.asTool({
  name: "search_docs",                 // default "retrieve_<rag.name>"
  description: "Search the product docs.",
  retrieve: { topK: 3 },               // override topK / threshold / tags for the tool path
});

const agent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: "Answer from the docs. Cite sourceId for every claim.",
  tools: [searchDocs],
});
```

The tool input is `{ query: string }`; the output is the full `RetrieveResult` (so the model sees the citations). On a thrown retrieval error the runtime serializes `{ error }` back to the agent for self-correction — the run does not abort. The tool name is namespaced by the rag's name because the agent tool surface has no duplicate-name collision guard.

## `clear()`

```ts
await kb.clear(); // drops every entry written under this rag's namespace
```

## When to use RAG vs. the alternatives

- Use **`ai.rag`** when an agent must answer from a body of documents it didn't see at training time, and you want grounded answers with citations.
- Use [`ai.memory`](../digging-deeper/persist-ai-data) (semantic tier) for an agent's own accumulated recall across runs — short facts, not a document corpus.
- Use [`ai.middleware.semanticCache`](../digging-deeper/attach-middleware) to cache whole LLM responses by similarity — that's response caching, not knowledge retrieval.

## Related

- [Embed text](./embed-text) — the raw `ai.embedder` surface RAG builds on.
- [Persist AI data](../digging-deeper/persist-ai-data) — `ai.memory` and the `@warlock.js/cache` drivers that back the vector store.
- [Define tools](./define-tools) — the tool surface `asTool()` plugs into.
- [Attach middleware](../digging-deeper/attach-middleware) — `semanticCache`, the response-cache cousin of RAG retrieval.
