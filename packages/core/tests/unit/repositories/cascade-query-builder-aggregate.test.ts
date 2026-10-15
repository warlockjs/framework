import { describe, expect, it, vi } from "vitest";
import { CascadeQueryBuilder } from "../../../src/repositories/adapters/cascade/cascade-query-builder";

/**
 * Aggregate forwarding of CascadeQueryBuilder — sum/avg/min/max are pure
 * scalar executors that delegate straight to the inner Cascade query, while
 * groupBy applies grouping + aggregates and executes via get(), and aggregate
 * is the whole-set variant (groupBy with no group key) returning the single
 * summary row.
 *
 * The inner Cascade query is faked: builder methods are chainable spies and the
 * scalar executors / get() return fixed values. This pins the wrapper's
 * delegation shape WITHOUT a real database.
 *
 * Source: core/src/repositories/adapters/cascade/cascade-query-builder.ts
 */

/** Fake inner Cascade query: chainable groupBy, stubbable scalar executors + get(). */
function makeInnerQuery(rows: any[]) {
  const query: any = {
    sum: vi.fn(async () => 250),
    avg: vi.fn(async () => 12.5),
    min: vi.fn(async () => 1),
    max: vi.fn(async () => 99),
    // groupBy is chainable on the Cascade builder; get() executes it.
    groupBy: vi.fn(() => query),
    get: vi.fn(async () => rows),
  };

  return query;
}

describe("CascadeQueryBuilder — scalar aggregates", () => {
  it("sum / avg / min / max forward the field straight to the inner query", async () => {
    const inner = makeInnerQuery([]);
    const wrapper = new CascadeQueryBuilder<any>(inner);

    expect(await wrapper.sum("total")).toBe(250);
    expect(await wrapper.avg("total")).toBe(12.5);
    expect(await wrapper.min("total")).toBe(1);
    expect(await wrapper.max("total")).toBe(99);

    expect(inner.sum).toHaveBeenCalledWith("total");
    expect(inner.avg).toHaveBeenCalledWith("total");
    expect(inner.min).toHaveBeenCalledWith("total");
    expect(inner.max).toHaveBeenCalledWith("total");
  });
});

describe("CascadeQueryBuilder — groupBy", () => {
  it("applies fields + aggregates then executes via get(), returning the rows", async () => {
    const rows = [
      { status: "paid", count: 3 },
      { status: "pending", count: 1 },
    ];
    const inner = makeInnerQuery(rows);
    const wrapper = new CascadeQueryBuilder<any>(inner);
    const aggregates = { count: { __agg: "count", __field: null } };

    const result = await wrapper.groupBy("status", aggregates);

    expect(inner.groupBy).toHaveBeenCalledWith("status", aggregates);
    expect(inner.get).toHaveBeenCalledTimes(1);
    expect(result).toEqual(rows);
  });
});

describe("CascadeQueryBuilder — aggregate (whole-set)", () => {
  it("groups with no group key and returns the single summary row", async () => {
    const summary = { total: 250, avg: 125 };
    const inner = makeInnerQuery([summary]);
    const wrapper = new CascadeQueryBuilder<any>(inner);
    const aggregates = {
      total: { __agg: "sum", __field: "total" },
      avg: { __agg: "avg", __field: "total" },
    };

    const result = await wrapper.aggregate(aggregates);

    // Empty group key => one group over the whole filtered set.
    expect(inner.groupBy).toHaveBeenCalledWith([], aggregates);
    expect(result).toEqual(summary);
  });

  it("returns null when the aggregate produces no rows", async () => {
    const inner = makeInnerQuery([]);
    const wrapper = new CascadeQueryBuilder<any>(inner);

    const result = await wrapper.aggregate({ total: { __agg: "sum", __field: "total" } });

    expect(result).toBeNull();
  });
});
