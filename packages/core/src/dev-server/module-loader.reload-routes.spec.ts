import { afterEach, describe, expect, it, vi } from "vitest";

const state = { mode: "ok" as "ok" | "throws" | "throws-after-one" };

vi.mock("../loader/app-module-importer", async () => {
  const { router } = await import("../router/router");
  const handler = async () => ({});

  return {
    importAppModule: vi.fn(async () => {
      if (state.mode === "throws") throw new Error("boom");

      router.get("/reload/a", handler);

      if (state.mode === "throws-after-one") throw new Error("boom after one");

      router.get("/reload/b", handler);

      return {};
    }),
  };
});
vi.mock("./dev-logger", () => ({ devLogError: vi.fn(), formatModuleNotFoundError: vi.fn() }));

import { router } from "../router/router";
import { ModuleLoader } from "./module-loader";

const SOURCE = "src/app/reload/routes.ts";
const file = {
  absolutePath: `/app/${SOURCE}`,
  relativePath: SOURCE,
  cleanup: [] as unknown[],
  addCleanup() {},
  resetCleanup() {},
};
const loader = new ModuleLoader({ getFileType: () => "route", getFilesByType: () => [] } as any);
const paths = () =>
  router
    .list()
    .filter((route) => route.sourceFile === SOURCE)
    .map((route) => route.path)
    .sort();

afterEach(() => {
  router.removeRoutesBySourceFile(SOURCE);
  state.mode = "ok";
});

describe("ModuleLoader.reloadModule for a routes file", () => {
  it.each(["throws", "throws-after-one"] as const)(
    "keeps the previous routes and rethrows when the reload %s",
    async (mode) => {
      state.mode = "ok";
      await loader.loadModule(file as any, "route");
      expect(paths()).toEqual(["/reload/a", "/reload/b"]);

      state.mode = mode;
      await expect(loader.reloadModule(file as any)).rejects.toThrow();
      expect(paths()).toEqual(["/reload/a", "/reload/b"]);

      // The next save retries cleanly and replaces, not duplicates.
      state.mode = "ok";
      await loader.reloadModule(file as any);
      expect(paths()).toEqual(["/reload/a", "/reload/b"]);
    },
  );
});
