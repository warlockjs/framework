import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Job } from "./job";

const held = new Set<string>();
const lockKeys: string[] = [];

// Fake shared cache: a create-only set succeeds only for the first caller per
// key, and the claim is never released (it only expires).
vi.mock("@warlock.js/cache", () => ({
  cache: {
    set: async (key: string, _value: unknown, options: { onConflict?: string }) => {
      lockKeys.push(key);

      if (options?.onConflict !== "create") throw new Error("expected a create-only claim");
      if (held.has(key)) return { wasSet: false, existing: "other" };

      held.add(key);

      return { wasSet: true, existing: null };
    },
  },
}));

const NOW = new Date("2026-05-11T10:00:00.400Z");

beforeEach(() => {
  held.clear();
  lockKeys.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Job.onOneServer()", () => {
  it("runs the handler once per tick across two servers with the same key", async () => {
    const handler = vi.fn(async () => {});
    const a = new Job("report", handler).everyMinute().onOneServer();
    const b = new Job("report", handler).everyMinute().onOneServer();

    vi.setSystemTime(new Date(a.nextRun!.valueOf() + 300));
    const [ra, rb] = await Promise.all([a.run(), b.run()]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect([ra.skipped, rb.skipped].filter(Boolean)).toHaveLength(1);
    expect(lockKeys[0]).toBe(lockKeys[1]);
    expect(lockKeys[0]).toMatch(/^scheduler\.report\.\d+000$/);
  });

  it("a server whose tick fires late, after the winner finished, still skips that tick", async () => {
    const handler = vi.fn(async () => {});
    const a = new Job("report", handler).everyMinute().onOneServer();
    const b = new Job("report", handler).everyMinute().onOneServer();
    const tick = a.nextRun!.valueOf();

    vi.setSystemTime(new Date(tick + 300));
    await a.run();

    vi.setSystemTime(new Date(tick + 5_000));
    const late = await b.run();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(late.skipped).toBe(true);
  });

  it("honors a custom key", async () => {
    const j = new Job("x", async () => {}).everyMinute().onOneServer({ key: "shared" });

    await j.run();

    expect(lockKeys[0]).toMatch(/^scheduler\.shared\.\d+000$/);
  });

  it("servers that booted at different times share every interval tick", async () => {
    const handler = vi.fn(async () => {});
    const a = new Job("renewals", handler).everyMinute().onOneServer();
    a.prepare();

    // The second server boots 1.7 s later.
    vi.setSystemTime(new Date(NOW.valueOf() + 1_700));
    const b = new Job("renewals", handler).everyMinute().onOneServer();
    b.prepare();

    expect(a.nextRun!.valueOf()).toBe(b.nextRun!.valueOf());
    expect(a.nextRun!.toISOString()).toBe("2026-05-11T10:01:00.000Z");
    // Not due at boot: it waits for the shared boundary.
    expect(a.isDue()).toBe(false);

    vi.setSystemTime(new Date("2026-05-11T10:01:00.300Z"));
    await a.run();
    vi.setSystemTime(new Date("2026-05-11T10:01:02.100Z"));
    await b.run();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(lockKeys[0]).toBe(lockKeys[1]);

    // Both advance from the scheduled tick, not from when they finished.
    expect(a.nextRun!.toISOString()).toBe("2026-05-11T10:02:00.000Z");
    expect(b.nextRun!.toISOString()).toBe("2026-05-11T10:02:00.000Z");
  });

  it("a run that ends exactly on its boundary does not repeat the tick", async () => {
    const j = new Job("edge", async () => {}).everyMinute().onOneServer();
    j.prepare();
    vi.setSystemTime(j.nextRun!.toDate());

    await j.run();

    expect(j.nextRun!.toISOString()).toBe("2026-05-11T10:02:00.000Z");
  });

  it("aligns in the job's timezone and leaves at() schedules alone", () => {
    const hourly = new Job("tz", async () => {})
      .everyHours(1)
      .inTimezone("Asia/Kolkata")
      .onOneServer();
    // UTC+05:30: the top of the local hour is hh:30 UTC.
    expect(hourly.nextRun!.toISOString()).toBe("2026-05-11T10:30:00.000Z");

    const daily = new Job("daily", async () => {}).daily().at("09:00").onOneServer();
    expect(daily.nextRun!.format("YYYY-MM-DD HH:mm")).toBe("2026-05-12 09:00");
  });

  it("throws when the job has no name or key", () => {
    expect(() => new Job("", async () => {}).onOneServer()).toThrow(/stable across servers/);
  });
});
