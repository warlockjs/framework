import type { RequestLogRecord, RequestLogSummary } from "@warlock.js/core";
import { describe, expect, it } from "vitest";
import {
  filterFromQuery,
  hasFilter,
  mergeRequestHistory,
  recordToDetail,
  rowToSummary,
  summaryToRow,
} from "../src/request-history";
import type { DevtoolsRequestSummary } from "../src/types";

function live(id: string, startedAt: number): DevtoolsRequestSummary {
  return {
    id,
    method: "GET",
    path: "/posts",
    route: "/posts",
    status: 200,
    startedAt,
    durationMs: 5,
    queryCount: 1,
    warningCount: 0,
  };
}

function row(id: string, startedAt: number): RequestLogSummary {
  return {
    id,
    time: new Date(startedAt).toISOString(),
    method: "GET",
    url: "/old",
    status: 500,
    durationMs: 9,
    queryCount: 4,
    nPlusOneCount: 1,
  };
}

describe("mergeRequestHistory", () => {
  it("adds persisted rows the ring buffer no longer has, newest first", () => {
    const merged = mergeRequestHistory([live("a", 3000), live("b", 1000)], [row("c", 2000)], 10);

    expect(merged.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(merged[1]).toMatchObject({ persisted: true, queryCount: 4, warningCount: 1, path: "/old" });
  });

  it("does not duplicate a request found in both, and keeps the live one", () => {
    const merged = mergeRequestHistory([live("a", 3000)], [row("a", 3000), row("a", 3000)], 10);

    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toHaveProperty("persisted");
    expect(merged[0]?.path).toBe("/posts");
  });

  it("honours the limit", () => {
    const merged = mergeRequestHistory([live("a", 3), live("b", 2)], [row("c", 1)], 2);

    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("row conversion", () => {
  it("round-trips the fields a filter reads", () => {
    const summary = live("a", Date.UTC(2026, 0, 1));

    expect(summaryToRow(summary)).toMatchObject({
      id: "a",
      method: "GET",
      url: "/posts",
      route: "/posts",
      status: 200,
      time: "2026-01-01T00:00:00.000Z",
    });
    expect(rowToSummary(summaryToRow(summary))).toMatchObject({ id: "a", startedAt: summary.startedAt });
  });
});

describe("filterFromQuery", () => {
  it("reads the known filters and ignores the rest", () => {
    expect(
      filterFromQuery({ status: " 5xx ", route: "", method: "post", q: "abc", since: "1h", other: "x", limit: "20" }),
    ).toEqual({ status: "5xx", method: "post", q: "abc", since: "1h", limit: 20 });
  });

  it("knows whether a filter narrows anything", () => {
    expect(hasFilter(filterFromQuery({}))).toBe(false);
    expect(hasFilter(filterFromQuery({ limit: "5" }))).toBe(false);
    expect(hasFilter(filterFromQuery({ q: "x" }))).toBe(true);
  });
});

describe("recordToDetail", () => {
  it("rebuilds an in-memory shaped detail from a persisted record", () => {
    const record: RequestLogRecord = {
      type: "request",
      id: "r1",
      traceId: "r1",
      time: "2026-01-01T00:00:00.000Z",
      method: "POST",
      url: "/posts",
      route: { pattern: "/posts", name: "posts.create" },
      status: 500,
      durationMs: 40,
      response: {},
      error: { message: "boom", name: "Error", stack: "Error: boom" },
      phases: [{ name: "handler", durationMs: 30 }],
      logs: [
        { level: "error", module: "http", action: "request-error", message: "boom", at: 5 },
        { level: "fatal", module: "app", action: "x", message: "down", at: 6, context: { a: 1 } },
      ],
      queries: { count: 8, nPlusOne: [{ query: "select ?", count: 7 }] },
    };

    const detail = recordToDetail(record);

    expect(detail).toMatchObject({
      id: "r1",
      path: "/posts",
      route: "/posts",
      status: 500,
      error: "boom",
      persisted: true,
      queries: [],
      phases: [{ name: "handler", durationMs: 30 }],
      warnings: [{ type: "n+1", shape: "select ?", count: 7 }],
    });
    expect(detail.logs.map((entry) => entry.level)).toEqual(["error", "error"]);
    expect(detail.logs[1]?.context).toEqual({ a: 1 });
    expect(detail.record).toBe(record);
  });
});
