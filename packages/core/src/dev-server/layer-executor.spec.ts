import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "./file-manager";

/**
 * `devLogHMR` used to print BEFORE the reload work (re-import + connector
 * restarts) ran, so the terminal said "updated" while a request made in that
 * window could still get the old code. It must now print only once the
 * reload has actually finished, and the line must carry how long that took.
 */
const devLogHMRMock = vi.fn();
vi.mock("./dev-logger", () => ({
  devLogHMR: (...args: unknown[]) => devLogHMRMock(...args),
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
