import { afterEach, describe, expect, it, vi } from "vitest";
import { filesOrchestrator } from "./files-orchestrator";

/**
 * `load()` is the dynamic-import entrypoint for every app `src/` module, so it
 * must register the ESM loader hook (app/* alias + `.ts` resolution) BEFORE it
 * imports — it cannot assume a caller ran `init()` first.
 *
 * The regression this guards (f9d8f99f): the CLI resolves a `warlock <command>`
 * by importing the command module during command *lookup*
 * (`cliCommandsLoader.load()` → `filesOrchestrator.load()`), which happens
 * BEFORE the command's `execute()` → `loadPreloaders()` → `init()`. A command
 * file importing an `app/*` alias or a `.ts` sibling was therefore imported
 * with no hook registered and died on `ERR_MODULE_NOT_FOUND`.
 */
describe("FilesOrchestrator.load — self-initializes the loader hook (f9d8f99f)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls init() before importing, even when no caller initialized first", async () => {
    // Simulate a cold process (a plain `warlock <command>`, no dev server):
    // nothing has registered the hook yet.
    filesOrchestrator.isInitialized = false;

    // Mock init() so the assertion is about ORDERING, not the real worker-thread
    // registration (which is exercised elsewhere and is slow to spin up here).
    const initSpy = vi.spyOn(filesOrchestrator, "init").mockResolvedValue(undefined);
    // Isolate the ordering check from the filesystem and the real ESM import.
    vi.spyOn(filesOrchestrator, "add").mockResolvedValue({ type: "other" } as never);
    const loadModuleSpy = vi
      .spyOn(filesOrchestrator.moduleLoader, "loadModule")
      .mockResolvedValue({ default: {} } as never);

    await filesOrchestrator.load("src/app/blog/commands/publish.command.ts");

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(loadModuleSpy).toHaveBeenCalledTimes(1);
    // The hook must be registered strictly before the import runs.
    expect(initSpy.mock.invocationCallOrder[0]).toBeLessThan(
      loadModuleSpy.mock.invocationCallOrder[0],
    );
  });
});
