import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import { SocketConnector } from "./socket-connector";

const adapterSpy = vi.fn();
const closeSpy = vi.fn();

vi.mock("socket.io", () => ({
  Server: class {
    adapter = adapterSpy;
    close = closeSpy;
  },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("SocketConnector adapter", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(container, "tryGet").mockReturnValue({ server: {} } as never);
    vi.spyOn(container, "set").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("calls the adapter factory and applies the result", async () => {
    const adapter = { name: "fake" };
    const factory = vi.fn().mockResolvedValue(adapter);
    vi.spyOn(config, "get").mockReturnValue({ adapter: factory } as never);

    await new SocketConnector().boot();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(adapterSpy).toHaveBeenCalledWith(adapter);
  });

  it("warns once in production without an adapter", async () => {
    process.env.NODE_ENV = "production";
    vi.spyOn(config, "get").mockReturnValue({} as never);

    await new SocketConnector().boot();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when silenced", async () => {
    process.env.NODE_ENV = "production";
    vi.spyOn(config, "get").mockReturnValue({ silenceSingleServerWarning: true } as never);

    await new SocketConnector().boot();

    expect(log.warn).not.toHaveBeenCalled();
  });
});
