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

describe("reportToSpan content capture", () => {
  it("omits input/output by default (capture off)", () => {
    const report = baseReport({
      type: "agent",
      trips: [{ input: "hello", output: "world" }],
    } as Partial<BaseReport>);

    const span = reportToSpan(report);

    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
  });

  it("captures an agent's first-trip prompt and final response", () => {
    const report = baseReport({
      type: "agent",
      trips: [
        { input: "the real prompt", output: "first reply" },
        { input: "[tool results]", output: "the final answer" },
      ],
    } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.input).toBe("the real prompt");
    expect(span.output).toBe("the final answer");
  });

  it("captures a tool's args and result", () => {
    const report = baseReport({
      type: "tool",
      name: "search",
      input: { query: "coffee" },
      output: { hits: 3 },
    } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.input).toEqual({ query: "coffee" });
    expect(span.output).toEqual({ hits: 3 });
  });

  it("applies a redactor and drops a value it returns undefined for", () => {
    const report = baseReport({
      type: "tool",
      input: "secret-key",
      output: "ok",
    } as Partial<BaseReport>);

    const span = reportToSpan(report, {
      captureContent: true,
      redactContent: (value, { field }) => (field === "input" ? undefined : `[${String(value)}]`),
    });

    expect(span.input).toBeUndefined(); // redactor returned undefined → field dropped
    expect(span.output).toBe("[ok]");
  });

  it("leaves content absent for a composite node with no own I/O", () => {
    const report = baseReport({ type: "workflow", name: "flow" } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
  });

  it("captures content recursively through the subtree", () => {
    const report = baseReport({
      type: "agent",
      trips: [{ input: "outer", output: "outer-done" }],
      children: [
        baseReport({
          runId: "t",
          type: "tool",
          name: "search",
          input: { q: "x" },
          output: { ok: true },
        } as Partial<BaseReport>),
      ],
    } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.input).toBe("outer");
    expect(span.children[0]?.input).toEqual({ q: "x" });
    expect(span.children[0]?.output).toEqual({ ok: true });
  });

  it("captures the last NON-EMPTY trip output (failure / max-trips safe)", () => {
    const report = baseReport({
      type: "agent",
      trips: [
        { input: "do it", output: "the answer" },
        { input: "[tool results]", output: "" }, // empty final trip (failed / capped)
      ],
    } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.output).toBe("the answer"); // not the empty final trip
  });

  it("leaves output absent when no trip produced text", () => {
    const report = baseReport({
      type: "agent",
      trips: [{ input: "x", output: "" }],
    } as Partial<BaseReport>);

    const span = reportToSpan(report, { captureContent: true });

    expect(span.output).toBeUndefined();
  });
});
