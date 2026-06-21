import type { BaseReport, Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { reportToSpan } from "./report-to-span";

function usage(input: number, output: number): Usage {
  return { input, output, total: input + output };
}

function baseReport(overrides: Partial<BaseReport> = {}): BaseReport {
  return {
    runId: "run-1",
    rootRunId: "run-1",
    name: "root-agent",
    type: "agent",
    status: "completed",
    startedAt: "2026-06-18T10:00:00.000Z",
    endedAt: "2026-06-18T10:00:01.000Z",
    duration: 1000,
    usage: usage(100, 50),
    children: [],
    ...overrides,
  };
}

describe("reportToSpan", () => {
  it("maps lineage and timing fields one-to-one", () => {
    const report = baseReport({
      runId: "run-7",
      rootRunId: "root-7",
      parentRunId: "parent-7",
      sessionId: "session-7",
      version: "2.1",
    });

    const span = reportToSpan(report);

    expect(span.spanId).toBe("run-7");
    expect(span.traceId).toBe("root-7");
    expect(span.parentSpanId).toBe("parent-7");
    expect(span.sessionId).toBe("session-7");
    expect(span.version).toBe("2.1");
    expect(span.startedAt).toBe("2026-06-18T10:00:00.000Z");
    expect(span.endedAt).toBe("2026-06-18T10:00:01.000Z");
    expect(span.duration).toBe(1000);
    expect(span.usage).toEqual(usage(100, 50));
  });

  it("omits optional lineage fields when the report lacks them", () => {
    const span = reportToSpan(baseReport());

    expect(span.parentSpanId).toBeUndefined();
    expect(span.sessionId).toBeUndefined();
    expect(span.version).toBeUndefined();
    expect(span.error).toBeUndefined();
  });

  it("recurses children in invocation order", () => {
    const report = baseReport({
      children: [
        baseReport({ runId: "child-a", parentRunId: "run-1", type: "tool", name: "toolA" }),
        baseReport({ runId: "child-b", parentRunId: "run-1", type: "tool", name: "toolB" }),
      ],
    });

    const span = reportToSpan(report);

    expect(span.children).toHaveLength(2);
    expect(span.children[0]?.spanId).toBe("child-a");
    expect(span.children[0]?.parentSpanId).toBe("run-1");
    expect(span.children[1]?.name).toBe("toolB");
  });

  it("normalizes an error carried on a tool node", () => {
    const error = Object.assign(new Error("429 Too Many Requests"), {
      code: "RATE_LIMIT",
    });

    const report = baseReport({
      type: "tool",
      status: "failed",
      error,
    } as Partial<BaseReport>);

    const span = reportToSpan(report);

    expect(span.status).toBe("failed");
    expect(span.error?.type).toBe("RATE_LIMIT");
    expect(span.error?.message).toBe("429 Too Many Requests");
    expect(span.error?.stack).toBeDefined();
  });

  it("surfaces agent model identity and trip count as attributes", () => {
    const report = baseReport({
      type: "agent",
      model: { name: "gpt-4o", provider: "openai" },
      trips: [{}, {}, {}],
    } as Partial<BaseReport>);

    const span = reportToSpan(report);

    expect(span.attributes).toEqual({
      "agent.trips": 3,
      "agent.model.name": "gpt-4o",
      "agent.model.provider": "openai",
    });
  });

  it("leaves attributes absent for a bare node", () => {
    const span = reportToSpan(baseReport({ trips: undefined } as Partial<BaseReport>));

    expect(span.attributes).toBeUndefined();
  });
});
