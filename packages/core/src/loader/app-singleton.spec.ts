import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSingleton,
  disposeAllAppSingletons,
  disposeAppSingleton,
  peekAppSingleton,
} from "./app-singleton";

afterEach(async () => {
  await disposeAllAppSingletons();
});

describe("appSingleton", () => {
  it("creates the value once per key", () => {
    const create = vi.fn(() => ({ a: 1 }));

    expect(appSingleton("spec.once.v1", create)).toBe(appSingleton("spec.once.v1", create));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is shared by two evaluations of the same file (connector installs, route reads)", async () => {
    // Different query strings make the module runner evaluate the file twice,
    // exactly like a second module graph or a reload generation does.
    const connectorCopy = await import("./__fixtures__/singleton-fixture?copy=connector");
    const routeCopy = await import("./__fixtures__/singleton-fixture?copy=route");

    expect(connectorCopy.moduleCopyId).not.toBe(routeCopy.moduleCopyId);
    expect(routeCopy.getFixtureRuntime()).toBe(connectorCopy.getFixtureRuntime());
    expect(connectorCopy.fixtureCreations() + routeCopy.fixtureCreations()).toBe(1);
  });

  it("disposes once and creates a fresh value afterwards", async () => {
    const dispose = vi.fn();
    const first = appSingleton("spec.dispose.v1", () => ({}), { dispose });

    await disposeAppSingleton("spec.dispose.v1");
    await disposeAppSingleton("spec.dispose.v1");

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(first);
    expect(peekAppSingleton("spec.dispose.v1")).toBeUndefined();
    expect(appSingleton("spec.dispose.v1", () => ({}))).not.toBe(first);
  });

  it("disposeAll runs every dispose, newest first, and reports the first failure", async () => {
    const order: string[] = [];

    appSingleton("spec.all.a.v1", () => 1, { dispose: () => void order.push("a") });
    appSingleton("spec.all.b.v1", () => 2, {
      dispose: () => {
        order.push("b");
        throw new Error("boom");
      },
    });

    await expect(disposeAllAppSingletons()).rejects.toThrow("boom");
    expect(order).toEqual(["b", "a"]);
    expect(peekAppSingleton("spec.all.a.v1")).toBeUndefined();
  });

  it("registers disposal on the module being loaded when disposeOnReload is set", async () => {
    const addCleanup = vi.fn();
    const dispose = vi.fn();

    (globalThis as any).__currentModuleFile = { addCleanup };

    try {
      appSingleton("spec.reload.v1", () => ({}), { dispose, disposeOnReload: true });
    } finally {
      delete (globalThis as any).__currentModuleFile;
    }

    expect(addCleanup).toHaveBeenCalledTimes(1);
    await addCleanup.mock.calls[0][0]();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(peekAppSingleton("spec.reload.v1")).toBeUndefined();
  });

  it("rejects an empty key", () => {
    expect(() => appSingleton("", () => 1)).toThrow(TypeError);
  });
});
