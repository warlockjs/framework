---
title: "Embed text"
description: Text-to-vector via sdk.embedder — single and batch. Pairs with semantic cache, RAG tools, and Cascade vector search.
sidebar:
  order: 4
  label: "Embed text"
---

`EmbedderContract` is the sibling of `ModelContract` on the SDK adapter. Text-in, vector-out. No streaming, no tools, no relationship to chat completions. It's a separate primitive on purpose — different cost profiles, different per-request limits, different failure modes.

## The contract

```ts
interface EmbedderContract {
  readonly name: string;
  readonly provider: string;
  readonly dimensions: number;        // 0 until first call when no override given

  embed(input: string): Promise<EmbeddingResult>;
  embedMany(inputs: string[]): Promise<EmbeddingBatchResult>;
}
```

`embedder()` is **optional** on `SDKAdapterContract` — not every provider supports embeddings. Check before reaching for it:

```ts
if (typeof sdk.embedder === "function") {
  const embedder = sdk.embedder({ name: "text-embedding-3-small" });
}
```

## OpenAI adapter — usage

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const embedder = openai.embedder({ name: "text-embedding-3-small" });

const one = await embedder.embed("Hello, world.");
// { vector: number[], dimensions: number, usage: EmbeddingUsage }

const many = await embedder.embedMany(["foo", "bar", "baz"]);
// { vectors: number[][], dimensions: number, usage: EmbeddingUsage }
```

## Not wired into the agent loop

Embeddings are deliberately not automatic. Consumers obtain an embedder from the adapter and call it directly. It composes into:

- **Retrieval tools** the agent can call (RAG pattern).
- **`run` steps** in a workflow (vector ingest, catalog item embedding).
- **Query vectors** for `ai.middleware.semanticCache`.
- **Vector columns** in Cascade for native pgvector search.
- **Cache similarity** via `cache.set({ vector })` + `cache.similar(...)`.

## Inside a workflow `run` step

```ts
ai.step({
  name: "embed",
  run: async (ctx) => {
    const text = `${ctx.steps.extract.output.name} ${ctx.steps.extract.output.description}`;
    const { vector } = await embedder.embed(text);
    ctx.state.embedding = vector;
  },
  output: { extract: (ctx) => ({ dims: (ctx.state.embedding as number[]).length }) },
});
```

## Pattern — RAG tool

Wrap the embedder + your vector store in a tool the agent can call:

```ts
import { v } from "@warlock.js/seal";

const searchKb = ai.tool({
  name: "searchKb",
  description: "Search the knowledge base for relevant passages.",
  input: v.object({ query: v.string(), k: v.number().optional() }),
  execute: async ({ query, k }) => {
    const { vector } = await embedder.embed(query);
    const hits = await vectorStore.query(vector, { topK: k ?? 5 });
    return hits.map((h) => ({ text: h.text, score: h.score, source: h.source }));
  },
});

const agent = ai.agent({ model, tools: [searchKb] });
```

The agent decides when to call it. The model never sees the vector — only the retrieved text.

## Dimensions

`embedder.dimensions` is `0` on a fresh embedder when no override is given — it's populated from the first embed call's response. Pre-seed via the adapter's `dimensions` config when you need the value BEFORE the first call (sizing a vector column in a Cascade migration, for example).

## Retrieval is your problem

`@warlock.js/ai` doesn't ship a vector store. Bring your own — pgvector, Qdrant, Pinecone, Chroma — and wrap it in an `ai.tool({...})`. Or use `@warlock.js/cache` with pgvector to keep both KV and vector retrieval in one driver.

## Related

- [Run agent](./run-agent) — composing embedders into tools.
- [Run workflow](../digging-deeper/run-workflow) — embeddings inside `run` steps.
- [Attach middleware](../digging-deeper/attach-middleware) — `semanticCache` uses an embedder.
- [Persist AI data](../digging-deeper/persist-ai-data) — vector storage guidance.
