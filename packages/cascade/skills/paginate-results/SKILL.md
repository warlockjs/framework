---
name: paginate-results
description: 'Paginate query results — `.paginate({page, limit, filter?})` for offset (returns `data` + `pagination` total/page/limit/pages), `.cursorPaginate({limit, cursor})` for very large datasets, `.chunk(size, callback)` for streaming. Triggers: `.paginate`, `.cursorPaginate`, `.chunk`, `nextCursor`, `hasMore`, `pagination.total`; "paginate the list", "infinite scroll / load more", "stream a large table", "page 2 of users"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: filter chain — `@warlock.js/cascade/query-data/SKILL.md`; eager loading on pages — `@warlock.js/cascade/define-relations/SKILL.md`; competing libs `mongoose-paginate-v2`, `prisma` cursor, `typeorm-pagination`.'
---

# Paginate results

Three paginations. Pick by dataset size and access pattern.

## Offset pagination — `.paginate({ page, limit })`

The everyday case for listings with page numbers:

```ts
const page = await User.paginate({ page: 1, limit: 20 });

page.data;        // User[]
page.pagination;  // { total, page, limit, pages }
```

`PaginationOptions` is `{ page?, limit? }` — there is no `filter` field; filter by chaining `.where()` before `.paginate()` (below).

Chain off `.where()` for filtered pagination:

```ts
const activePage = await User
  .where("status", "active")
  .paginate({ page: 2, limit: 20 });
```

**Cost characteristic.** Offset pagination scans `offset + limit` rows on every page — page 100 with limit 20 scans 2020 rows just to skip 2000. Fine for the first few pages; not great deep in the result set.

## Cursor pagination — `.cursorPaginate({ limit, cursor? })`

For very large datasets where deep pagination matters:

```ts
const first = await User.query().orderBy("created_at", "desc").cursorPaginate({ limit: 20 });

first.data;                   // User[]
first.pagination.nextCursor;  // opaque value — pass to the next call
first.pagination.hasMore;     // boolean

const next = await User.query()
  .orderBy("created_at", "desc")
  .cursorPaginate({ limit: 20, cursor: first.pagination.nextCursor });
```

The cursor fields live under `pagination` (`{ hasMore, nextCursor?, hasPrev?, prevCursor? }`), not at the top level. `cursorPaginate` and `orderBy` are query-builder methods, so start the chain with `User.query()` (or any static that returns a builder, like `User.where(...)`).

**Cost characteristic.** Constant time per page regardless of how far in. The cursor encodes the last record's sort key — the next query is "give me records after this point," indexed.

**Tradeoff.** No "total page count" — cursor pagination doesn't know how many records remain. If the UI shows "Page 3 of 50," reach for `.paginate()` instead. If it shows "Load more," cursor wins.

## Chunked processing — `.chunk(size, callback)`

For backfills, exports, and "process every record" loops:

```ts
await User.where("status", "active").chunk(500, async (users) => {
  for (const user of users) {
    await sendEmail(user);
  }
});
```

`.chunk(size, fn)` streams the table 500 records at a time, calling `fn` per batch. Constant memory regardless of total row count.

Return `false` from the callback to stop early:

```ts
let processed = 0;
await User.query().chunk(500, async (users) => {
  for (const user of users) {
    await process(user);
    processed++;
    if (processed >= 10_000) return false;
  }
});
```

`chunk` is a query-builder method — start from `User.query()` (or `User.where(...)`) before chaining it.

## Pagination + relations

Eager-load relations on a paginated page:

```ts
const page = await Post.with("author").paginate({ page: 1, limit: 20 });
```

See [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md).

## Pagination shape

The default offset paginator returns:

```ts
{
  data: T[],
  pagination: {
    total: number,    // total matching records (extra COUNT query)
    page: number,     // current page
    limit: number,    // page size
    pages: number,    // total pages
  },
}
```

The total count requires an extra query. On very large filtered tables, this can dominate page-load time — switch to cursor pagination if the total isn't user-facing.

## Things NOT to do

- Don't use offset pagination for "Load more" infinite-scroll UIs. Cursor pagination is built for it; offset re-scans on every load.
- Don't fetch `.all()` and slice in memory for pagination. Always page at the query layer.
- Don't omit `.orderBy()` from `.cursorPaginate()`. The cursor encodes the sort key — without one, the cursor is meaningless and ordering is driver-dependent.
- Don't keep cursor strings around past their stability window — schema changes that alter the sort key can invalidate stored cursors.

## See also

- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — `.where`, `.orderBy`, filter chains
- [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md) — eager loading on a paginated page
