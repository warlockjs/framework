/**
 * Trace id derivation: a valid W3C
 * `traceparent` gives the trace id; otherwise fall back to `request.id`.
 */
import { describe, expect, it } from "vitest";
import { deriveTraceId, parseTraceparentTraceId } from "./trace-id";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const ALL_ZERO_TRACE = "00-00000000000000000000000000000000-00f067aa0ba902b7-01";

describe("parseTraceparentTraceId — valid", () => {
  it("extracts the 32-hex trace id from a well-formed version-00 header", () => {
    expect(parseTraceparentTraceId(VALID)).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTraceparentTraceId(`  ${VALID}  `)).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

describe("parseTraceparentTraceId — invalid", () => {
  it("rejects an all-zero trace id (reserved 'no trace')", () => {
    expect(parseTraceparentTraceId(ALL_ZERO_TRACE)).toBeUndefined();
  });

  it("rejects a non-00 version", () => {
    expect(
      parseTraceparentTraceId("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    ).toBeUndefined();
  });

  it("rejects a trace id shorter than 32 hex chars", () => {
    expect(parseTraceparentTraceId("00-abc123-00f067aa0ba902b7-01")).toBeUndefined();
  });

  it("rejects a trace id with non-hex characters", () => {
    expect(
      parseTraceparentTraceId("00-zzzz2f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    ).toBeUndefined();
  });

  it("rejects garbage input", () => {
    expect(parseTraceparentTraceId("not-a-traceparent")).toBeUndefined();
  });
});

describe("parseTraceparentTraceId — absent", () => {
  it("returns undefined for undefined input", () => {
    expect(parseTraceparentTraceId(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseTraceparentTraceId("")).toBeUndefined();
  });
});

describe("deriveTraceId", () => {
  it("uses the traceparent's trace id when valid", () => {
    expect(deriveTraceId(VALID, "request-id-1")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("falls back to request.id when the header is invalid", () => {
    expect(deriveTraceId("garbage", "request-id-1")).toBe("request-id-1");
  });

  it("falls back to request.id when the header is absent", () => {
    expect(deriveTraceId(undefined, "request-id-1")).toBe("request-id-1");
  });
});
