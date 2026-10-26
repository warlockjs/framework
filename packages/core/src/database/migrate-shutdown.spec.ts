import { beforeEach, describe, expect, it, vi } from "vitest";

const { disconnects, releaseActiveLocks, sources } = vi.hoisted(() => ({
  disconnects: [] as Array<ReturnType<typeof vi.fn>>,
  releaseActiveLocks: vi.fn(),
  sources: { list: [] as unknown[] },
}));

vi.mock("@warlock.js/cascade", () => ({
  dataSourceRegistry: { getAllDataSources: () => sources.list },
  migrationRunner: { releaseActiveLocks },
  withTimeout: (promise: Promise<unknown>) => promise,
}));

import {
  installMigrateInterruptHandlers,
  resetMigrateShutdown,
  shutdownMigrateConnections,
} from "./migrate-shutdown";

const source = (disconnect: ReturnType<typeof vi.fn>) => {
  disconnects.push(disconnect);

  return { driver: { disconnect } };
};

describe("migrate shutdown", () => {
  beforeEach(() => {
    disconnects.length = 0;
    releaseActiveLocks.mockReset().mockResolvedValue(undefined);
    resetMigrateShutdown();
  });

  it("releases the lock and disconnects every data source", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    sources.list = [source(a), source(b)];

    await shutdownMigrateConnections();

    expect(releaseActiveLocks).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("keeps closing the rest when one disconnect fails, and never throws", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const healthy = vi.fn().mockResolvedValue(undefined);
    sources.list = [source(failing), source(healthy)];

    await expect(shutdownMigrateConnections()).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("still disconnects when releasing the lock fails", async () => {
    releaseActiveLocks.mockRejectedValue(new Error("lock"));
    const disconnect = vi.fn().mockResolvedValue(undefined);
    sources.list = [source(disconnect)];

    await shutdownMigrateConnections();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("runs once for concurrent callers", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    sources.list = [source(disconnect)];

    await Promise.all([shutdownMigrateConnections(), shutdownMigrateConnections()]);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("closes connections and exits 130 on SIGINT", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    sources.list = [source(disconnect)];
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const remove = installMigrateInterruptHandlers();
    process.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    remove();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGINT")).toBe(0);

    exit.mockRestore();
  });
});
