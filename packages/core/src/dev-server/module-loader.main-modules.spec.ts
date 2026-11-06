import { describe, expect, it, vi } from "vitest";

vi.mock("../loader/app-module-importer", () => ({
  importAppModule: vi.fn(async (url: string) => {
    if (url.includes("broken")) throw new Error("boom");
    return {};
  }),
}));
vi.mock("./dev-logger", () => ({ devLogError: vi.fn(), formatModuleNotFoundError: vi.fn() }));

import { importAppModule } from "../loader/app-module-importer";
import { ModuleLoader } from "./module-loader";

function file(name: string) {
  return {
    absolutePath: `/app/${name}/main.ts`,
    relativePath: `src/app/${name}/main.ts`,
    addCleanup() {},
  };
}

function loaderWith(mains: ReturnType<typeof file>[]) {
  const collector = {
    getFilesByType: (type: string) => (type === "main" ? mains : [{ relativePath: "x/route.ts" }]),
  };

  return new ModuleLoader(collector as any);
}

describe("ModuleLoader.loadMainModules", () => {
  it("imports only main files", async () => {
    vi.mocked(importAppModule).mockClear();

    await loaderWith([file("users"), file("posts")]).loadMainModules();

    expect(importAppModule).toHaveBeenCalledTimes(2);
  });

  it("attempts every main file and reports the failures together", async () => {
    vi.mocked(importAppModule).mockClear();

    await expect(loaderWith([file("broken"), file("posts")]).loadMainModules()).rejects.toThrow(
      /failed to load/,
    );
    expect(importAppModule).toHaveBeenCalledTimes(2);
  });
});
