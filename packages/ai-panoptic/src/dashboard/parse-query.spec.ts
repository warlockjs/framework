import { describe, expect, it } from "vitest";
import { parseQuery } from "./parse-query";

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
      parseQuery(qs("startedAfter=2026-06-01T00:00:00.000Z&startedBefore=2026-06-30T00:00:00.000Z")),
    ).toEqual({
      startedAfter: "2026-06-01T00:00:00.000Z",
      startedBefore: "2026-06-30T00:00:00.000Z",
    });
  });

  it("ignores empty and unknown params", () => {
    expect(parseQuery(qs("traceId=&foo=bar&sessionId="))).toEqual({});
  });

  it("combines every dimension into one filter", () => {
    expect(parseQuery(qs("sessionId=s1&status=failed&startedAfter=2026-06-01T00:00:00.000Z"))).toEqual({
      sessionId: "s1",
      status: "failed",
      startedAfter: "2026-06-01T00:00:00.000Z",
    });
  });
});
