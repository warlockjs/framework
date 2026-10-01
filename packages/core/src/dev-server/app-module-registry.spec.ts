import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import { DevelopmentAppModuleRegistry, getDevelopmentAppModuleRegistry } from "./app-module-registry";
import { FilesOrchestrator } from "./files-orchestrator";

afterEach(() => {
  container.delete("development.appModules");
});

describe("DevelopmentAppModuleRegistry", () => {
  it("counts bumps per path, case- and slash-insensitively like the loader hook's version map", () => {
    const registry = new DevelopmentAppModuleRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const file = process.platform === "win32" ? "C:\\App\\src\\app\\a.ts" : "/App/src/app/a.ts";

    expect(registry.get(file)).toBeUndefined();

    registry.bump(file);
    registry.bump(file.toLowerCase().replaceAll("\\", "/"));

    expect(registry.get(file)?.generation).toBe(2);
    expect(registry.get(file)?.url.toLowerCase()).toBe(pathToFileURL(file).href.toLowerCase());
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 2 }));
  });

  it("isolates a throwing subscriber and supports unsubscribe", () => {
    const registry = new DevelopmentAppModuleRegistry();
    const survivor = vi.fn();
    registry.subscribe(() => {
      throw new Error("boom");
    });
    const unsubscribe = registry.subscribe(survivor);

    registry.bump("/App/src/app/a.ts");
    expect(survivor).toHaveBeenCalledOnce();

    unsubscribe();
    registry.bump("/App/src/app/a.ts");
    expect(survivor).toHaveBeenCalledOnce();
  });

  it("is a container singleton", () => {
    const registry = getDevelopmentAppModuleRegistry();

    expect(getDevelopmentAppModuleRegistry()).toBe(registry);
    expect(container.get("development.appModules")).toBe(registry);
  });
});

describe("FilesOrchestrator app-module publication", () => {
  it("publishes a bumped file only after the hook thread acknowledged the flush", async () => {
    const orchestrator = new FilesOrchestrator();
    const messages: Array<{ type: string; absolutePath?: string }> = [];
    (orchestrator as unknown as { loaderPort: unknown }).loaderPort = {
      postMessage: (message: { type: string; absolutePath?: string }) => messages.push(message),
    };
    const published = vi.fn();
    getDevelopmentAppModuleRegistry().subscribe(published);
    const file = process.platform === "win32" ? "C:\\App\\src\\app\\a.ts" : "/App/src/app/a.ts";

    orchestrator.bumpVersion(file);

    // Posted to the hook thread, but not visible to subscribers yet: importing
    // the new URL now could still resolve the previous version.
    expect(messages).toEqual([{ type: "bump", absolutePath: file }]);
    expect(published).not.toHaveBeenCalled();
    expect(getDevelopmentAppModuleRegistry().get(file)).toBeUndefined();

    let flushed = false;
    const flush = orchestrator.flushVersionBumps().then(() => {
      flushed = true;
    });
    expect(messages.at(-1)).toEqual({ type: "sync" });
    expect(published).not.toHaveBeenCalled();

    // The hook thread's `sync-ack`.
    (orchestrator as unknown as { pendingFlushes: Array<() => void> }).pendingFlushes.shift()?.();
    await flush;

    expect(flushed).toBe(true);
    expect(published).toHaveBeenCalledOnce();
    expect(getDevelopmentAppModuleRegistry().get(file)?.generation).toBe(1);
  });
});
