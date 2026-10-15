import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../router/router", () => ({ router: { withSourceFile: (_f: string, run: () => unknown) => run() } }));
vi.mock("../dev-server/model-module-registry", () => ({ getDevelopmentModelModuleRegistry: () => ({ publish: () => undefined }) }));

import { importAppModule, setAppModuleImporter } from "./app-module-importer";

describe("importAppModule", () => {
  afterEach(() => {
    setAppModuleImporter(undefined);
  });

  it("uses the installed hook instead of native import", async () => {
    const hook = vi.fn().mockResolvedValue({ default: "from-hook" });

    setAppModuleImporter(hook);

    // A URL native import could never resolve: reaching the hook proves native was skipped.
    const module = await importAppModule("file:///nowhere/app-module.ts");

    expect(hook).toHaveBeenCalledWith("file:///nowhere/app-module.ts");
    expect(module.default).toBe("from-hook");
  });

  it("falls back to native import once the hook is cleared", async () => {
    setAppModuleImporter(vi.fn());
    setAppModuleImporter(undefined);

    await expect(importAppModule("file:///nowhere/app-module.ts")).rejects.toThrow();
  });
});

describe("ModuleLoader wiring", () => {
  afterEach(() => {
    setAppModuleImporter(undefined);
  });

  it("loads app modules through the hook", async () => {
    const { ModuleLoader } = await import("../dev-server/module-loader");
    const hook = vi.fn().mockResolvedValue({ default: 1 });

    setAppModuleImporter(hook);

    const loader = new ModuleLoader({ getFilesByType: () => [] } as never);
    const file = { absolutePath: "/app/src/app/users/user.model.ts", relativePath: "src/app/users/user.model.ts" };

    await loader.loadModule(file as never, "other");

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]).toMatch(/^file:\/\/.*user\.model\.ts$/);
  });
});
