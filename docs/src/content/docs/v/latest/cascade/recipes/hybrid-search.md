---
title: "Hybrid search — vector + full-text re-ranking"
sidebar:
  order: 3
  label: "Hybrid search — vector + full-text"
---

Pure vector search is great for semantic similarity ("find me FAQs about *refund-like* concepts") but loses on exact-keyword precision ("the product code `SKU-4429` exactly"). Pure full-text is the inverse. **Hybrid search** runs both, then re-ranks the union — best of both worlds.

This recipe combines `.similarTo()` and `.whereFullText()` results with a simple linear combination of scores. Cascade owns the two queries; you own the re-ranking math.

## The pattern

Three steps:

1. Run a vector query — top N candidates by semantic similarity.
2. Run a full-text query — top N candidates by keyword match.
3. Merge by document id, combine the two scores, sort, take the top K.

The vector query catches semantically-related results that don't share words with the query; the full-text query catches exact matches the vector might rank too low.

## The retrieval service

```ts
import { KnowledgeChunk } from "../models/knowledge-chunk/knowledge-chunk.model";
import { embed } from "app/ai/services/embed.service";

type HybridSearchInput = {
  question: string;
  limit?: number;
  candidatesPerSide?: number;
  vectorWeight?: number;
};

type ScoredChunk = {
  contentId: string;
  chunkIndex: number;
  text: string;
  score: number;
};

export async function hybridSearch(input: HybridSearchInput) {
  const candidatesPerSide = input.candidatesPerSide ?? 20;
  const vectorWeight = input.vectorWeight ?? 0.6;
  const fullTextWeight = 1 - vectorWeight;

  const [vectorResults, fullTextResults] = await Promise.all([
    runVectorSide(input.question, candidatesPerSide),
    runFullTextSide(input.question, candidatesPerSide),
  ]);

  const merged = mergeByKey(vectorResults, fullTextResults, vectorWeight, fullTextWeight);

  merged.sort((a, b) => b.score - a.score);

  return merged.slice(0, input.limit ?? 5);
}
```

Three services in one — the two side-queries and the merge step. Each piece stays under twenty lines.

## The vector side

```ts
async function runVectorSide(question: string, limit: number): Promise<ScoredChunk[]> {
  const queryEmbedding = await embed(question);

  return KnowledgeChunk.query()
    .similarTo("embedding", queryEmbedding)
    .limit(limit)
    .get<ScoredChunk>();
}
```

Cosine similarity returns 0-1 already; no normalisation needed before the merge.

## The full-text side

```ts
async function runFullTextSide(question: string, limit: number): Promise<ScoredChunk[]> {
  const results = await KnowledgeChunk.query()
    .whereFullText(["text"], question)
    .selectRaw(fullTextScoreExpression())
    .limit(limit)
    .get<ScoredChunk>();

  return normaliseScores(results);
}
```

The score expression is driver-specific — `ts_rank(...)` on Postgres, `{ $meta: "textScore" }` on MongoDB. The [Expressions guide](../digging-deeper/expressions.md) covers `selectRaw` for the driver branches.

Full-text scores aren't bounded by default (Postgres `ts_rank` can return anything; MongoDB `textScore` is unbounded too), so normalise to 0-1 before combining with cosine:

```ts
function normaliseScores(chunks: ScoredChunk[]): ScoredChunk[] {
  if (chunks.length === 0) {
    return [];
  }

  const maxScore = Math.max(...chunks.map((chunk) => chunk.score));

  if (maxScore === 0) {
    return chunks;
  }

  return chunks.map((chunk) => ({
    ...chunk,
    score: chunk.score / maxScore,
  }));
}
```

Min-max normalisation against the top of each side's results. Naive but cheap, and good enough for most apps.

## The merge step

```ts
function mergeByKey(
  vectorResults: ScoredChunk[],
  fullTextResults: ScoredChunk[],
  vectorWeight: number,
  fullTextWeight: number,
): ScoredChunk[] {
  const merged = new Map<string, ScoredChunk>();

  for (const chunk of vectorResults) {
    const key = chunkKey(chunk);

    merged.set(key, { ...chunk, score: chunk.score * vectorWeight });
  }

  for (const chunk of fullTextResults) {
    const key = chunkKey(chunk);
    const existing = merged.get(key);

    if (existing) {
      existing.score += chunk.score * fullTextWeight;
      continue;
    }

    merged.set(key, { ...chunk, score: chunk.score * fullTextWeight });
  }

  return Array.from(merged.values());
}

function chunkKey(chunk: ScoredChunk): string {
  return `${chunk.contentId}:${chunk.chunkIndex}`;
}
```

A row that appears in both sides gets the weighted sum of both scores. A row that appears in only one side gets only that side's weighted score — still a candidate, just at a lower combined rank.

## Tuning weights

The default `vectorWeight: 0.6` favours semantic similarity slightly. The right weight is domain-specific:

- **Documentation / FAQs** — full-text matters more (users type exact terminology). Try `0.4`.
- **Conversational / chat** — vector matters more (users paraphrase). Try `0.7`.
- **Product catalogs** — depends on whether searches are exact-SKU or descriptive. Measure with real queries before picking.

Don't over-tune. The signal-to-noise on a recommendation system rarely justifies more than 2-3 weight values explored.

## Going further

- **Pure vector search** — [Vector search guide](../digging-deeper/vector-search.md)
- **The RAG pipeline** that calls this service — [RAG recipe](./rag.md)
- **Driver-specific score expressions** in full — [Expressions guide](../digging-deeper/expressions.md)
- **Full-text setup** (tsvector / $text indexes) — [Full-text search recipe](./full-text-search.md)
