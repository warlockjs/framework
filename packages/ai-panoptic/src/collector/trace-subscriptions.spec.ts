import { AsyncLocalStorage } from "node:async_hooks";
import type { BaseReport } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { createCollector } from "./collector";
import { subscribeTraces } from "./trace-subscriptions";

const report: BaseReport = {
  runId: "run-1",
  rootRunId: "run-1",
  name: "assistant",
  type: "agent",
  status: "completed",
  startedAt: "2026-10-19T10:00:00.000Z",
  endedAt: "2026-10-19T10:00:00.100Z",
  duration: 100,
  usage: { input: 10, output: 5, total: 15 },
  children: [],
};

describe("subscribeTraces", () => {
  it("sees existing and future collectors synchronously in each request context, without replay", async () => {
    const context = new AsyncLocalStorage<string>();
    const existing = createCollector();
    await existing.collect(report);
    const seen: Array<[string, string | undefined]> = [];
    const dispose = subscribeTraces((trace) => {
      seen.push([trace.traceId, context.getStore()]);
    });
    try {
      existing.toTrace(report);
      expect(seen).toEqual([]);
      const first = context.run("request-a", () => existing.collect(report));
      const second = context.run("request-b", () =>
        createCollector().collect({ ...report, runId: "run-2", rootRunId: "run-2" }),
      );
      expect(seen).toEqual([
        ["run-1", "request-a"],
        ["run-2", "request-b"],
      ]);
      await Promise.all([first, second]);
      dispose();
      await existing.collect(report);
      expect(seen).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it("isolates sync and async listener failures and still exports", async () => {
    const sink = vi.fn();
    const next = vi.fn();
    const disposers = [
      subscribeTraces(() => {
        throw new Error("subscriber unavailable");
      }),
      subscribeTraces(async () => {
        throw new Error("async subscriber unavailable");
      }),
      subscribeTraces(next),
    ];
    try {
      await expect(
        createCollector().use({ name: "sink", export: sink }).collect(report),
      ).resolves.toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(sink).toHaveBeenCalledOnce();
    } finally {
      disposers.forEach((dispose) => dispose());
    }
  });

  it("disposes duplicate callback registrations independently", async () => {
    const listener = vi.fn();
    const first = subscribeTraces(listener);
    const second = subscribeTraces(listener);
    try {
      first();
      first();
      await createCollector().collect(report);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      first();
      second();
    }
  });
});
