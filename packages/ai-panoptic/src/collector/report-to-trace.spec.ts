import type { BaseReport, Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { reportToTrace } from "./report-to-trace";

function usage(input: number, output: number): Usage {
  return { input, output, total: input + output };
}

function rootReport(overrides: Partial<BaseReport> = {}): BaseReport {
  return {
    runId: "run-1",
    rootRunId: "run-1",
    name: "root-agent",
    type: "agent",
    status: "completed",
    startedAt: "2026-06-18T10:00:00.000Z",
    endedAt: "2026-06-18T10:00:02.500Z",
    duration: 2500,
    usage: usage(300, 120),
    reportSchemaVersion: 1,
    children: [],
    ...overrides,
  };
}

describe("reportToTrace", () => {
  it("derives trace-level rollups from the root span", () => {
    const trace = reportToTrace(rootReport({ sessionId: "session-9" }));

    expect(trace.traceId).toBe("run-1");
    expect(trace.sessionId).toBe("session-9");
    expect(trace.startedAt).toBe("2026-06-18T10:00:00.000Z");
    expect(trace.endedAt).toBe("2026-06-18T10:00:02.500Z");
    expect(trace.duration).toBe(2500);
    expect(trace.usage).toEqual(usage(300, 120));
    expect(trace.reportSchemaVersion).toBe(1);
  });

  it("embeds the projected root span and its subtree", () => {
    const trace = reportToTrace(
      rootReport({
        children: [
          rootReport({ runId: "tool-1", parentRunId: "run-1", type: "tool", name: "search" }),
        ],
      }),
    );

    expect(trace.root.spanId).toBe("run-1");
    expect(trace.root.children).toHaveLength(1);
    expect(trace.root.children[0]?.spanId).toBe("tool-1");
  });

  it("omits sessionId and schema version when absent", () => {
    const trace = reportToTrace(
      rootReport({ sessionId: undefined, reportSchemaVersion: undefined }),
    );

    expect(trace.sessionId).toBeUndefined();
    expect(trace.reportSchemaVersion).toBeUndefined();
  });
});
