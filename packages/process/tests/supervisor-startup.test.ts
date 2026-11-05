import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSetupTimeoutMs } from "../src/platform";
import { ProcessStartupError, supervisor, terminalPid } from "../src/supervisor";

/** A ConPTY-like terminal that reports `pid` only once `readyAt` has passed on the fake clock. */
function fakeConPty(readyAt: number, pid = 4242) {
  const startedAt = Date.now();
  return {
    kill: vi.fn(),
    get pid() {
      return Date.now() - startedAt >= readyAt ? pid : 0;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal pid wait", () => {
  it("supervises under the real pid once a pid 0 ConPTY reports it after 2 s", async () => {
    vi.useFakeTimers();
    const terminal = fakeConPty(2000);
    const pending = terminalPid(terminal, 10_000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(4242);
  });

  it("returns at once when the pid is already known", async () => {
    vi.useFakeTimers();
    await expect(terminalPid(fakeConPty(0), 10_000)).resolves.toBe(4242);
  });

  it("fails with a typed startup error when no real pid arrives within pidWaitMs", async () => {
    vi.useFakeTimers();
    const terminal = fakeConPty(Number.POSITIVE_INFINITY);
    const pending = terminalPid(terminal, 10_000).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ProcessStartupError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "ProcessStartupError", reason: "no-pid" });
    expect((error as Error).message).toContain("10000 ms");
  });

  it("never returns pid 0 when the wait is disabled", async () => {
    await expect(terminalPid(fakeConPty(Number.POSITIVE_INFINITY), 0)).rejects.toMatchObject({
      reason: "no-pid",
    });
  });

  it.each([-1, 1.5, Number.NaN])("rejects an invalid pidWaitMs of %s", (pidWaitMs) => {
    expect(() =>
      supervisor({ owner: "example-app", registry: "unused-registry.json", pidWaitMs }),
    ).toThrow("Invalid pidWaitMs");
  });

  it.each([0, 99, 1.5])("rejects an invalid setupTimeoutMs of %s", (setupTimeoutMs) => {
    expect(() =>
      supervisor({ owner: "example-app", registry: "unused-registry.json", setupTimeoutMs }),
    ).toThrow("Invalid setupTimeoutMs");
  });
});

describe("setup timeout default", () => {
  it.each(["win32", "darwin", "freebsd"])("waits 30 s on %s", (platform) => {
    expect(defaultSetupTimeoutMs(platform)).toBe(30_000);
  });

  it("waits 5 s on linux", () => {
    expect(defaultSetupTimeoutMs("linux")).toBe(5000);
  });
});
