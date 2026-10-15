import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import type { FileManager } from "./file-manager";
import { DevelopmentModelModuleRegistry } from "./model-module-registry";
import { ModuleLoader } from "./module-loader";
import type { SpecialFilesCollector } from "./special-files-collector";

const temporaryDirectories: string[] = [];

function fixtureModel() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-model-registry-"));
  temporaryDirectories.push(directory);
  const absolutePath = path.join(directory, "user.model.mjs");
  fs.writeFileSync(absolutePath, "export default {};\n");
  return { absolutePath, url: pathToFileURL(absolutePath).href };
}

afterEach(() => {
  vi.restoreAllMocks();
  container.delete("development.modelModules");
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

describe("DevelopmentModelModuleRegistry", () => {
  it("publishes a fresh namespace once and retains the exact loader URL", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const namespace = { default: {} };

    registry.publish(absolutePath, url, namespace);
    registry.publish(absolutePath, url, namespace);

    expect(registry.get(absolutePath)).toEqual({
      url,
      generation: 1,
      hasDefault: true,
      state: "ready",
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("increments on a fresh namespace and detects default-export changes", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();

    registry.publish(absolutePath, url, { default: {} });
    registry.publish(absolutePath, url, { named: {} });

    expect(registry.get(absolutePath)).toMatchObject({
      url,
      generation: 2,
      hasDefault: false,
      state: "ready",
    });
  });

  it("keeps a removal tombstone and increments on re-addition", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.publish(absolutePath, url, { default: {} });
    fs.rmSync(absolutePath);
    registry.remove(absolutePath);
    registry.publish(absolutePath, url, { default: {} });

    expect(listener.mock.calls.map(([entry]) => entry.state)).toEqual([
      "ready",
      "removed",
      "ready",
    ]);
    expect(registry.get(absolutePath)).toMatchObject({ generation: 3, state: "ready" });
  });

  it("gives an unpublished removal a usable file URL", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();

    registry.remove(absolutePath);

    expect(registry.get(absolutePath)).toEqual({
      url,
      generation: 1,
      hasDefault: false,
      state: "removed",
    });
  });

  it("uses one lookup identity for real paths and slash variants", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();
    registry.publish(absolutePath, url, {});

    const spellingVariant =
      process.platform === "win32"
        ? absolutePath.replaceAll("\\", "/")
        : path.join(path.dirname(absolutePath), ".", path.basename(absolutePath));
    expect(registry.get(spellingVariant)).toMatchObject({ generation: 1, state: "ready" });
  });

  it("removes a previously published symlink spelling after it no longer resolves", () => {
    const { absolutePath } = fixtureModel();
    const symlinkPath = path.join(path.dirname(absolutePath), "user-link.model.mjs");
    const registry = new DevelopmentModelModuleRegistry();
    const nativeRealpath = fs.realpathSync.native;
    let linkExists = true;
    vi.spyOn(fs.realpathSync, "native").mockImplementation((input) => {
      if (String(input) === symlinkPath) {
        if (linkExists) return absolutePath;
        throw new Error("ENOENT");
      }
      return nativeRealpath(input);
    });

    registry.publish(symlinkPath, pathToFileURL(symlinkPath).href, {});
    linkExists = false;
    registry.remove(symlinkPath);

    expect(registry.get(symlinkPath)).toEqual({
      url: pathToFileURL(symlinkPath).href,
      generation: 2,
      hasDefault: false,
      state: "removed",
    });
    expect(registry.get(absolutePath)).toMatchObject({ generation: 2, state: "removed" });
  });

  it("stops notifying a disposed subscription", () => {
    const { absolutePath, url } = fixtureModel();
    const registry = new DevelopmentModelModuleRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.publish(absolutePath, url, {});
    unsubscribe();
    registry.remove(absolutePath);

    expect(listener).toHaveBeenCalledOnce();
  });

  it("publishes only a loaded model and removes its ownership before cleanup", async () => {
    const { absolutePath, url } = fixtureModel();
    const file = {
      absolutePath,
      relativePath: "src/models/user.model.ts",
      type: "model",
      cleanup: [],
      addCleanup: vi.fn(),
      resetCleanup: vi.fn(),
    } as unknown as FileManager;
    const loader = new ModuleLoader({
      getFilesByType: () => [],
    } as unknown as SpecialFilesCollector);
    const carrier = container.get("development.modelModules");
    const listener = vi.fn();
    carrier.subscribe(listener);

    expect(carrier.get(absolutePath)).toBeUndefined();

    await loader.loadModule(file, "model");

    expect(container.get("development.modelModules").get(absolutePath)).toEqual({
      url,
      generation: 1,
      hasDefault: true,
      state: "ready",
    });
    expect(listener).toHaveBeenCalledOnce();

    loader.cleanupDeletedModule(file);

    expect(container.get("development.modelModules").get(absolutePath)).toMatchObject({
      generation: 2,
      state: "removed",
    });
    expect(file.resetCleanup).toHaveBeenCalledOnce();
  });

  it("keeps the zero-model carrier empty for non-model and failed model imports", async () => {
    const { absolutePath } = fixtureModel();
    const loader = new ModuleLoader({
      getFilesByType: () => [],
    } as unknown as SpecialFilesCollector);
    const createFile = (type: string, filePath = absolutePath) =>
      ({
        absolutePath: filePath,
        relativePath: "src/models/user.model.ts",
        type,
        cleanup: [],
        addCleanup: vi.fn(),
        resetCleanup: vi.fn(),
      }) as unknown as FileManager;

    await loader.loadModule(createFile("service"), "service");
    expect(container.get("development.modelModules").get(absolutePath)).toBeUndefined();

    const failedModelPath = path.join(path.dirname(absolutePath), "broken.model.mjs");
    fs.writeFileSync(failedModelPath, "throw new Error('broken model');\n");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(loader.loadModule(createFile("model", failedModelPath), "model")).rejects.toThrow(
      "broken model",
    );
    expect(container.get("development.modelModules").get(failedModelPath)).toBeUndefined();
  });
});
