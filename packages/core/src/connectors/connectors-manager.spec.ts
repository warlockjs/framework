import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../application";
import { ConnectorsManager } from "./connectors-manager";

vi.mock("@warlock.js/logger", async importOriginal => ({
  ...(await importOriginal<any>()),
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

describe("ConnectorsManager shutdown deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Application, "runShutdownHooks").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names the hung connector and force-exits 1 after app.shutdownTimeout", async () => {
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback: unknown) =>
      key === "app.shutdownTimeout" ? 5000 : fallback) as never);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const manager = new ConnectorsManager() as any;
    manager.connectors.length = 0;
    manager.connectors.push({ name: "cache", shutdown: () => new Promise(() => {}) });

    void manager.shutdown();
    await vi.advanceTimersByTimeAsync(4999);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls[0][0]).toContain("cache");
  });
});
