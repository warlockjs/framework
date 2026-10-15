---
title: "Full-text search"
sidebar:
  order: 2
  label: "Full-text search"
---

`whereFullText(fields, query)` on the Cascade query builder maps to `tsvector` on Postgres and `$text` on MongoDB. Both drivers need an index before the query is cheap — without one, the engine scans every row. This recipe covers the index setup briefly, the Cascade service that runs the search, and the scoring patterns for ranked results.

## What `whereFullText` does

```ts
await Post.query()
  .whereFullText(["title", "body"], "cascade orm")
  .get();
```

- **Postgres** — translates to a `to_tsquery(...)` match against the combined `to_tsvector(title || ' ' || body)`. Without a GIN index on that vector expression, it's a sequential scan.
- **MongoDB** — translates to `$text: { $search: "cascade orm" }`. Requires a text index on the relevant fields.

The index lives in the migration; Cascade picks it up automatically once it exists. The [Migrations intro](../getting-started/04-migrations-intro.md) covers the column-builder syntax; consult your database's full-text docs for the specific index expression.

## The search service

```ts
import { Post } from "../models/post/post.model";

type SearchPostsInput = {
  query: string;
  limit?: number;
};

export async function searchPosts(input: SearchPostsInput) {
  return Post.query()
    .whereFullText(["title", "body"], input.query)
    .orderBy("createdAt", "desc")
    .limit(input.limit ?? 20)
    .get();
}
```

Plain query builder. The `whereFullText` call carries the index hint — the rest of the chain is the same vocabulary as every other query.

For combined filters (full-text + structured), chain them together:

```ts
return Post.query()
  .where("status", "published")
  .where("authorId", authorId)
  .whereFullText(["title", "body"], input.query)
  .orderBy("createdAt", "desc")
  .limit(input.limit ?? 20)
  .get();
```

The structured filters narrow the candidate set first; the full-text predicate runs against the remainder.

## Ranked results — driver-specific scoring

Default `whereFullText` results aren't sorted by relevance — they're returned in whatever order the index produces, plus your explicit `orderBy`. For real relevance ranking, project the driver's score expression with `selectRaw` and order by it:

```ts
import { Post } from "../models/post/post.model";

type RankedSearchInput = {
  query: string;
  limit?: number;
};

export async function rankedSearchPosts(input: RankedSearchInput) {
  return Post.query()
    .whereFullText(["title", "body"], input.query)
    .selectRaw(scoreExpression(input.query))
    .orderByRaw("score DESC")
    .limit(input.limit ?? 20)
    .get<PostRow & { score: number }>();
}
```

The `scoreExpression` helper holds the driver-specific bit:

```ts
function scoreExpression(query: string) {
  return {
    // Postgres
    expression: "ts_rank(to_tsvector('english', title || ' ' || body), to_tsquery('english', ?)) AS score",
    bindings: [query.split(/\s+/).join(" & ")],

    // MongoDB equivalent shape would be { score: { $meta: "textScore" } } via selectDriverProjection
  };
}
```

For cross-driver code, branch the helper by driver type and emit the right shape per side. See the [Expressions guide](../digging-deeper/expressions.md) for the `selectRaw` / `selectDriverProjection` mechanics.

## Common shapes

### "Exact phrase" search

Wrap the query in quotes to ask for an exact phrase rather than individual tokens:

```ts
await Post.query()
  .whereFullText(["title"], '"cascade orm"')
  .get();
```

Both drivers honour the quoting convention.

### Excluding stop words

Common words ("the", "a", "and") get filtered by the language analyzer your index was built with. On Postgres, `to_tsvector('english', ...)` uses the English stop-word list; pick a different language (`'french'`, `'german'`, ...) per the language of your content. On MongoDB, the text index has a `default_language` field with the same effect.

### Stemming

Both drivers stem words by default — "running" and "runs" both match "run". This is usually what you want; turn it off only if your content has technical terms (product codes, SKUs) where stems would over-match. The migration sets this via the index's `default_language` option.

## Combining with vector search

Full-text catches exact keyword matches; vector catches semantic similarity. For the best of both, run both queries and merge — covered in detail in the [Hybrid search recipe](./hybrid-search.md).

## Going further

- **The expressions vocabulary** for `selectRaw` and `orderByRaw` — [Expressions guide](../digging-deeper/expressions.md)
- **Hybrid search** combining full-text with vector — [Hybrid search recipe](./hybrid-search.md)
- **The full `whereFullText` signature** — [Query Builder API reference](../reference/query-builder-api.md#wherefulltext--orwherefulltext--wheresearch--textsearch)
