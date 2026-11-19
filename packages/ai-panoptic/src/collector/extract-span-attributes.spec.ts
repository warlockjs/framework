import type { BaseReport } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { extractSpanAttributes } from "./extract-span-attributes";

function agentReport(extra: Record<string, unknown> = {}): BaseReport {
  return {
    runId: "run-1",
    rootRunId: "run-1",
    name: "shop-agent",
    type: "agent",
    status: "completed",
    startedAt: "2026-06-18T10:00:00.000Z",
    endedAt: "2026-06-18T10:00:01.000Z",
    duration: 1000,
    usage: { input: 1, output: 1, total: 2 },
    children: [],
    ...extra,
  } as BaseReport;
}

function trip(finishReason: string) {
  return { index: 0, finishReason, usage: { input: 1, output: 1, total: 2 } };
}

describe("extractSpanAttributes — fallback and refusal counts", () => {
  it("copies fallbackTrips when the report has it", () => {
    const attributes = extractSpanAttributes(agentReport({ fallbackTrips: 2 }));

    expect(attributes?.["agent.fallbackTrips"]).toBe(2);
  });

  it("leaves fallbackTrips off when the report has none", () => {
    const attributes = extractSpanAttributes(agentReport({ trips: [trip("stop")] }));

    expect(attributes).not.toHaveProperty("agent.fallbackTrips");
  });

  it("counts trips that finished with a refusal", () => {
    const attributes = extractSpanAttributes(
      agentReport({ trips: [trip("refusal"), trip("stop"), trip("refusal")] }),
    );

    expect(attributes?.["agent.refusals"]).toBe(2);
  });

  it("omits agent.refusals when no trip was refused", () => {
    const attributes = extractSpanAttributes(agentReport({ trips: [trip("stop")] }));

    expect(attributes).not.toHaveProperty("agent.refusals");
  });
});
