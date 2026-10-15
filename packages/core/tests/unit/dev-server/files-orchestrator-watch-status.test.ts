import { describe, expect, it, vi } from "vitest";

const devLogSuccess = vi.hoisted(() => vi.fn());
const watch = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogDim: vi.fn(),
  devLogSuccess,
}));

vi.mock("../../../src/dev-server/files-watcher", () => ({
  FilesWatcher: class {
    public onFileChange = vi.fn();
    public onFileAdd = vi.fn();
    public onFileDelete = vi.fn();
    public watch = watch;
  },
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: vi.fn(() => undefined) },
}));

const { FilesOrchestrator } = await import("../../../src/dev-server/files-orchestrator");

describe("FilesOrchestrator.watchFiles", () => {
  it("states that watching starts before the server is serving", async () => {
    const orchestrator = new FilesOrchestrator();

    await orchestrator.watchFiles();

    expect(devLogSuccess).toHaveBeenCalledWith("watching for file changes (not serving yet)");
  });
});
