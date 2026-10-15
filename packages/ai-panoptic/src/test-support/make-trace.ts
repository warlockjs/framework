import type { ReportStatus, ReportType, Usage } from "@warlock.js/ai";
import type { Trace, TraceSpan } from "../contracts/trace.type";

/** Overrides for {@link makeTrace} — every field is optional. */
export type MakeTraceOverrides = {
  traceId?: string;
  sessionId?: string;
  status?: ReportStatus;
  /** Root span discriminator — defaults to `"agent"`. */
  type?: ReportType;
  startedAt?: string;
  endedAt?: string;
  duration?: number;
  usage?: Usage;
  name?: string;
  /** Child spans to nest under the root (for span-tree assertions). */
  children?: TraceSpan[];
  /**
   * Prompt-version linkage to stamp onto the root span's `attributes`
   * (`agent.promptName` / `agent.promptVersion`) — exactly the shape the
   * collector emits for a run that resolved a named `ai.prompts` builder.
   * When `promptName` is set, `promptVersion` defaults to `"1"`.
   */
  promptName?: string;
  promptVersion?: string;
};

const DEFAULT_USAGE: Usage = { input: 100, output: 50, total: 150 };

/**
 * Build a JSON-safe {@link Trace} fixture for store + dashboard tests.
 * Mirrors the shape `reportToTrace` produces (root span + trace-wide
 * rollups) without needing a real report tree. Defaults make a single
 * completed agent trace; override any field for variety.
 *
 * @example
 * const store = createInMemoryTraceStore();
 * store.add(makeTrace({ traceId: "t1", status: "failed" }));
 */
export function makeTrace(overrides: MakeTraceOverrides = {}): Trace {
  const traceId = overrides.traceId ?? "trace-1";
  const startedAt = overrides.startedAt ?? "2026-06-22T10:00:00.000Z";
  const endedAt = overrides.endedAt ?? "2026-06-22T10:00:01.000Z";
  const duration = overrides.duration ?? 1000;
  const usage = overrides.usage ?? DEFAULT_USAGE;
  const status = overrides.status ?? "completed";
  const name = overrides.name ?? "agent";

  const root: TraceSpan = {
    spanId: traceId,
    traceId,
    name,
    type: overrides.type ?? "agent",
    status,
    startedAt,
    endedAt,
    duration,
    usage,
    children: overrides.children ?? [],
  };

  if (overrides.sessionId !== undefined) {
    root.sessionId = overrides.sessionId;
  }

  if (overrides.promptName !== undefined) {
    root.attributes = {
      ...root.attributes,
      "agent.promptName": overrides.promptName,
      "agent.promptVersion": overrides.promptVersion ?? "1",
    };
  }

  return {
    traceId,
    sessionId: overrides.sessionId,
    root,
    startedAt,
    endedAt,
    duration,
    usage,
  };
}

/** Build a child {@link TraceSpan} (e.g. a tool span) for nesting. */
export function makeSpan(overrides: Partial<TraceSpan> & { spanId: string; traceId: string }): TraceSpan {
  return {
    name: "tool",
    type: "tool",
    status: "completed",
    startedAt: "2026-06-22T10:00:00.100Z",
    endedAt: "2026-06-22T10:00:00.200Z",
    duration: 100,
    usage: { input: 0, output: 0, total: 0 },
    children: [],
    ...overrides,
  };
}
