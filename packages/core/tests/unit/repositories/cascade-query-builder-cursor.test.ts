import { describe, expect, it } from "vitest";
import { CascadeQueryBuilder } from "../../../src/repositories/adapters/cascade/cascade-query-builder";

/**
 * Cursor-pagination behavior of CascadeQueryBuilder.cursorPaginate — in
 * particular the backward (`direction: "prev"`) path, which previously returned
 * rows in descending order with a meaningless prevCursor.
 *
 * The wrapper is fed a fake inner Cascade query that records `limit()` and
 * returns a fixed dataset from `get()`. The caller (RepositoryManager) is
 * responsible for the WHERE + ORDER BY; here we simulate the rows that scan
 * would yield for each direction.
 *
 * Source: core/src/repositories/adapters/cascade/cascade-query-builder.ts
 */
type Row = { id: number };

/**
 * Build a fake inner Cascade query whose `get()` returns `rows`.
 * `limitArg` captures the LIMIT the wrapper requests (limit + 1).
 */
function makeInnerQuery(rows: Row[]) {
  const state = { limitArg: undefined as number | undefined };

  const query: any = {
    limit: (value: number) => {
      state.limitArg = value;
      return query;
    },
    get: async () => rows,
  };

  return { query, state };
}

function builder(rows: Row[]) {
  const { query, state } = makeInnerQuery(rows);
  return { wrapper: new CascadeQueryBuilder<any>(query), state };
}

describe("CascadeQueryBuilder.cursorPaginate — forward (next)", () => {
  it("returns the page ascending and derives next/prev cursors from boundaries", async () => {
    // Caller scanned ASC where id > cursor; fetched limit+1 = 4 rows.
    const { wrapper, state } = builder([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);

    const result = await wrapper.cursorPaginate({ limit: 3, cursor: 0, direction: "next" });

    expect(state.limitArg).toBe(4); // fetched limit + 1
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.result).toBe(3);
    // nextCursor is the last (largest) row; prevCursor is the first (smallest).
    expect(result.pagination.nextCursor).toBe(3);
    expect(result.pagination.prevCursor).toBe(1);
  });

  it("omits nextCursor when there is no further page", async () => {
    const { wrapper } = builder([{ id: 1 }, { id: 2 }]);

    const result = await wrapper.cursorPaginate({ limit: 3, cursor: 0, direction: "next" });

    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextCursor).toBeUndefined();
    expect(result.pagination.prevCursor).toBe(1);
  });
});

describe("CascadeQueryBuilder.cursorPaginate — backward (prev)", () => {
  it("re-reverses the descending scan to ascending and derives cursors from boundaries", async () => {
    // Caller scanned DESC where id < cursor; fetched limit+1 = 4 rows
    // (descending): 9, 8, 7, 6. The extra (smallest, id 6) is the limit+1th.
    const { wrapper, state } = builder([{ id: 9 }, { id: 8 }, { id: 7 }, { id: 6 }]);

    const result = await wrapper.cursorPaginate({ limit: 3, cursor: 10, direction: "prev" });

    expect(state.limitArg).toBe(4);
    // Page is presented ascending: 7, 8, 9 (the extra 6 was dropped).
    expect(result.data).toEqual([{ id: 7 }, { id: 8 }, { id: 9 }]);
    expect(result.pagination.hasMore).toBe(true);
    // Going further back continues from this page's first (smallest) row.
    expect(result.pagination.prevCursor).toBe(7);
    // Going forward resumes after this page's last (largest) row.
    expect(result.pagination.nextCursor).toBe(9);
  });

  it("omits prevCursor when the backward scan has no further page", async () => {
    // Only 2 rows came back descending: 9, 8 — fewer than limit+1, so no more.
    const { wrapper } = builder([{ id: 9 }, { id: 8 }]);

    const result = await wrapper.cursorPaginate({ limit: 3, cursor: 10, direction: "prev" });

    expect(result.data).toEqual([{ id: 8 }, { id: 9 }]);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.prevCursor).toBeUndefined();
    // nextCursor still points past the last row so the user can move forward.
    expect(result.pagination.nextCursor).toBe(9);
  });
});
