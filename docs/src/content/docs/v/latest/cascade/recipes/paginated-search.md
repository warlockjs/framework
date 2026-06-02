---
title: "Paginated search"
sidebar:
  order: 9
  label: "Paginated search"
---

A search service that filters, paginates, and sorts. Plain query builder — no fancy patterns.

## The service

```ts
import { User } from "../models/user/user.model";

type SearchUsersInput = {
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortField?: "createdAt" | "name" | "email";
  sortDir?: "asc" | "desc";
};

export async function searchUsers(input: SearchUsersInput) {
  const query = User.query();

  if (input.q) {
    query.whereLike("name", `%${input.q}%`);
  }

  if (input.status) {
    query.where("status", input.status);
  }

  query.orderBy(input.sortField ?? "createdAt", input.sortDir ?? "desc");

  return query.paginate({
    page: input.page ?? 1,
    limit: input.limit ?? 20,
  });
}
```

`paginate` returns `{ data, pagination: { total, page, limit, pages } }`. Rows in `data` are hydrated `User` instances; `toJSON()` runs through the model's `static resource` when the response is serialized.

`sortField` is a string union — TypeScript refuses anything outside the allowlist at compile time, so the caller can't ask the database to order by `password` or any other column you didn't list.

## Adding a relation count

To include the number of posts each user has:

```ts
const query = User.query();

if (input.q) {
  query.whereLike("name", `%${input.q}%`);
}

query.withCount("posts");
query.orderBy("createdAt", "desc");

return query.paginate({ page: input.page ?? 1, limit: input.limit ?? 20 });
```

Each result row now has a `postsCount` field. Cheaper than `.with("posts")` when you only need the size.

## Cursor pagination — when offset breaks down

Offset pagination scans and discards `(page - 1) * limit` rows on every request. For large lists or infinite-scroll UIs, switch to cursor:

```ts
type CursorSearchInput = {
  q?: string;
  cursor?: string;
  limit?: number;
};

export async function searchUsersCursor(input: CursorSearchInput) {
  const query = User.query();

  if (input.q) {
    query.whereLike("name", `%${input.q}%`);
  }

  query.orderBy("id", "asc");

  return query.cursorPaginate({
    cursor: input.cursor,
    limit: input.limit ?? 20,
    column: "id",
  });
}
```

The contract:

- The caller passes the previous response's `nextCursor` as the next request's `cursor`.
- No `total` or `pages` — there's no constant-cost way to know either for a cursor query.
- Needs a stable, indexed sort column. `id`, `createdAt`, and ULIDs all work.

Use offset for admin lists and "show me page 47" UX. Use cursor for public infinite scrolls and any list that could blow past 10k rows.

## Going further

- **The full query vocabulary** — [Querying essentials](../the-basics/02-querying.md)
- **Cursor vs offset signatures** — [Query Builder API reference](../reference/query-builder-api.md#paginateoptions)
- **Resource shaping** for different audiences — [Resources guide](../the-basics/resources.md)
- **Auditing the search** — [Audit trail recipe](./audit-trail.md)
