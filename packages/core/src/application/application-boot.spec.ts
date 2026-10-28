import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Application } from "./application";

type BootState = { booted: boolean; bootContext: unknown; bootListeners: unknown[] };

function resetBootState(): void {
  const state = Application as unknown as BootState;

  state.booted = false;
  state.bootContext = undefined;
  state.bootListeners = [];
}

const context = { environment: "development", runtimeStrategy: "development" } as const;

describe("Application boot latch", () => {
  beforeEach(resetBootState);
  afterEach(resetBootState);

  it("holds listeners until every connector has started, then runs them in registration order", async () => {
    const order: string[] = [];

    Application.onceBooted(() => void order.push("first"));
    Application.onceBooted(async () => {
      order.push("second");
    });

    // Connectors start (early phase, app code, late phase) before the latch flips.
    order.push("connectors-started");
    expect(order).toEqual(["connectors-started"]);

    Application.markBooted(context);
    await Application.whenBooted();

    expect(order).toEqual(["connectors-started", "first", "second"]);
  });

  it("fires once: a second markBooted does not re-run listeners", async () => {
    let runs = 0;

    Application.onceBooted(() => void runs++);
    Application.markBooted(context);
    Application.markBooted(context);
    await Application.whenBooted();

    expect(runs).toBe(1);
  });

  it("still runs a listener registered after boot", async () => {
    Application.markBooted(context);

    let ran = false;

    Application.onceBooted(() => void (ran = true));
    await Promise.resolve();

    expect(ran).toBe(true);
  });

  it("isolates a throwing listener from the others", async () => {
    let ran = false;

    Application.onceBooted(() => {
      throw new Error("boom");
    });
    Application.onceBooted(() => void (ran = true));
    Application.markBooted(context);
    await Application.whenBooted();
    await Promise.resolve();

    expect(ran).toBe(true);
  });
});
