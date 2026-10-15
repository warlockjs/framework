import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Application as ApplicationClass,
  BootContext,
} from "../../../src/application/application";

// Keep the suite hermetic: the boot latch never reaches the real logger.
vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn() },
}));

/** Let queued microtasks/timers settle so async boot listeners have run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const bootContext: BootContext = {
  environment: "test",
  runtimeStrategy: "development",
  bootDurationMs: 12,
};

describe("Application boot latch", () => {
  let Application: typeof ApplicationClass;

  beforeEach(async () => {
    // Fresh module per test so the static `booted` latch starts down.
    vi.resetModules();
    vi.clearAllMocks();
    ({ Application } = await import("../../../src/application/application"));
  });

  it("starts not booted", () => {
    expect(Application.isBooted).toBe(false);
  });

  it("runs a listener registered before boot once markBooted fires", async () => {
    const received: BootContext[] = [];
    Application.onceBooted((context) => {
      received.push(context);
    });

    expect(received).toHaveLength(0);

    Application.markBooted(bootContext);
    await flush();

    expect(Application.isBooted).toBe(true);
    expect(received).toEqual([bootContext]);
  });

  it("runs a listener registered after boot (fires immediately)", async () => {
    Application.markBooted(bootContext);

    const received: BootContext[] = [];
    Application.onceBooted((context) => {
      received.push(context);
    });
    await flush();

    expect(received).toEqual([bootContext]);
  });

  it("resolves whenBooted with the boot context", async () => {
    const pending = Application.whenBooted();

    Application.markBooted(bootContext);

    await expect(pending).resolves.toEqual(bootContext);
  });

  it("resolves whenBooted immediately when already booted", async () => {
    Application.markBooted(bootContext);

    await expect(Application.whenBooted()).resolves.toEqual(bootContext);
  });

  it("is idempotent — keeps the first context and never double-fires", async () => {
    let calls = 0;
    const received: BootContext[] = [];
    Application.onceBooted((context) => {
      calls++;
      received.push(context);
    });

    Application.markBooted(bootContext);
    Application.markBooted({ ...bootContext, bootDurationMs: 999 });
    await flush();

    // A listener added after the ignored second call still sees the FIRST context.
    Application.onceBooted((context) => {
      received.push(context);
    });
    await flush();

    expect(calls).toBe(1);
    expect(received).toEqual([bootContext, bootContext]);
  });

  it("isolates a throwing listener and logs it, still running the rest", async () => {
    const { log } = await import("@warlock.js/logger");
    const ran: string[] = [];

    Application.onceBooted(() => {
      throw new Error("boom");
    });
    Application.onceBooted(() => {
      ran.push("second");
    });

    expect(() => Application.markBooted(bootContext)).not.toThrow();
    await flush();

    expect(ran).toEqual(["second"]);
    expect(log.error).toHaveBeenCalledWith("application", "booted-listener", expect.any(Error));
  });
});
