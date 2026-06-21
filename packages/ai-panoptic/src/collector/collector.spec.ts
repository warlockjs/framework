import type { BaseReport, Usage } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace, TraceSpan } from "../contracts/trace.type";
import { createCollector } from "./collector";

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
    endedAt: "2026-06-18T10:00:01.000Z",
    duration: 1000,
    usage: usage(100, 50),
    children: [],
    ...overrides,
  };
}

type RecordingExporter = ExporterContract & {
  traces: Trace[];
  spans: TraceSpan[];
};

function recordingExporter(name: string, withSpan = false): RecordingExporter {
  const traces: Trace[] = [];
  const spans: TraceSpan[] = [];

  const exporter: RecordingExporter = {
    name,
    traces,
    spans,
    export(trace) {
      traces.push(trace);
    },
  };

  if (withSpan) {
    exporter.exportSpan = (span) => {
      spans.push(span);
    };
  }

  return exporter;
}

describe("createCollector", () => {
  it("projects a report and dispatches the trace to every exporter", async () => {
    const first = recordingExporter("first");
    const second = recordingExporter("second");
    const collector = createCollector().use(first).use(second);

    await collector.collect(rootReport({ sessionId: "s1" }));

    expect(first.traces).toHaveLength(1);
    expect(second.traces).toHaveLength(1);
    expect(first.traces[0]?.traceId).toBe("run-1");
    expect(first.traces[0]?.sessionId).toBe("s1");
  });

  it("invokes exportSpan with the root span when advertised", async () => {
    const exporter = recordingExporter("streaming", true);
    const collector = createCollector().use(exporter);

    await collector.collect(rootReport());

    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]?.spanId).toBe("run-1");
  });

  it("delivers every span in a multi-node tree to exportSpan exactly once", async () => {
    const exporter = recordingExporter("per-span", true);
    const collector = createCollector().use(exporter);

    const report = rootReport({
      children: [
        rootReport({
          runId: "child-a",
          rootRunId: "run-1",
          parentRunId: "run-1",
          name: "agent-a",
          children: [
            rootReport({
              runId: "leaf",
              rootRunId: "run-1",
              parentRunId: "child-a",
              name: "tool",
              type: "tool",
            }),
          ],
        }),
        rootReport({
          runId: "child-b",
          rootRunId: "run-1",
          parentRunId: "run-1",
          name: "agent-b",
        }),
      ],
    });

    await collector.collect(report);

    const exportedIds = exporter.spans.map((span) => span.spanId);
    expect(exportedIds).toEqual(["run-1", "child-a", "leaf", "child-b"]);
    expect(new Set(exportedIds).size).toBe(exportedIds.length);
  });

  it("threads the envelope rootError onto a failed root span that has none", async () => {
    const exporter = recordingExporter("rooted-error");
    const collector = createCollector().use(exporter);

    const failure = Object.assign(new Error("model exploded"), {
      code: "MODEL_ERROR",
    });

    await collector.collect(rootReport({ status: "failed" }), failure);

    const root = exporter.traces[0]?.root;
    expect(root?.status).toBe("failed");
    expect(root?.error?.type).toBe("MODEL_ERROR");
    expect(root?.error?.message).toBe("model exploded");
  });

  it("dedupes exporters by name", async () => {
    const exporter = recordingExporter("dup");
    const collector = createCollector().use(exporter).use(exporter);

    await collector.collect(rootReport());

    expect(exporter.traces).toHaveLength(1);
  });

  it("isolates a throwing exporter from its siblings", async () => {
    const broken: ExporterContract = {
      name: "broken",
      export() {
        throw new Error("exporter blew up");
      },
    };
    const healthy = recordingExporter("healthy");
    const collector = createCollector().use(broken).use(healthy);

    await expect(collector.collect(rootReport())).resolves.toBeUndefined();
    expect(healthy.traces).toHaveLength(1);
  });

  it("exposes toTrace as a pure projection without dispatching", () => {
    const exporter = recordingExporter("noop");
    const collector = createCollector().use(exporter);

    const trace = collector.toTrace(rootReport());

    expect(trace.traceId).toBe("run-1");
    expect(exporter.traces).toHaveLength(0);
  });

  it("flushes and shuts down every exporter, then clears them", async () => {
    const flush = vi.fn();
    const shutdown = vi.fn();
    const exporter: ExporterContract = {
      name: "lifecycle",
      export: vi.fn(),
      flush,
      shutdown,
    };
    const collector = createCollector().use(exporter);

    await collector.flush();
    expect(flush).toHaveBeenCalledTimes(1);

    await collector.shutdown();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledTimes(1);

    await collector.collect(rootReport());
    expect(exporter.export).not.toHaveBeenCalled();
  });

  it("isolates a throwing flush during shutdown", async () => {
    const exporter: ExporterContract = {
      name: "bad-flush",
      export: vi.fn(),
      flush() {
        throw new Error("flush failed");
      },
    };
    const collector = createCollector().use(exporter);

    await expect(collector.shutdown()).resolves.toBeUndefined();
  });
});
