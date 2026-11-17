import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthHistory } from "../../../src/production/insights";

describe("createHealthHistory", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is unknown before the first check", () => {
    const history = createHealthHistory({ readiness: async () => ({ status: "ok" }) });

    expect(history.report()).toEqual({
      status: "unknown",
      checkedAt: null,
      checks: {},
      history: [],
    });
  });

  it("records the status, the checks and the failed names", async () => {
    vi.setSystemTime(5000);
    const history = createHealthHistory({
      readiness: async () => ({ status: "error", checks: { db: false, cache: true } }),
    });
    const report = await history.check();

    expect(report.status).toBe("error");
    expect(report.checkedAt).toBe(5000);
    expect(report.checks).toEqual({ db: false, cache: true });
    expect(report.history).toEqual([{ at: 5000, status: "error", failed: ["db"] }]);
  });

  it("checks on its interval and keeps only `size` entries", async () => {
    const readiness = vi.fn(async () => ({ status: "ok" as const }));
    const history = createHealthHistory({ intervalMs: 1000, size: 2, readiness });

    history.start();
    await vi.advanceTimersByTimeAsync(3000);
    history.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(readiness).toHaveBeenCalledTimes(4);
    expect(history.report().history).toHaveLength(2);
  });

  it("survives a failing reader and keeps the last answer", async () => {
    let fail = false;
    const history = createHealthHistory({
      readiness: async () => {
        if (fail) throw new Error("core not loaded");

        return { status: "ok" };
      },
    });

    await history.check();
    fail = true;
    const report = await history.check();

    expect(report.status).toBe("ok");
    expect(report.history).toHaveLength(1);
  });

  it("records nothing while the app boots, and checks again a second later", async () => {
    let booted = false;
    const readiness = vi.fn(async () =>
      booted ? { status: "ok" as const, checks: { db: true } } : null,
    );
    const history = createHealthHistory({ intervalMs: 30_000, readiness });

    history.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(history.report()).toMatchObject({ status: "unknown", history: [] });

    booted = true;
    await vi.advanceTimersByTimeAsync(1000);
    history.stop();

    expect(history.report().status).toBe("ok");
    expect(history.report().history).toHaveLength(1);
    expect(readiness).toHaveBeenCalledTimes(2);
  });

  it("stays unknown when the reader never works", async () => {
    const history = createHealthHistory({
      readiness: async () => {
        throw new Error("nope");
      },
    });

    expect((await history.check()).status).toBe("unknown");
  });
});
