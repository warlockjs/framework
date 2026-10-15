import { describe, expect, it, vi } from "vitest";
import type { FileManager } from "./file-manager";
import { ModuleLoader } from "./module-loader";
import { SpecialFilesCollector } from "./special-files-collector";

function fakeFile(relativePath: string): FileManager {
  return { relativePath, absolutePath: `/abs/${relativePath}` } as unknown as FileManager;
}

describe("worker.ts special file", () => {
  it("categorises src/app/<module>/worker.ts as a worker file", () => {
    const collector = new SpecialFilesCollector();
    collector.addFile(fakeFile("src/app/jobs/worker.ts"));

    expect(collector.getFileType("src/app/jobs/worker.ts")).toBe("worker");
    expect(collector.getFilesByType("worker").map((file) => file.relativePath)).toEqual([
      "src/app/jobs/worker.ts",
    ]);
    expect(collector.getStats().worker).toBe(1);
  });

  it("loads worker files after route files", async () => {
    const collector = new SpecialFilesCollector();
    collector.addFile(fakeFile("src/app/jobs/routes.ts"));
    collector.addFile(fakeFile("src/app/jobs/worker.ts"));

    const loader = new ModuleLoader(collector);
    const loadOrder: string[] = [];
    vi.spyOn(loader, "loadModule").mockImplementation(async (file) => {
      loadOrder.push(file.relativePath);
      return undefined;
    });

    await loader.loadAll();

    expect(loadOrder).toEqual(["src/app/jobs/routes.ts", "src/app/jobs/worker.ts"]);
  });
});
