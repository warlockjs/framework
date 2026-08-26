import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";

const shouldRestart = vi.hoisted(() => vi.fn());
const restart = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../../src/connectors/connectors-manager", () => ({
  connectorsManager: {
    list: vi.fn(() => [{ shouldRestart, restart }]),
  },
}));

vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogHMR: vi.fn(),
}));

const { LayerExecutor } = await import("../../../src/dev-server/layer-executor");

const deletedPagePath = "src/web/account.page.tsx";

function createExecutor() {
  const cleanupDeletedModule = vi.fn();

  return {
    cleanupDeletedModule,
    executor: new LayerExecutor(
      { getInvalidationChain: vi.fn(() => []) } as never,
      { getFilesByType: vi.fn(() => []) } as never,
      { cleanupDeletedModule } as never,
      vi.fn(),
      vi.fn(async () => undefined),
    ),
  };
}

describe("LayerExecutor deletion propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldRestart.mockImplementation(files => files.includes(deletedPagePath));
  });

  it("passes a delete-only page batch to connectors and restarts a matching connector", async () => {
    const deletedPage = { relativePath: deletedPagePath } as FileManager;
    const filesMap = new Map([[deletedPagePath, deletedPage]]);
    const { cleanupDeletedModule, executor } = createExecutor();

    await executor.executeBatchReload([], filesMap, [deletedPagePath]);

    expect(cleanupDeletedModule).toHaveBeenCalledWith(deletedPage);
    expect(shouldRestart).toHaveBeenCalledOnce();
    expect(shouldRestart).toHaveBeenCalledWith([deletedPagePath]);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("does not evaluate connectors for a no-op batch", async () => {
    const { executor } = createExecutor();

    await executor.executeBatchReload([], new Map(), []);

    expect(shouldRestart).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});
