---
title: "Hybrid retrieval"
description: bm25Rank, hybridRank, reciprocalRankFusion, and multiQuery — the lexical half of retrieval. Fuse BM25 keyword scoring with a dense vector ranking over a candidate set, no global corpus index required.
sidebar:
  order: 10
  label: "Hybrid retrieval"
---

Dense (vector) retrieval is great at semantics but blind to exact tokens — invoice ids, error codes, product SKUs, rare names. A query like `invoice 8842 refund` can rank a fuzzy "billing help" passage above the one that literally contains `8842`. **Hybrid retrieval** fixes that: run a lexical pass (BM25) alongside the vector pass over the same candidate set and fuse the two rankings.

`@warlock.js/ai` ships four pure functions for this — `bm25Rank`, `reciprocalRankFusion`, `hybridRank`, and `multiQuery`. They are **standalone barrel exports**, not methods on the [`ai.rag()`](./run-rag) instance (`kb.retrieve()` does dense + optional rerank only). You compose them yourself over whatever candidate set you have, so they work with any vector store. **Zero new dependencies** — all four are dependency-light and operate over the candidates you pass in.

```ts
import {
  bm25Rank,
  hybridRank,
  reciprocalRankFusion,
  multiQuery,
} from "@warlock.js/ai";
```

:::note
These operate over the **supplied candidate set** — typically the dense retriever's over-fetch (its top-N). There is no global corpus index to build or maintain: document frequencies are computed across the candidates handed in, on the fly.
:::

## `bm25Rank` — the lexical pass

`bm25Rank(query, docs)` scores each candidate against the query with [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) — keyword overlap with term-frequency saturation (`k1`) and document-length normalization (`b`) — so an exact-term match surfaces even when dense embeddings miss it.

```ts
function bm25Rank(query: string, docs: ReadonlyArray<LexicalDoc>): RankedItem[];

type LexicalDoc = { id: string; text: string };
type RankedItem = { id: string; score: number };
```

```ts
const ranked = bm25Rank("invoice 8842 refund", [
  { id: "1", text: "the cat sat on the mat" },
  { id: "2", text: "refund for invoice 8842 was processed" },
  { id: "3", text: "the weather is nice today" },
]);

// → [{ id: "2", score: ... }]  — doc "2" carries the rare terms
```

Behaviour, straight from the implementation:

- **Tokenization** is lowercase + split on non-word characters (`[^a-z0-9]+`), empties dropped. No stemming, no stopword list.
- **Constants** are fixed: `k1 = 1.5`, `b = 0.75` (the standard defaults). They are not parameters.
- Returns docs **sorted by score, highest first**. Every **zero-score doc is dropped** — a doc that shares no query term never appears in the result.
- Returns `[]` when the query has no tokens, when `docs` is empty, or when nothing matches.
- IDF uses the `log(1 + (n - df + 0.5) / (df + 0.5))` form (the `+1` keeps it non-negative), with `df` and `avgLen` computed across the supplied candidate set.

## `reciprocalRankFusion` — combine ranked lists

`reciprocalRankFusion(rankedLists, k?)` merges several independently-ranked **id lists** into one consensus ranking. Each list contributes `1 / (k + rank)` to an id's score (`rank` is 0-based within that list), so an id near the top of multiple lists rises even if no single list ranks it first.

```ts
function reciprocalRankFusion(
  rankedLists: ReadonlyArray<ReadonlyArray<string>>,
  k?: number, // default 60
): RankedItem[];
```

```ts
reciprocalRankFusion([
  ["a", "b", "c"], // e.g. the dense ranking
  ["b", "a", "d"], // e.g. the BM25 ranking
]);
// → [{ id: "b", ... }, { id: "a", ... }, ...] — ids ranked high in both lead
```

RRF is the classic fusion for hybrid retrieval because it needs **no score calibration** between the lists — cosine scores and BM25 scores live on different scales, but RRF only looks at rank position. `k` (default `60`, the standard) dampens the contribution of lower ranks. Passing `[]` returns `[]`.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `rankedLists` | `ReadonlyArray<ReadonlyArray<string>>` | — | Each inner array is ids in rank order (best first). |
| `k` | `number` | `60` | Rank-damping constant; higher = flatter contribution curve. |

## `hybridRank` — dense + BM25 in one call

`hybridRank` is the convenience wrapper that ties the two together: it runs `bm25Rank` over your candidates, then fuses that lexical ranking with your dense ranking via `reciprocalRankFusion`.

```ts
function hybridRank(params: {
  query: string;
  dense: ReadonlyArray<{ id: string }>;   // vector retriever's result, in rank order
  candidates: ReadonlyArray<LexicalDoc>;  // text for the lexical pass (usually the over-fetch)
  k?: number;                             // RRF k, default 60
}): RankedItem[];
```

```ts
// 1. over-fetch from your vector store (dense, in similarity order)
const vectorHits = await myVectorStore.search(queryVector, { topK: 20 });
//    e.g. [{ id, text }, ...]

// 2. fuse dense order with a BM25 pass over the same set
const fused = hybridRank({
  query: "invoice 8842 refund",
  dense: vectorHits,                                  // [{ id }, ...] in similarity order
  candidates: vectorHits.map(h => ({ id: h.id, text: h.text })),
});

// 3. take the top results, then load / cite by id
const topIds = fused.slice(0, 4).map(r => r.id);
```

`dense` is the vector retriever's result **in rank order** (only `id` is read); `candidates` supplies the text for the lexical pass — typically the same over-fetched set. Returns the fused ranking, highest score first. Because the lexical pass boosts exact-term matches the vectors buried, a keyword-heavy query that the dense ranking placed mid-list can be lifted to the top after fusion.

:::tip
Over-fetch on the dense side (e.g. `topK: 20`) and use that pool as `candidates`, then slice the fused result down to the handful you actually inject. The lexical pass can only re-rank ids that are already in the candidate set — it never introduces new documents.
:::

## `multiQuery` — expand one query into several

Keyword and dense retrieval both miss documents phrased differently from the query. `multiQuery` asks a model for alternative phrasings so retrieval covers vocabulary the original wording missed (synonyms, specificity, rephrasings).

```ts
function multiQuery(
  model: ModelContract,
  query: string,
  options?: MultiQueryOptions,
): Promise<string[]>;

type MultiQueryOptions = {
  n?: number;               // how many alternative phrasings to request. default 3
  includeOriginal?: boolean; // prepend the original query. default true
};
```

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.model({ name: "gpt-4o-mini" });

const queries = await multiQuery(model, "how do I cancel?", { n: 3 });
// → ["how do I cancel?", "cancel my subscription", "end my plan", "how to unsubscribe"]
```

The model is prompted for one query per line. Parsing is deterministic and dependency-light: leading bullets / numbering (`-`, `*`, `•`, `1.`, `1)`) are stripped, blank lines dropped, and the set is **de-duplicated case-insensitively**. Returns the original query first (unless `includeOriginal: false`) followed by up to `n` variants.

Run each returned query through your retriever (dense and/or `bm25Rank`), then fuse all the per-variant id lists with `reciprocalRankFusion`:

```ts
const queries = await multiQuery(model, userQuery, { n: 3 });

const perQueryRankings = await Promise.all(
  queries.map(async q => {
    const hits = await myVectorStore.search(await embed(q), { topK: 20 });
    return hits.map(h => h.id); // a ranked id list per query variant
  }),
);

const fused = reciprocalRankFusion(perQueryRankings);
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `n` | `number` | `3` | Number of alternative phrasings requested (and the cap on variants kept). |
| `includeOriginal` | `boolean` | `true` | Prepend the original query to the returned list. |

## When to reach for hybrid

- **Keyword-heavy or identifier-heavy queries** (ids, codes, names, rare tokens) — dense alone buries the exact match; `bm25Rank` / `hybridRank` rescue it.
- **Vocabulary mismatch** between how users ask and how docs are written — `multiQuery` widens the net.
- **Pure semantic / paraphrase queries** with no distinctive tokens — dense retrieval alone is usually enough; the lexical pass adds little.

These functions are stateless and side-effect-free, so they slot into a tool's `execute`, a workflow `run` step, or a plain retrieval helper — wherever you already have a candidate set and want a better final ordering.

## Related

- [Run RAG](./run-rag) — the `ai.rag()` pipeline; `kb.retrieve()` does dense + optional rerank, and its `ai.rag.keywordReranker` is a separate BM25-lite *reranker* (not `bm25Rank`).
- [Embed text](./embed-text) — the `ai.embedder` surface that produces the dense ranking you fuse against.
- [Define tools](./define-tools) — wrap a hybrid retriever as a tool the agent can call.
- [Persist AI data](../digging-deeper/persist-ai-data) — the `@warlock.js/cache` drivers that back the vector store you over-fetch from.
