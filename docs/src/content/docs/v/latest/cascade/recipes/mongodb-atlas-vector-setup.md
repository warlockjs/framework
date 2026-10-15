---
title: "MongoDB Atlas vector index setup"
sidebar:
  order: 5
  label: "MongoDB Atlas vector index setup"
---

Cascade's `.similarTo()` on MongoDB uses Atlas's `$vectorSearch` aggregation stage. That stage requires a **vector search index** to exist on the collection before any query runs — the index is created outside the application, in Atlas itself.

This recipe walks the setup: the index manifest, where to put it in Atlas, and how Cascade picks it up.

## What Cascade expects

When you call `.similarTo("embedding", queryEmbedding)` on a MongoDB-backed model, Cascade emits a `$vectorSearch` stage referencing an index named `${column}_index`. For the example above, that's `embedding_index`.

If the index doesn't exist, the query fails with an Atlas error. The fix is creating it once per environment, then never touching it again unless the embedding shape changes.

## The index definition

Atlas vector search indexes are defined as JSON. For a typical OpenAI-embedded collection:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    }
  ]
}
```

What each field means:

- **`type: "vector"`** — declares this as a vector search field. (Other types: `"filter"`, used for combined vector+filter indexes.)
- **`path: "embedding"`** — the field on each document that holds the vector. Must match the column name you pass to `.similarTo()`.
- **`numDimensions`** — fixed dimension of every vector in this collection. Must match your embedding model — OpenAI `text-embedding-3-small` is 1536, Voyage models vary.
- **`similarity`** — `"cosine"`, `"euclidean"`, or `"dotProduct"`. Match what your embedding model expects (OpenAI normalises to unit-length, so all three are equivalent in practice — `"cosine"` is the conventional pick).

## Adding pre-filter fields

If you query with `.where("organizationId", id).similarTo(...)`, Atlas needs to know `organizationId` is filterable as part of the vector search. Add it to the same index:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "organizationId"
    },
    {
      "type": "filter",
      "path": "contentType"
    }
  ]
}
```

Without the filter declaration, Atlas does the vector scan first and then filters — much slower than narrowing the candidate set up front.

## Creating the index

Three paths, pick whatever fits your deployment workflow.

### Atlas UI

1. In the Atlas console, open the cluster → **Atlas Search**.
2. Click **Create Search Index** → **JSON Editor**.
3. Pick the database and collection (e.g., `myapp.knowledge_chunks`).
4. Set the index name — **must** be `${column}_index`, matching what Cascade emits. For `embedding` column, that's `embedding_index`.
5. Paste the JSON definition.
6. **Create Search Index**. Build takes 30 seconds to several minutes depending on the collection size.

### Atlas CLI

```bash
atlas clusters search indexes create \
  --clusterName my-cluster \
  --collectionName knowledge_chunks \
  --db myapp \
  --file vector-index.json
```

The JSON file holds the index definition plus the name:

```json
{
  "name": "embedding_index",
  "definition": {
    "fields": [
      { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" }
    ]
  }
}
```

### Programmatically via `mongosh`

```javascript
db.knowledge_chunks.createSearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: 1536, similarity: "cosine" }
    ]
  }
});
```

Useful for repeatable setup scripts or CI provisioning.

## Per-environment indexes

Each environment (dev, staging, production) has its own cluster — and therefore its own index. The simplest pattern is a small provisioning script per environment that runs the `createSearchIndex` call against the right cluster URI. Store the JSON definition in the repo so dev/staging/production all use the same shape.

## Verifying the index works

Before pointing application traffic at it:

```javascript
db.knowledge_chunks.aggregate([
  {
    $vectorSearch: {
      index: "embedding_index",
      path: "embedding",
      queryVector: [/* test vector */],
      numCandidates: 100,
      limit: 5
    }
  }
]);
```

If the index name is wrong or the query vector dimension doesn't match `numDimensions`, this fails immediately with a clear error. Once it works, Cascade's `.similarTo()` will work too — they emit the same stage.

## When `numDimensions` changes

The dimension is part of the index — you can't change it in place. The migration:

1. Re-embed the entire collection with the new model, writing into a new column (`embedding_v2`).
2. Create a new index (`embedding_v2_index`) for the new column.
3. Switch the application to point at the new column (whatever model class uses `.similarTo("embedding_v2", ...)`).
4. Drop the old index and the old column once the cutover is verified.

Old vectors and new vectors don't compose — different models, different vector spaces — so don't try to mix them during the rollover.

## Going further

- **Cascade's vector search API** — [Vector search guide](../digging-deeper/vector-search.md)
- **End-to-end RAG pattern** — [RAG recipe](./rag.md)
- **Hybrid search** combining `$vectorSearch` with full-text — [Hybrid search recipe](./hybrid-search.md)
