import type { BaseReport, Usage } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace, TraceSpan } from "../contracts/trace.type";
import { panoptic } from "./panoptic";
import type { PanopticTarget } from "./panoptic-target.type";

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

/**
 * A minimal in-memory primitive that satisfies {@link PanopticTarget}.
 * Records every subscription so a test can assert which events were
 * subscribed to, fire a payload on demand, and verify the returned
 * unsubscribe function detaches the right handler.
 */
function fakeTarget(name = "fake-agent"): PanopticTarget & {
  handlers: Map<string, Set<(payload: unknown) => void>>;
  emit(event: string, payload: unknown): void;
} {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  return {
    name,
    handlers,
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);

      return () => {
        set.delete(handler);
      };
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
  };
}

describe("panoptic", () => {
  it("registers the supplied exporters on a freshly created collector", async () => {
    const exporter = recordingExporter("first");
    const observe = panoptic({ exporters: [exporter] });

    await observe.collect(rootReport());

    expect(exporter.traces).toHaveLength(1);
    expect(exporter.traces[0]?.traceId).toBe("run-1");
  });

  it("reuses a pre-built collector when one is injected", async () => {
    const exporter = recordingExporter("on-injected");
    const observe = panoptic({ exporters: [exporter] });
    const collector = observe.collector;

    const second = panoptic({ collector, exporters: [recordingExporter("extra")] });

    expect(second.collector).toBe(collector);

    await second.collect(rootReport());
    expect(exporter.traces).toHaveLength(1);
  });

  it("supports use() chaining after construction", async () => {
    const observe = panoptic();
    const exporter = recordingExporter("late");

    expect(observe.use(exporter)).toBe(observe);

    await observe.collect(rootReport());
    expect(exporter.traces).toHaveLength(1);
  });

  describe("attach", () => {
    it("subscribes to the default completed events and collects each run", async () => {
      const exporter = recordingExporter("attached");
      const observe = panoptic({ exporters: [exporter] });
      const target = fakeTarget();

      observe.attach(target);

      expect([...target.handlers.keys()]).toEqual([
        "agent.completed",
        "workflow.completed",
        "supervisor.completed",
      ]);

      target.emit("agent.completed", { result: { report: rootReport() } });
      await observe.flush();

      expect(exporter.traces).toHaveLength(1);
      expect(exporter.traces[0]?.traceId).toBe("run-1");
    });

    it("ignores a payload that carries no report tree", async () => {
      const exporter = recordingExporter("guarded");
      const observe = panoptic({ exporters: [exporter] });
      const target = fakeTarget();

      observe.attach(target);

      target.emit("agent.completed", { result: {} });
      target.emit("workflow.completed", { result: { report: { runId: 1 } } });
      await observe.flush();

      expect(exporter.traces).toHaveLength(0);
    });

    it("detaches every listener it added when the returned function runs", () => {
      const observe = panoptic();
      const target = fakeTarget();

      const detach = observe.attach(target);

      expect(target.handlers.get("agent.completed")?.size).toBe(1);

      detach();

      expect(target.handlers.get("agent.completed")?.size).toBe(0);
      expect(target.handlers.get("workflow.completed")?.size).toBe(0);
      expect(target.handlers.get("supervisor.completed")?.size).toBe(0);
    });

    it("honors a custom completedEvents list", () => {
      const observe = panoptic({ completedEvents: ["agent.completed"] });
      const target = fakeTarget();

      observe.attach(target);

      expect([...target.handlers.keys()]).toEqual(["agent.completed"]);
    });

    it("never surfaces an exporter failure on the emitting run", async () => {
      const broken: ExporterContract = {
        name: "broken",
        export() {
          throw new Error("exporter blew up");
        },
      };
      const observe = panoptic({ exporters: [broken] });
      const target = fakeTarget();

      observe.attach(target);

      expect(() =>
        target.emit("agent.completed", { result: { report: rootReport() } }),
      ).not.toThrow();
    });

    it("threads the envelope error onto a failed agent root span", async () => {
      const exporter = recordingExporter("attached-error");
      const observe = panoptic({ exporters: [exporter] });
      const target = fakeTarget();

      observe.attach(target);

      const error = Object.assign(new Error("429 Too Many Requests"), {
        code: "RATE_LIMIT",
      });

      target.emit("agent.completed", {
        result: { report: rootReport({ status: "failed" }), error },
      });
      await observe.flush();

      const root = exporter.traces[0]?.root;
      expect(root?.status).toBe("failed");
      expect(root?.error?.type).toBe("RATE_LIMIT");
      expect(root?.error?.message).toBe("429 Too Many Requests");
    });
  });

  describe("middleware", () => {
    it("returns an AgentMiddleware that collects from execute.after", async () => {
      const exporter = recordingExporter("mw-after");
      const observe = panoptic({ exporters: [exporter] });

      const mw = observe.middleware();

      expect(mw.name).toBe("panoptic");

      mw.execute?.after?.({} as never, { report: rootReport() } as never);
      await observe.flush();

      expect(exporter.traces).toHaveLength(1);
    });

    it("collects from execute.onError when the error carries a report", async () => {
      const exporter = recordingExporter("mw-error");
      const observe = panoptic({ exporters: [exporter] });

      const mw = observe.middleware();

      mw.execute?.onError?.(
        {} as never,
        Object.assign(new Error("boom"), {
          code: "AGENT_ERROR",
          report: rootReport({ status: "failed" }),
        }) as never,
      );
      await observe.flush();

      expect(exporter.traces).toHaveLength(1);
      const root = exporter.traces[0]?.root;
      expect(root?.status).toBe("failed");
      expect(root?.error?.type).toBe("AGENT_ERROR");
      expect(root?.error?.message).toBe("boom");
    });

    it("threads result.error onto the root span on a completed-with-error after()", async () => {
      const exporter = recordingExporter("mw-after-error");
      const observe = panoptic({ exporters: [exporter] });

      const mw = observe.middleware();

      mw.execute?.after?.(
        {} as never,
        {
          report: rootReport({ status: "failed" }),
          error: Object.assign(new Error("schema mismatch"), { code: "SCHEMA_ERROR" }),
        } as never,
      );
      await observe.flush();

      const root = exporter.traces[0]?.root;
      expect(root?.error?.type).toBe("SCHEMA_ERROR");
      expect(root?.error?.message).toBe("schema mismatch");
    });

    it("collects a supervisor run through the supervisor hook map", async () => {
      const exporter = recordingExporter("mw-supervisor");
      const observe = panoptic({ exporters: [exporter] });

      const mw = observe.middleware();

      expect(mw.supervisor?.after).toBeDefined();

      mw.supervisor?.after?.({} as never, { report: rootReport({ type: "supervisor" }) } as never);
      await observe.flush();

      expect(exporter.traces).toHaveLength(1);
      expect(exporter.traces[0]?.root.type).toBe("supervisor");
    });

    it("honors a custom middlewareName", () => {
      const observe = panoptic({ middlewareName: "panoptic-secondary" });

      expect(observe.middleware().name).toBe("panoptic-secondary");
    });
  });

  describe("collect / toTrace", () => {
    it("toTrace projects without dispatching to exporters", () => {
      const exporter = recordingExporter("noop");
      const observe = panoptic({ exporters: [exporter] });

      const trace = observe.toTrace(rootReport({ sessionId: "s1" }));

      expect(trace.traceId).toBe("run-1");
      expect(trace.sessionId).toBe("s1");
      expect(exporter.traces).toHaveLength(0);
    });
  });

  describe("lifecycle", () => {
    it("delegates flush and shutdown to the collector's exporters", async () => {
      const flush = vi.fn();
      const shutdown = vi.fn();
      const exporter: ExporterContract = {
        name: "lifecycle",
        export: vi.fn(),
        flush,
        shutdown,
      };
      const observe = panoptic({ exporters: [exporter] });

      await observe.flush();
      expect(flush).toHaveBeenCalledTimes(1);

      await observe.shutdown();
      expect(flush).toHaveBeenCalledTimes(2);
      expect(shutdown).toHaveBeenCalledTimes(1);
    });
  });
});
