import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfig, getFiles, load, register } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getFiles: vi.fn(),
  load: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@warlock.js/cascade", () => ({
  Migration: class {},
  exportMigrationsSQL: vi.fn(),
  freshMigrate: vi.fn(),
  listExecutedMigrations: vi.fn(),
  migrationRunner: { register },
  rollbackMigrations: vi.fn(),
  runMigrations: vi.fn(),
}));

vi.mock("../dev-server/files-orchestrator", () => ({ filesOrchestrator: { load } }));
vi.mock("../dev-server/utils", () => ({ getFilesFromDirectory: getFiles }));
vi.mock("../utils", () => ({ srcPath: vi.fn(() => "C:/app") }));
vi.mock("../utils/is-test-file", () => ({ isTestFile: vi.fn(() => false) }));
vi.mock("../utils/normalized-path", () => ({
  Path: { toAbsolute: (value: string) => value, toRelative: (value: string) => value },
}));
vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: getConfig },
}));
vi.mock("./resolve-pending-migrations", () => ({ resolvePendingMigrations: vi.fn() }));

import { loadAllMigrations, loadMigrationFile } from "./migrate-action";

class PackageMigration {
  static migrationName = "package-migration";
}

class AppMigration {
  static migrationName = "app-migration";
}

describe("migration origin loading", () => {
  beforeEach(() => {
    getConfig.mockReset();
    getFiles
      .mockReset()
      .mockResolvedValueOnce(["C:/app/users/migrations/app.ts"])
      .mockResolvedValueOnce([]);
    load.mockReset().mockResolvedValue({ default: AppMigration });
    register.mockReset();
  });

  it("tags config migrations as packages and discovered files as apps", async () => {
    getConfig.mockReturnValue({ migrations: [PackageMigration] });

    await loadAllMigrations();

    expect(register).toHaveBeenNthCalledWith(1, PackageMigration, "package");
    expect(register).toHaveBeenNthCalledWith(2, AppMigration, "app");
  });

  it("tags a single requested migration file as an app", async () => {
    await loadMigrationFile("C:/app/users/migrations/app.ts");

    expect(register).toHaveBeenCalledWith(AppMigration, "app");
  });
});
