import type { AgentCompactionRecord, BaseReport, LLMTrip } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { reportToTrace } from "./report-to-trace";

const report: BaseReport = {
  runId: "run",
  rootRunId: "run",
  name: "assistant",
  type: "agent",
  status: "incomplete",
  startedAt: "2026-10-19T10:00:00.000Z",
  endedAt: "2026-10-19T10:00:00.100Z",
  duration: 100,
  usage: { input: 100, output: 10, total: 110 },
  children: [],
};
const trip: LLMTrip = {
  index: 0,
  input: "private prompt",
  output: "private response",
  finishReason: "length",
  startedAt: report.startedAt,
  endedAt: report.endedAt,
  duration: 100,
  usage: { input: 100, output: 10, total: 110, cachedTokens: 80 },
  blocks: [{ provider: "provider", type: "compaction", data: { summary: "private summary" } }],
};

describe("trace diagnostic metadata", () => {
  it("retains cache, truncation, compaction decisions and retry timings without content", () => {
    const compactions: AgentCompactionRecord[] = [
      {
        type: "applied",
        tripIndex: 1,
        inputTokens: 1200,
        counting: "custom",
        compaction: {
          replacesFromIndex: 0,
          replacesToIndex: 4,
          summary: { role: "assistant", content: "private summary" },
        },
      },
      {
        type: "skipped",
        tripIndex: 2,
        counting: "estimate",
        reason: "callback-error",
        error: "private error",
      },
    ];
    const extended = {
      ...report,
      trips: [trip],
      compactions,
      attempts: [
        {
          index: 1,
          startedAt: report.startedAt,
          endedAt: report.endedAt,
          duration: 100,
          status: "failed" as const,
        },
      ],
    };
    const trace = reportToTrace(extended);
    expect(trace.root.status).toBe("incomplete");
    expect(trace.root.attributes).toMatchObject({
      "agent.cacheHits": 1,
      "agent.truncatedTrips": 1,
      "agent.providerCompactions": 1,
      retries: 1,
      "retry.attempts": [{ index: 1, duration: 100, status: "failed" }],
      "agent.compactions": [
        {
          type: "applied",
          tripIndex: 1,
          inputTokens: 1200,
          counting: "custom",
          replacesFromIndex: 0,
          replacesToIndex: 4,
        },
        { type: "skipped", tripIndex: 2, counting: "estimate", reason: "callback-error" },
      ],
    });
    expect(JSON.stringify(trace)).not.toContain("private");
  });

  it("distinguishes unreported cache hits from a reported zero and records context truncation", () => {
    const synthetic = {
      ...trip,
      blocks: undefined,
      finishReason: "stop" as const,
      usage: { input: 0, output: 0, total: 0 },
    };
    const syntheticReport = { ...report, trips: [synthetic] };
    expect(reportToTrace(syntheticReport).root.attributes?.["agent.cacheHits"]).toBeUndefined();
    const zero = {
      ...trip,
      finishReason: "context_exceeded" as const,
      usage: { ...trip.usage, cachedTokens: 0 },
    };
    const extended = { ...report, trips: [zero] };
    expect(reportToTrace(extended).root.attributes).toMatchObject({
      "agent.cacheHits": 0,
      "agent.truncatedTrips": 1,
    });
  });
});
