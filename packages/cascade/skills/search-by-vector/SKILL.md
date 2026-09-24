---
name: search-by-vector
description: 'Vector similarity search via `.similarTo(column, embedding, alias?)` — adds a similarity `score` column and orders by vector distance so the index is used; cap results with `.limit()`. Postgres uses pgvector (IVFFlat index via `this.vectorIndex`); MongoDB needs Atlas. Schema: `this.vector(column, dimensions)` + `this.vectorIndex(column, { dimensions, similarity })`. Triggers: `.similarTo`, `this.vector`, `this.vectorIndex`, `.whereFullText`, pgvector; "semantic search", "RAG retrieval", "find similar articles", "hybrid vector + full-text"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: query basics — `@warlock.js/cascade/query-data/SKILL.md`; semantic cache — `@warlock.js/cache/use-cache-similarity/SKILL.md`; competing libs `pgvector` directly, `chromadb`, `pinecone`, `weaviate`, `qdrant`.'
---

# Use vector search

Query by vector distance for semantic search. Cascade gives you the column type, the index, and the similarity query method — generating embeddings is your AI provider's job.

## Schema + migration

Both the column and its index are builders on the migration `this`:

```ts
import { Migration } from "@warlock.js/cascade";

export default class CreateArticles extends Migration {
  public readonly table = "articles";

  public up(): void {
    this.createTable();
    this.id();
    this.string("title");
    this.text("body");
    this.vector("embedding", 1536); // pgvector column, 1536 dims
    this.vectorIndex("embedding", { dimensions: 1536, similarity: "cosine" });
  }

  public down(): void {
    this.dropTable();
  }
}
```

`vectorIndex(column, { dimensions, similarity?, lists?, name? })` — `similarity` is `"cosine" | "euclidean" | "dotProduct"` (maps to the pgvector operator class). On Postgres this builds an **IVFFlat** index (`lists` controls the cluster count, default 100). Requires `CREATE EXTENSION vector` on the database.

On MongoDB the vector index is an Atlas Search index definition (Atlas-only).

## Write — store an embedding

```ts
const embedding = await ai.embed(body);
await Article.create({ title, body, embedding });
```

Cascade stores the vector and queries against it; it doesn't compute embeddings.

## Read — similarity search

`.similarTo(column, embedding, alias?)` does two things at once: it adds `1 - (column <=> embedding) AS score` to the SELECT so each row carries its similarity, and it adds `ORDER BY column <=> embedding` so the database uses the vector index instead of a sequential scan. Cap the result with `.limit()`:

```ts
const queryEmbedding = await ai.embed("how does cascade vector search work?");

const hits = await Article.query()
  .similarTo("embedding", queryEmbedding) // score column defaults to "score"
  .limit(5)
  .get<ArticleRow & { score: number }>();

// hits[0].score → similarity of the closest match
```

There is no options object — `topK` is just `.limit(k)`, and the distance metric is fixed at index creation (the `similarity` you passed to `vectorIndex`). The third argument only renames the score column (`.similarTo("embedding", vec, "distance")`). Don't add your own `.orderBy()` on the score alias afterward — it would break index usage.

## Filtered similarity

Chain `.where()` before `.similarTo()`:

```ts
const tenantHits = await Article.query()
  .where("tenant_id", tenantId)
  .where("published", true)
  .similarTo("embedding", queryEmbedding)
  .limit(5)
  .get<ArticleRow & { score: number }>();
```

The DB applies the filter first (regular index), then ranks the remaining candidates by similarity (vector index).

## Hybrid search — vector + full-text

Cascade has `.whereFullText(fields, query)` for the text side. For best retrieval quality on long-form text, run a vector search and a full-text search and combine the results in code (re-rank or reciprocal-rank-fusion).

## RAG — retrieval-augmented generation

```ts
async function answer(question: string) {
  const queryEmbedding = await ai.embed(question);

  const context = await Document.query()
    .where("tenant_id", currentTenant.id)
    .similarTo("embedding", queryEmbedding)
    .limit(8)
    .get<DocumentRow & { score: number }>();

  // optional: drop low-similarity hits in code
  const relevant = context.filter((document) => document.score >= 0.75);

  const prompt = buildPrompt(question, relevant.map((document) => document.body));
  return ai.complete(prompt);
}
```

A score threshold isn't a query option — filter on the `score` column in code after the fetch.

## Driver support

| Driver | Vector |
| --- | --- |
| Postgres (with `CREATE EXTENSION vector`) | ✅ pgvector + IVFFlat index |
| MongoDB Atlas (paid tier + Atlas Search index) | ✅ `$vectorSearch` aggregation stage |
| MongoDB community / self-hosted / local | ❌ Atlas-only |

For local dev with MongoDB, develop the vector path against Postgres + pgvector.

## Things NOT to do

- Don't pass `{ topK, metric, threshold }` to `.similarTo()` — it takes `(column, embedding, alias?)`. Use `.limit()` for topK, set the metric at `vectorIndex` creation, and threshold in code on the `score` column.
- Don't `.orderBy()` the score alias after `.similarTo()` — it already orders by distance for index usage.
- Don't re-embed an entire corpus when changing embedding models — vectors aren't portable across models; plan the migration.
- Don't ship the raw vector array to clients. Drop it from the public shape with `static toJsonColumns`.
- Don't expect `.similarTo()` without a vector index to scale. Above a few thousand rows, sequential scans dominate.

## See also

- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — `.where`, `.whereFullText`, the broader query vocabulary
- [`@warlock.js/cache/use-cache-similarity/SKILL.md`](@warlock.js/cache/use-cache-similarity/SKILL.md) — semantic cache of LLM output
