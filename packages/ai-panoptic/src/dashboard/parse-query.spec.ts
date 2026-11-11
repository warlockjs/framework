import { describe, expect, it } from "vitest";
import { DEFAULT_TRACE_LIST_LIMIT, parseListOptions, parseQuery } from "./parse-query";

/** Build a `URLSearchParams` from a query string for terse cases. */
function qs(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe("parseQuery", () => {
  it("returns an empty filter for an empty query string", () => {
    expect(parseQuery(qs(""))).toEqual({});
  });

  it("maps traceId and sessionId verbatim", () => {
    expect(parseQuery(qs("traceId=t1&sessionId=s9"))).toEqual({
      traceId: "t1",
      sessionId: "s9",
    });
  });

  it("maps a single status to a scalar", () => {
    expect(parseQuery(qs("status=failed"))).toEqual({ status: "failed" });
  });

  it("maps repeated status params to an array", () => {
    expect(parseQuery(qs("status=failed&status=cancelled"))).toEqual({
      status: ["failed", "cancelled"],
    });
  });

  it("drops unknown status tokens", () => {
    expect(parseQuery(qs("status=bogus"))).toEqual({});
  });

  it("keeps only the known statuses when mixed with junk", () => {
    expect(parseQuery(qs("status=completed&status=nope&status=failed"))).toEqual({
      status: ["completed", "failed"],
    });
  });

  it("maps startedAfter / startedBefore as ISO strings", () => {
    expect(
      parseQuery(
        qs("startedAfter=2026-06-01T00:00:00.000Z&startedBefore=2026-06-30T00:00:00.000Z"),
      ),
    ).toEqual({
      startedAfter: "2026-06-01T00:00:00.000Z",
      startedBefore: "2026-06-30T00:00:00.000Z",
    });
  });

  it("ignores empty and unknown params", () => {
    expect(parseQuery(qs("traceId=&foo=bar&sessionId="))).toEqual({});
  });

  it("combines every dimension into one filter", () => {
    expect(
      parseQuery(qs("sessionId=s1&status=failed&startedAfter=2026-06-01T00:00:00.000Z")),
    ).toEqual({
      sessionId: "s1",
      status: "failed",
      startedAfter: "2026-06-01T00:00:00.000Z",
    });
  });
});

describe("parseListOptions", () => {
  it("defaults to summaries capped at the default limit", () => {
    expect(parseListOptions(qs(""))).toEqual({ limit: DEFAULT_TRACE_LIST_LIMIT, full: false });
  });

  it("reads a positive integer limit and the full switch", () => {
    expect(parseListOptions(qs("limit=50&full=1"))).toEqual({ limit: 50, full: true });
    expect(parseListOptions(qs("full=true")).full).toBe(true);
  });

  it("falls back to the default for an invalid limit", () => {
    for (const value of ["0", "-3", "2.5", "abc", ""]) {
      expect(parseListOptions(qs(`limit=${value}`)).limit).toBe(DEFAULT_TRACE_LIST_LIMIT);
    }
  });
});
