import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigSpecialHandlers,
  configSpecialHandlers,
} from "../../../src/config/config-special-handlers";

/**
 * Unit coverage for the special-config-handler registry — the side-channel
 * that lets a named config (e.g. "app") run extra processing the moment it is
 * loaded. The registry is a thin Map wrapper, so the contract under test is:
 * register stores by name, execute dispatches to the matching handler (and
 * is a silent no-op otherwise), and re-registering the same name overwrites.
 */
describe("ConfigSpecialHandlers", () => {
  let handlers: ConfigSpecialHandlers;

  beforeEach(() => {
    handlers = new ConfigSpecialHandlers();
  });

  it("dispatches a registered handler with the config value", async () => {
    const handler = vi.fn();
    handlers.register("database", handler);

    const value = { host: "127.0.0.1" };

    await handlers.execute("database", value);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(value);
  });

  it("returns the handler's resolved value", async () => {
    handlers.register("app", async () => "done");

    await expect(handlers.execute("app", {})).resolves.toBe("done");
  });

  it("is a silent no-op when no handler is registered for the name", async () => {
    await expect(handlers.execute("unregistered", { any: true })).resolves.toBeUndefined();
  });

  it("only runs the handler matching the executed name", async () => {
    const appHandler = vi.fn();
    const dbHandler = vi.fn();

    handlers.register("app", appHandler);
    handlers.register("database", dbHandler);

    await handlers.execute("app", {});

    expect(appHandler).toHaveBeenCalledTimes(1);
    expect(dbHandler).not.toHaveBeenCalled();
  });

  it("overwrites a handler when the same name is registered twice", async () => {
    const first = vi.fn();
    const second = vi.fn();

    handlers.register("app", first);
    handlers.register("app", second);

    await handlers.execute("app", {});

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("awaits an async handler before resolving", async () => {
    const order: string[] = [];

    handlers.register("app", async () => {
      await Promise.resolve();
      order.push("handler");
    });

    await handlers.execute("app", {});
    order.push("after");

    expect(order).toEqual(["handler", "after"]);
  });
});

describe("configSpecialHandlers singleton", () => {
  it("exposes a shared ConfigSpecialHandlers instance", () => {
    expect(configSpecialHandlers).toBeInstanceOf(ConfigSpecialHandlers);
  });
});
