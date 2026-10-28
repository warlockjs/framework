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

describe("LayerExecutor.executeBatchReload — narrow invalidation and reload order", () => {
  afterEach(() => {
    devLogHMRMock.mockClear();
  });

  function buildChainExecutor(chains: Record<string, string[]>, files: Map<string, FileManager>) {
    const dependencyGraph = { getInvalidationChain: (path: string) => chains[path] ?? [path] };
    const moduleLoader = {
      cleanupDeletedModule: vi.fn(),
      runCleanup: vi.fn(),
      loadModule: vi.fn(),
      reloadModule: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new LayerExecutor(
      dependencyGraph as never,
      { getFilesByType: () => [] } as never,
      moduleLoader as never,
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
    );

    return { executor, files };
  }

  it("re-reads only the changed files, not their thousands of importers", async () => {
    const changed = fakeFile("src/a.ts", "model");
    const importers = Array.from({ length: 50 }, (_, index) =>
      fakeFile(`src/i${index}.ts`, "other" as never),
    );
    const files = new Map([
      [changed.relativePath, changed],
      ...importers.map((f) => [f.relativePath, f] as const),
    ]);
    const { executor } = buildChainExecutor(
      { "src/a.ts": [changed.relativePath, ...importers.map((f) => f.relativePath)] },
      files,
    );

    await executor.executeBatchReload(["src/a.ts"], files, []);

    expect(changed.process).toHaveBeenCalledWith({ force: true });
    for (const importer of importers) expect(importer.process).not.toHaveBeenCalled();
  });

  it("reports each changed file's own dependents, not a running total", async () => {
    const a = fakeFile("src/a.ts", "model");
    const b = fakeFile("src/b.ts", "model");
    const files = new Map([
      [a.relativePath, a],
      [b.relativePath, b],
    ]);
    const { executor } = buildChainExecutor(
      { "src/a.ts": ["src/a.ts", "x", "y"], "src/b.ts": ["src/b.ts", "z"] },
      files,
    );

    await executor.executeBatchReload(["src/a.ts", "src/b.ts"], files, []);

    expect(devLogHMRMock).toHaveBeenCalledWith("src/a.ts", 2, expect.any(Number));
    expect(devLogHMRMock).toHaveBeenCalledWith("src/b.ts", 1, expect.any(Number));
  });

  it("holds the request gate for the whole reload, then opens it", async () => {
    const { reloadGate } = await import("../http/reload-gate");
    const file = fakeFile("src/a.ts", "model");
    const files = new Map([[file.relativePath, file]]);
    const { executor } = buildChainExecutor({}, files);
    let closedDuringReload = false;

    vi.mocked(file.process).mockImplementation(async () => {
      closedDuringReload = reloadGate.closed;

      return true;
    });

    await executor.executeBatchReload(["src/a.ts"], files, []);

    expect(closedDuringReload).toBe(true);
    expect(reloadGate.closed).toBe(false);
  });

  it("opens the gate even when the reload throws", async () => {
    const { reloadGate } = await import("../http/reload-gate");
    const file = fakeFile("src/a.ts", "model");
    const files = new Map([[file.relativePath, file]]);
    const { executor } = buildChainExecutor({}, files);

    vi.mocked(file.process).mockRejectedValue(new Error("boom"));

    await expect(executor.executeBatchReload(["src/a.ts"], files, [])).rejects.toThrow("boom");
    expect(reloadGate.closed).toBe(false);
  });
});
