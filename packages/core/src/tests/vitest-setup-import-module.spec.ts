import { afterEach, describe, expect, it, vi } from "vitest";
import { importAppModule } from "../loader/app-module-importer";
import { warnMissingImportModule } from "./vitest-setup";

describe("setupTest importModule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any)[Symbol.for("warlock.core.importModuleWarned")];
  });

  it("warns once per process when importModule is missing under vitest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnMissingImportModule(undefined);
    warnMissingImportModule(undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("importModule: (file) => import(file)");
  });

  it("does not warn when importModule is provided", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnMissingImportModule(async () => ({}));

    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the importer module exported for the loaders", () => {
    expect(typeof importAppModule).toBe("function");
  });
});
