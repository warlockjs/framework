import { beforeEach, describe, expect, it, vi } from "vitest";

const { confirmRollback, rollbackMigrations, freshMigrate, getFiles } = vi.hoisted(() => ({
  confirmRollback: vi.fn(),
  rollbackMigrations: vi.fn(),
  freshMigrate: vi.fn(),
  getFiles: vi.fn(),
}));

vi.mock("@warlock.js/cascade", () => ({
  Migration: class {},
  confirmRollback,
  exportMigrationsSQL: vi.fn(),
  freshMigrate,
  listExecutedMigrations: vi.fn(),
  migrationRunner: { register: vi.fn() },
  rollbackMigrations,
  runMigrations: vi.fn(),
}));

vi.mock("../dev-server/files-orchestrator", () => ({ filesOrchestrator: { load: vi.fn() } }));
vi.mock("../dev-server/utils", () => ({ getFilesFromDirectory: getFiles }));
vi.mock("../utils", () => ({ srcPath: vi.fn(() => "C:/app") }));
vi.mock("../utils/is-test-file", () => ({ isTestFile: vi.fn(() => false) }));
vi.mock("../utils/normalized-path", () => ({
  Path: { toAbsolute: (value: string) => value, toRelative: (value: string) => value },
}));
vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: vi.fn(() => undefined) },
}));
vi.mock("./resolve-pending-migrations", () => ({ resolvePendingMigrations: vi.fn() }));

import { migrateAction } from "./migrate-action";

const run = (options: Record<string, unknown>) =>
  migrateAction({ options } as unknown as Parameters<typeof migrateAction>[0]);

describe("migrate --rollback / --fresh confirmation", () => {
  beforeEach(() => {
    confirmRollback.mockReset().mockResolvedValue(true);
    rollbackMigrations.mockReset();
    freshMigrate.mockReset();
    getFiles.mockReset().mockResolvedValue([]);
    vi.stubEnv("NODE_ENV", "production");
  });

  it("confirms before rolling back and passes --yes", async () => {
    await run({ rollback: true, yes: true });

    expect(confirmRollback).toHaveBeenCalledWith({ all: true, development: false, yes: true });
    expect(rollbackMigrations).toHaveBeenCalledWith({ all: true });
  });

  it("accepts --force as --yes", async () => {
    await run({ fresh: true, force: true });

    expect(confirmRollback).toHaveBeenCalledWith(expect.objectContaining({ yes: true }));
    expect(freshMigrate).toHaveBeenCalled();
  });

  it("does not roll back when declined", async () => {
    confirmRollback.mockResolvedValue(false);

    await run({ rollback: true });

    expect(rollbackMigrations).not.toHaveBeenCalled();
  });

  it("treats NODE_ENV=development as development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await run({ rollback: true });

    expect(confirmRollback).toHaveBeenCalledWith(expect.objectContaining({ development: true }));
  });

  it("exits 1 when confirmation is refused for lack of a terminal", async () => {
    confirmRollback.mockRejectedValue(new Error("Refusing to roll back"));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(run({ rollback: true })).rejects.toThrow("exit");

    expect(exit).toHaveBeenCalledWith(1);
    expect(rollbackMigrations).not.toHaveBeenCalled();
  });
});
