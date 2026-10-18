import type { ReportStatus } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { Trace } from "../contracts/trace.type";
import { matchTrace } from "./match-trace";

function trace(
  overrides: {
    traceId?: string;
    sessionId?: string;
    status?: ReportStatus;
    startedAt?: string;
  } = {},
): Trace {
  const startedAt = overrides.startedAt ?? "2026-06-18T10:00:00.000Z";

  return {
    traceId: overrides.traceId ?? "run-1",
    sessionId: overrides.sessionId,
    startedAt,
    endedAt: "2026-06-18T10:00:01.000Z",
    duration: 1000,
    usage: { input: 10, output: 5, total: 15 },
    root: {
      spanId: overrides.traceId ?? "run-1",
      traceId: overrides.traceId ?? "run-1",
      name: "agent",
      type: "agent",
      status: overrides.status ?? "completed",
      startedAt,
      endedAt: "2026-06-18T10:00:01.000Z",
      duration: 1000,
      usage: { input: 10, output: 5, total: 15 },
      children: [],
    },
  };
}

describe("matchTrace", () => {
  it("matches everything for an absent or empty filter", () => {
    expect(matchTrace(trace())).toBe(true);
    expect(matchTrace(trace(), {})).toBe(true);
  });

  it("filters by traceId", () => {
    expect(matchTrace(trace({ traceId: "a" }), { traceId: "a" })).toBe(true);
    expect(matchTrace(trace({ traceId: "a" }), { traceId: "b" })).toBe(false);
  });

  it("filters HTTP request ids independently of sessions", () => {
    const target = { ...trace({ sessionId: "conversation" }), requestId: "http-request" };
    expect(matchTrace(target, { requestId: "http-request", sessionId: "conversation" })).toBe(true);
    expect(matchTrace(target, { requestId: "conversation" })).toBe(false);
    expect(matchTrace(trace(), { requestId: "http-request" })).toBe(false);
  });

  it("filters by sessionId", () => {
    expect(matchTrace(trace({ sessionId: "s1" }), { sessionId: "s1" })).toBe(true);
    expect(matchTrace(trace({ sessionId: "s1" }), { sessionId: "s2" })).toBe(false);
    expect(matchTrace(trace(), { sessionId: "s1" })).toBe(false);
  });

  it("filters by single status and status array", () => {
    expect(matchTrace(trace({ status: "failed" }), { status: "failed" })).toBe(true);
    expect(matchTrace(trace({ status: "failed" }), { status: "completed" })).toBe(false);
    expect(matchTrace(trace({ status: "cancelled" }), { status: ["failed", "cancelled"] })).toBe(
      true,
    );
    expect(matchTrace(trace({ status: "completed" }), { status: ["failed", "cancelled"] })).toBe(
      false,
    );
  });

  it("filters by inclusive time window with string or Date bounds", () => {
    const target = trace({ startedAt: "2026-06-18T12:00:00.000Z" });

    expect(matchTrace(target, { startedAfter: "2026-06-18T11:00:00.000Z" })).toBe(true);
    expect(matchTrace(target, { startedAfter: "2026-06-18T13:00:00.000Z" })).toBe(false);
    expect(matchTrace(target, { startedBefore: new Date("2026-06-18T13:00:00.000Z") })).toBe(true);
    expect(matchTrace(target, { startedBefore: new Date("2026-06-18T11:00:00.000Z") })).toBe(false);
    expect(matchTrace(target, { startedAfter: "2026-06-18T12:00:00.000Z" })).toBe(true);
  });

  it("ANDs all declared fields", () => {
    const target = trace({
      sessionId: "s1",
      status: "completed",
      startedAt: "2026-06-18T12:00:00.000Z",
    });

    expect(matchTrace(target, { sessionId: "s1", status: "completed" })).toBe(true);
    expect(matchTrace(target, { sessionId: "s1", status: "failed" })).toBe(false);
  });
});
