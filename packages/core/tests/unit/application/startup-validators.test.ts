import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Application as ApplicationClass,
  BootContext,
} from "../../../src/application/application";

// Keep the suite hermetic: nothing here should reach the real logger.
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

describe("Application startup validators (D7)", () => {
  let Application: typeof ApplicationClass;

  beforeEach(async () => {
    // Fresh module per test so the static `validated`/`booted` latches start down.
    vi.resetModules();
    vi.clearAllMocks();
    ({ Application } = await import("../../../src/application/application"));
  });

  it("a resolving validator lets runStartupValidators resolve — boot can proceed", async () => {
    let ran = false;
    Application.onValidateBoot(() => {
      ran = true;
    });

    await expect(Application.runStartupValidators()).resolves.toBeUndefined();
    expect(ran).toBe(true);

    // The contract this hook exists for: nothing stops the caller from
    // proceeding to markBooted/late-connector startup after this resolves.
    expect(() => Application.markBooted(bootContext)).not.toThrow();
    expect(Application.isBooted).toBe(true);
  });

  it("a rejecting validator makes runStartupValidators reject, naming the validator and the cause", async () => {
    function requireJwtSecret() {
      throw new Error("JWT_SECRET is not set");
    }

    Application.onValidateBoot(requireJwtSecret);

    await expect(Application.runStartupValidators()).rejects.toThrow(
      /Startup validator "requireJwtSecret" rejected boot: JWT_SECRET is not set/,
    );
  });

  it("preserves the original error as `cause` on the thrown validation error", async () => {
    const original = new Error("JWT_SECRET is not set");
    Application.onValidateBoot(() => {
      throw original;
    });

    try {
      await Application.runStartupValidators();
      throw new Error("expected runStartupValidators to reject");
    } catch (error) {
      expect((error as Error).cause).toBe(original);
    }
  });

  it("a later validator does not run once an earlier one has rejected", async () => {
    let secondRan = false;
    Application.onValidateBoot(() => {
      throw new Error("first fails");
    });
    Application.onValidateBoot(() => {
      secondRan = true;
    });

    await expect(Application.runStartupValidators()).rejects.toThrow();
    expect(secondRan).toBe(false);
  });

  it("does not swallow the rejection through the logger — unlike a boot listener", async () => {
    const { log } = await import("@warlock.js/logger");
    Application.onValidateBoot(() => {
      throw new Error("boom");
    });

    await expect(Application.runStartupValidators()).rejects.toThrow();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("is idempotent — a second runStartupValidators is a no-op", async () => {
    let calls = 0;
    Application.onValidateBoot(() => {
      calls++;
    });

    await Application.runStartupValidators();
    await Application.runStartupValidators();

    expect(calls).toBe(1);
  });

  it("refuses a validator registered after runStartupValidators already ran", async () => {
    await Application.runStartupValidators();

    expect(() => Application.onValidateBoot(() => {})).toThrow(
      /startup validators already ran/,
    );
  });

  it("regression: a rejecting ORDINARY boot listener still cannot break boot (existing behaviour, pinned against D7)", async () => {
    const { log } = await import("@warlock.js/logger");
    const ran: string[] = [];

    // A startup validator is registered too, resolving cleanly, to prove the
    // two hooks are independent: a listener's rejection never reaches the
    // validator path and vice versa.
    Application.onValidateBoot(() => {
      ran.push("validator");
    });
    Application.onceBooted(() => {
      throw new Error("a plugin's onceBooted listener blew up");
    });
    Application.onceBooted(() => {
      ran.push("second-listener");
    });

    await expect(Application.runStartupValidators()).resolves.toBeUndefined();
    expect(() => Application.markBooted(bootContext)).not.toThrow();
    await flush();

    expect(Application.isBooted).toBe(true);
    expect(ran).toEqual(["validator", "second-listener"]);
    expect(log.error).toHaveBeenCalledWith("application", "booted-listener", expect.any(Error));
  });

  it("ordering contract: validators are a separate step the caller must await before markBooted — Application does not chain them itself", async () => {
    // This pins the CONTRACT (validators and `markBooted` are decoupled
    // primitives; the framework entry point is responsible for calling
    // `runStartupValidators` and awaiting it before starting late-phase
    // connectors / calling `markBooted`), not the real dev-server/production
    // boot sequence — that ordering against the http connector actually
    // starting to listen lives outside `core/src/application` (in
    // `dev-server/development-server.ts` and `production/production-builder.ts`)
    // and is not exercised by this harness.
    const order: string[] = [];
    let resolveValidator!: () => void;

    Application.onValidateBoot(
      () =>
        new Promise<void>((resolve) => {
          resolveValidator = () => {
            order.push("validator");
            resolve();
          };
        }),
    );

    const validation = Application.runStartupValidators();

    // markBooted has NOT been called yet — the caller is expected to await
    // validation first. Application itself does not enforce this ordering;
    // it only guarantees the validator's own rejection surfaces (see the
    // rejection tests above). A caller that skips the `await` gets no
    // protection, which is exactly why this is a documented contract on
    // `runStartupValidators`, not an automatic gate.
    expect(order).toEqual([]);

    resolveValidator();
    await validation;

    Application.markBooted(bootContext);
    order.push("markBooted");

    expect(order).toEqual(["validator", "markBooted"]);
  });
});
