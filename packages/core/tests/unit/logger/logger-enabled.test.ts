import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLogConfigurations } from "../../../src/logger/logger";

describe("setLogConfigurations enabled flags", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
    vi.restoreAllMocks();
  });

  const channel = { name: "c" } as any;

  it("configures no channels when the environment flag is false", () => {
    process.env.NODE_ENV = "production";
    const spy = vi.spyOn(log, "configure").mockImplementation(() => undefined as any);

    setLogConfigurations({
      channels: [channel],
      production: { channels: [channel], enabled: false },
    });

    expect(spy).toHaveBeenCalledWith({ channels: [] });
  });

  it("configures no channels when the top-level flag is false", () => {
    process.env.NODE_ENV = "development";
    const spy = vi.spyOn(log, "configure").mockImplementation(() => undefined as any);

    setLogConfigurations({ enabled: false, channels: [channel] });

    expect(spy).toHaveBeenCalledWith({ channels: [] });
  });

  it("keeps channels when enabled is unset", () => {
    process.env.NODE_ENV = "production";
    const spy = vi.spyOn(log, "configure").mockImplementation(() => undefined as any);

    setLogConfigurations({ channels: [channel] });

    expect(spy).toHaveBeenCalledWith({ channels: [channel] });
  });
});
