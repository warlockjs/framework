import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startReportWriter } from "../../../src/production/insights";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import { fakeReporter, report } from "./helpers";

const production = {
  reportIntervalMs: 10_000,
  requestRetentionHours: 24,
  auditRetentionDays: 90,
} as never;

describe("startReportWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("writes at start and every reportIntervalMs", async () => {
    const store = createMemoryStore();
    const write = vi.spyOn(store.reports, "write");
    const reporter = fakeReporter("a", () => report("a", Date.now()));
    const writer = startReportWriter({ reporter, store, production });

    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(write).toHaveBeenCalledTimes(4);
    expect((await store.reports.list(0))[0]!.instance.id).toBe("a");
    await writer.stop();
  });

  it("prunes every table every 10 minutes", async () => {
    const store = createMemoryStore();
    const spies = {
      reports: vi.spyOn(store.reports, "prune"),
      samples: vi.spyOn(store.samples, "prune"),
      sessions: vi.spyOn(store.sessions, "removeExpired"),
      invites: vi.spyOn(store.invites, "removeExpired"),
      audit: vi.spyOn(store.audit, "prune"),
    };
    const writer = startReportWriter({
      reporter: fakeReporter("a", () => report("a", Date.now())),
      store,
      production,
    });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(spies.reports).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);

    const now = Date.now();

    expect(spies.reports).toHaveBeenCalledWith(now - 5 * 60_000);
    expect(spies.samples).toHaveBeenCalledWith(now - 24 * 3_600_000);
    expect(spies.sessions).toHaveBeenCalledWith(now);
    expect(spies.invites).toHaveBeenCalledWith(now);
    expect(spies.audit).toHaveBeenCalledWith(now - 90 * 86_400_000);
    await writer.stop();
  });

  it("keeps pruning when one table fails", async () => {
    const store = createMemoryStore();

    vi.spyOn(store.reports, "prune").mockRejectedValue(new Error("db down"));
    const audit = vi.spyOn(store.audit, "prune");
    const warn = vi.fn();
    const writer = startReportWriter({
      reporter: fakeReporter("a", () => report("a", Date.now())),
      store,
      production,
      warn,
    });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(audit).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("db down"));
    await writer.stop();
  });

  it("logs a failed write at most once a minute and never throws", async () => {
    const store = createMemoryStore();

    vi.spyOn(store.reports, "write").mockRejectedValue(new Error("write failed"));
    const warn = vi.fn();
    const writer = startReportWriter({
      reporter: fakeReporter("a", () => report("a", Date.now())),
      store,
      production,
      warn,
    });

    await vi.advanceTimersByTimeAsync(50_000);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(warn).toHaveBeenCalledTimes(2);
    await expect(writer.writeNow()).resolves.toBeUndefined();
    await writer.stop();
  });

  it("writes nothing after stop", async () => {
    const store = createMemoryStore();
    const write = vi.spyOn(store.reports, "write");
    const writer = startReportWriter({
      reporter: fakeReporter("a", () => report("a", Date.now())),
      store,
      production,
    });

    await vi.advanceTimersByTimeAsync(0);
    await writer.stop();
    write.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    await writer.writeNow();
    expect(write).not.toHaveBeenCalled();
  });
});
