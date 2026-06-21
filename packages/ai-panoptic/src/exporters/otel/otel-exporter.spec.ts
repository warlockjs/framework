import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";

// Mock the OPTIONAL peer so the suite runs without @opentelemetry/api
// installed. Records every span the exporter starts so we can assert the
// mapping (name, times, attributes, status, parent tree).
type RecordedSpan = {
  name: string;
  startTime: unknown;
  attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  exceptions: unknown[];
  endTime?: unknown;
  parentContextId: number | undefined;
};

const recorded: RecordedSpan[] = [];

vi.mock("@opentelemetry/api", () => {
  const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 };
  let contextCounter = 0;

  function makeOtelSpan(name: string, startTime: unknown, parentContextId: number | undefined) {
    const entry: RecordedSpan = {
      name,
      startTime,
      attributes: {},
      exceptions: [],
      parentContextId,
    };
    recorded.push(entry);

    return {
      __entry: entry,
      setAttributes(attributes: Record<string, unknown>) {
        Object.assign(entry.attributes, attributes);
      },
      setStatus(status: { code: number; message?: string }) {
        entry.status = status;
      },
      recordException(exception: unknown) {
        entry.exceptions.push(exception);
      },
      end(endTime: unknown) {
        entry.endTime = endTime;
      },
    };
  }

  const tracer = {
    startSpan(name: string, options: { startTime: unknown }, context: { id: number | undefined }) {
      return makeOtelSpan(name, options.startTime, context?.id);
    },
  };

  return {
    SpanStatusCode,
    trace: {
      getTracer: () => tracer,
      setSpan: (_context: unknown, span: { __entry: RecordedSpan }) => {
        contextCounter += 1;
        span.__entry.endTime = span.__entry.endTime; // no-op, keep ref
        return { id: recorded.indexOf(span.__entry) };
      },
    },
    context: {
      active: () => ({ id: undefined }),
    },
  };
});

const { otelExporter } = await import("./otel-exporter");

describe("otelExporter", () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it("should advertise the otel name", () => {
    expect(otelExporter().name).toBe("otel");
  });

  it("should start one OTel span per trace span with mapped name and times", async () => {
    const exporter = otelExporter();

    await exporter.export(
      makeTrace(makeSpan({ name: "checkout", startedAt: "2026-06-18T10:00:00.000Z" })),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].name).toBe("checkout");
    expect(recorded[0].startTime).toBe(Date.parse("2026-06-18T10:00:00.000Z"));
    expect(recorded[0].endTime).toBe(Date.parse("2026-06-18T10:00:01.000Z"));
  });

  it("should set GenAI token attributes", async () => {
    const exporter = otelExporter();

    await exporter.export(
      makeTrace(makeSpan({ usage: { input: 10, output: 20, total: 30 } })),
    );

    expect(recorded[0].attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(recorded[0].attributes["gen_ai.usage.output_tokens"]).toBe(20);
  });

  it("should default gen_ai.system from options when the span has none", async () => {
    const exporter = otelExporter({ system: "openai" });

    await exporter.export(makeTrace(makeSpan()));

    expect(recorded[0].attributes["gen_ai.system"]).toBe("openai");
  });

  it("should not override a span-supplied gen_ai.system", async () => {
    const exporter = otelExporter({ system: "openai" });

    await exporter.export(
      makeTrace(makeSpan({ attributes: { "gen_ai.system": "anthropic" } })),
    );

    expect(recorded[0].attributes["gen_ai.system"]).toBe("anthropic");
  });

  it("should set ERROR status and record an exception for failed spans", async () => {
    const exporter = otelExporter();

    await exporter.export(
      makeTrace(
        makeSpan({
          status: "failed",
          error: { type: "ToolError", message: "boom", stack: "at x" },
        }),
      ),
    );

    expect(recorded[0].status?.code).toBe(2);
    expect(recorded[0].status?.message).toBe("boom");
    expect(recorded[0].exceptions).toHaveLength(1);
  });

  it("should map a hit iteration cap to UNSET, not OK", async () => {
    const exporter = otelExporter();

    await exporter.export(makeTrace(makeSpan({ status: "max-iterations" })));

    expect(recorded[0].status?.code).toBe(0);
    expect(recorded[0].status?.message).toContain("iteration cap");
    expect(recorded[0].exceptions).toHaveLength(0);
  });

  it("should map an awaiting-input pause to UNSET", async () => {
    const exporter = otelExporter();

    await exporter.export(makeTrace(makeSpan({ status: "awaiting-input" })));

    expect(recorded[0].status?.code).toBe(0);
    expect(recorded[0].status?.message).toContain("awaiting");
  });

  it("should map a clean completion to OK", async () => {
    const exporter = otelExporter();

    await exporter.export(makeTrace(makeSpan({ status: "completed" })));

    expect(recorded[0].status?.code).toBe(1);
  });

  it("should emit a span per node and preserve the parent tree", async () => {
    const exporter = otelExporter();

    const root = makeSpan({
      spanId: "a",
      name: "router",
      children: [makeSpan({ spanId: "b", name: "tool", type: "tool" })],
    });

    await exporter.export(makeTrace(root));

    expect(recorded.map((span) => span.name)).toEqual(["router", "tool"]);
    expect(recorded[0].parentContextId).toBeUndefined();
    expect(recorded[1].parentContextId).toBe(0);
  });

  it("should set gen_ai.prompt/completion from captured content (stringifying non-strings)", async () => {
    const exporter = otelExporter();

    await exporter.export(makeTrace(makeSpan({ input: "the prompt", output: { answer: 42 } })));

    expect(recorded[0].attributes["gen_ai.prompt"]).toBe("the prompt");
    expect(recorded[0].attributes["gen_ai.completion"]).toBe('{"answer":42}');
  });

  it("should omit gen_ai.prompt/completion when no content was captured", async () => {
    const exporter = otelExporter();

    await exporter.export(makeTrace(makeSpan()));

    expect(recorded[0].attributes["gen_ai.prompt"]).toBeUndefined();
    expect(recorded[0].attributes["gen_ai.completion"]).toBeUndefined();
  });
});
