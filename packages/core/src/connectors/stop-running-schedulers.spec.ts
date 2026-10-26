import { afterEach, describe, expect, it, vi } from "vitest";
import { stopRunningSchedulers } from "./stop-running-schedulers";

vi.mock("@warlock.js/logger", () => ({ log: { error: vi.fn() } }));

const KEY = Symbol.for("warlock.scheduler.running");

type Host = { [KEY]?: Set<{ shutdown(timeout?: number): Promise<void> }> };

const host = globalThis as Host;

describe("stopRunningSchedulers", () => {
  afterEach(() => {
    delete host[KEY];
  });

  it("does nothing when no scheduler package is loaded", async () => {
    await expect(stopRunningSchedulers(1000)).resolves.toBeUndefined();
  });

  it("shuts down every listed scheduler with the given timeout", async () => {
    const first = { shutdown: vi.fn(async () => undefined) };
    const second = { shutdown: vi.fn(async () => undefined) };

    host[KEY] = new Set([first, second]);

    await stopRunningSchedulers(250);

    expect(first.shutdown).toHaveBeenCalledWith(250);
    expect(second.shutdown).toHaveBeenCalledWith(250);
  });

  it("keeps stopping the others when one scheduler rejects", async () => {
    const failing = {
      shutdown: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const healthy = { shutdown: vi.fn(async () => undefined) };

    host[KEY] = new Set([failing, healthy]);

    await expect(stopRunningSchedulers(250)).resolves.toBeUndefined();

    expect(healthy.shutdown).toHaveBeenCalledTimes(1);
  });
});
