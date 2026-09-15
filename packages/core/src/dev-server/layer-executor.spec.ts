import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "./file-manager";

/**
 * `devLogHMR` used to print BEFORE the reload work (re-import + connector
 * restarts) ran, so the terminal said "updated" while a request made in that
 * window could still get the old code. It must now print only once the
 * reload has actually finished, and the line must carry how long that took.
 */
const devLogHMRMock = vi.fn();
const devLogTimingsMock = vi.fn();
vi.mock("./dev-logger", () => ({
  devLogHMR: (...args: unknown[]) => devLogHMRMock(...args),
  devLogTimings: (...args: unknown[]) => devLogTimingsMock(...args),
}));

const isTimingsEnabledMock = vi.fn(() => false);
vi.mock("./flags", () => ({
  isTimingsEnabled: () => isTimingsEnabledMock(),
}));

vi.mock("../connectors/connectors-manager", () => ({
  connectorsManager: { list: () => [] },
}));

const { LayerExecutor } = await import("./layer-executor");

function fakeFile(relativePath: string, type: FileManager["type"] = "route"): FileManager {
  return {
    relativePath,
    absolutePath: `/abs/${relativePath}`,
    type,
    dependencies: new Set<string>(),
    process: vi.fn().mockResolvedValue(true),
  } as unknown as FileManager;
}

function buildExecutor(file: FileManager, reloadModule: ReturnType<typeof vi.fn>) {
  const dependencyGraph = {
    getInvalidationChain: () => [file.relativePath],
  };
  const specialFilesCollector = {
    getFilesByType: (type: string) => (type === "route" ? [file] : []),
  };
  const moduleLoader = {
    cleanupDeletedModule: vi.fn(),
    runCleanup: vi.fn(),
    loadModule: vi.fn(),
    reloadModule,
  };

  return new LayerExecutor(
    dependencyGraph as never,
    specialFilesCollector as never,
    moduleLoader as never,
    vi.fn(),
    vi.fn().mockResolvedValue(undefined),
  );
}

describe("LayerExecutor.executeBatchReload — hmr log fires after reload finishes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    devLogHMRMock.mockClear();
    devLogTimingsMock.mockClear();
    isTimingsEnabledMock.mockReturnValue(false);
  });

  it("re-imports the affected module before logging, and the log carries a duration", async () => {
    const order: string[] = [];
    const file = fakeFile("src/app/x.ts");
    const filesMap = new Map([[file.relativePath, file]]);

    const reloadModule = vi.fn(async () => {
      order.push("reimport");
    });
    devLogHMRMock.mockImplementation(() => order.push("log"));

    const executor = buildExecutor(file, reloadModule);

    await executor.executeBatchReload([file.relativePath], filesMap, []);

    expect(order).toEqual(["reimport", "log"]);
    expect(devLogHMRMock).toHaveBeenCalledTimes(1);

    const [, , duration] = devLogHMRMock.mock.calls[0] as [string, number, number];
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("does not log the hmr line when re-import throws", async () => {
    const file = fakeFile("src/app/x.ts");
    const filesMap = new Map([[file.relativePath, file]]);

    const reloadModule = vi.fn().mockRejectedValue(new Error("boom"));
    const executor = buildExecutor(file, reloadModule);

    await expect(executor.executeBatchReload([file.relativePath], filesMap, [])).rejects.toThrow(
      "boom",
    );

    expect(devLogHMRMock).not.toHaveBeenCalled();
  });
});

describe("LayerExecutor.executeBatchReload — opt-in per-phase reload timings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    devLogHMRMock.mockClear();
    devLogTimingsMock.mockClear();
    isTimingsEnabledMock.mockReturnValue(false);
  });

  it("prints no timings line when devServer.timings is off (default)", async () => {
    const file = fakeFile("src/app/x.ts");
    const filesMap = new Map([[file.relativePath, file]]);
    const executor = buildExecutor(file, vi.fn().mockResolvedValue(undefined));

    await executor.executeBatchReload([file.relativePath], filesMap, []);

    expect(devLogTimingsMock).not.toHaveBeenCalled();
    expect(devLogHMRMock).toHaveBeenCalledTimes(1);
  });

  it("prints all five reload phases as numbers when devServer.timings is on", async () => {
    isTimingsEnabledMock.mockReturnValue(true);
    const file = fakeFile("src/app/x.ts");
    const filesMap = new Map([[file.relativePath, file]]);
    const executor = buildExecutor(file, vi.fn().mockResolvedValue(undefined));

    await executor.executeBatchReload([file.relativePath], filesMap, [], undefined, {
      watcherSettleMs: 12,
      debounceWaitMs: 50,
    });

    expect(devLogTimingsMock).toHaveBeenCalledTimes(1);
    const [timings] = devLogTimingsMock.mock.calls[0] as [Record<string, number>];

    expect(timings.watcherSettleMs).toBe(12);
    expect(timings.debounceWaitMs).toBe(50);
    expect(typeof timings.moduleGraphInvalidationMs).toBe("number");
    expect(typeof timings.reimportMs).toBe("number");
    expect(typeof timings.connectorRestartMs).toBe("number");
  });
});
