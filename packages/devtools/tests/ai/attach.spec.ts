import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { attachAiReports, loadAiFeed } from "../../src/ai/attach";

const feed = (listeners: ((trace: unknown) => void)[] = []) => ({
  subscribe: (listener: (trace: never) => void) => {
    listeners.push(listener as never);

    return () => listeners.splice(listeners.indexOf(listener as never), 1);
  },
  totalCost: () => undefined,
  observationOff: () => false,
});
const options = (over: object = {}) => ({
  reports: true,
  retentionDays: 30,
  flushIntervalMs: 60_000,
  mode: "development" as const,
  ...over,
});

describe("loadAiFeed", () => {
  it("answers the unavailable view with null command and detail", async () => {
    const result = await loadAiFeed({
      load: () => Promise.reject(new Error("nope")),
      version: () => null,
    });

    expect(result).toEqual({
      unavailable: expect.objectContaining({
        available: false,
        reason: "ai-missing",
        command: "warlock add ai",
        detail: null,
      }),
    });
  });

  it("returns the feed and run helpers when Panoptic loads", async () => {
    const result = await loadAiFeed({
      load: async () => ({
        subscribeTraces: () => () => {},
        totalCostUsd: () => 1,
        filterTraces: () => [],
      }),
    });

    expect("feed" in result && result.feed.totalCost({} as never)).toBe(1);
    expect("helpers" in result && typeof result.helpers.filterTraces).toBe("function");
  });
});

describe("attachAiReports", () => {
  it("answers reports-off when the option is off", async () => {
    const reports = await attachAiReports({
      feed: feed(),
      options: options({ reports: false }),
      warn: vi.fn(),
    });

    expect(reports).toMatchObject({ available: false, reason: "reports-off", command: null });
  });

  it("subscribes the writer in development and unsubscribes on dispose", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-rollups-"));
    const listeners: ((trace: unknown) => void)[] = [];

    try {
      const reports = await attachAiReports({
        feed: feed(listeners),
        options: options(),
        directory,
        warn: vi.fn(),
      });

      expect(reports.available).toBe(true);
      expect(listeners).toHaveLength(1);

      if (!reports.available) return;

      expect(await reports.service.report({})).toMatchObject({
        available: true,
        totals: { runs: 0 },
      });
      await reports.dispose();
      expect(listeners).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
