import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application as ApplicationClass } from "../../../src/application/application";

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn() },
}));

/** Let queued microtasks/timers settle so async hooks have run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Application shutdown latch", () => {
  let Application: typeof ApplicationClass;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    ({ Application } = await import("../../../src/application/application"));
  });

  it("starts not shutting down", () => {
    expect(Application.isShuttingDown).toBe(false);
  });

  it("runs registered hooks when shutdown begins, in LIFO order", async () => {
    const order: string[] = [];
    Application.onShutdown(() => {
      order.push("first");
    });
    Application.onShutdown(() => {
      order.push("second");
    });

    await Application.runShutdownHooks();

    expect(Application.isShuttingDown).toBe(true);
    expect(order).toEqual(["second", "first"]);
  });

  it("awaits async hooks before resolving", async () => {
    let done = false;
    Application.onShutdown(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done = true;
    });

    await Application.runShutdownHooks();

    expect(done).toBe(true);
  });

  it("runs a hook registered after shutdown immediately", async () => {
    await Application.runShutdownHooks();

    const ran: string[] = [];
    Application.onShutdown(() => {
      ran.push("late");
    });
    await flush();

    expect(ran).toEqual(["late"]);
  });

  it("is idempotent — a second runShutdownHooks does nothing", async () => {
    let calls = 0;
    Application.onShutdown(() => {
      calls++;
    });

    await Application.runShutdownHooks();
    await Application.runShutdownHooks();

    expect(calls).toBe(1);
  });

  it("isolates a throwing hook and logs it, still running the rest", async () => {
    const { log } = await import("@warlock.js/logger");
    const ran: string[] = [];
    // LIFO: the throwing hook (registered last) runs first, then the survivor.
    Application.onShutdown(() => {
      ran.push("survivor");
    });
    Application.onShutdown(() => {
      throw new Error("boom");
    });

    await expect(Application.runShutdownHooks()).resolves.toBeUndefined();

    expect(ran).toEqual(["survivor"]);
    expect(log.error).toHaveBeenCalledWith("application", "shutdown-listener", expect.any(Error));
  });
});
