import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMigrations, setStepTimeout, shutdown, removeHandlers } = vi.hoisted(() => ({
  runMigrations: vi.fn(),
  setStepTimeout: vi.fn(),
  shutdown: vi.fn(),
  removeHandlers: vi.fn(),
}));

vi.mock("@warlock.js/cascade", () => ({
  Migration: class {},
  exportMigrationsSQL: vi.fn(),
  freshMigrate: vi.fn(),
  listExecutedMigrations: vi.fn(),
  migrationRunner: { register: vi.fn(), setStepTimeout },
  rollbackMigrations: vi.fn(),
  runMigrations,
  confirmRollback: vi.fn(),
}));
vi.mock("./migrate-shutdown", () => ({
  installMigrateInterruptHandlers: () => removeHandlers,
  shutdownMigrateConnections: shutdown,
}));
vi.mock("../dev-server/files-orchestrator", () => ({ filesOrchestrator: { load: vi.fn() } }));
vi.mock("../dev-server/utils", () => ({ getFilesFromDirectory: vi.fn().mockResolvedValue([]) }));
vi.mock("../utils", () => ({ srcPath: vi.fn(() => "C:/app") }));
vi.mock("../utils/is-test-file", () => ({ isTestFile: vi.fn(() => false) }));
vi.mock("../utils/normalized-path", () => ({
  Path: { toAbsolute: (value: string) => value, toRelative: (value: string) => value },
}));
vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: vi.fn() },
}));
vi.mock("./resolve-pending-migrations", () => ({ resolvePendingMigrations: vi.fn() }));

import { migrateAction } from "./migrate-action";

const run = (options: Record<string, unknown> = {}) =>
  migrateAction({ options, args: [] } as never);

describe("migrate closes its connections on every exit path", () => {
  beforeEach(() => {
    runMigrations.mockReset().mockResolvedValue([]);
    setStepTimeout.mockReset();
    shutdown.mockReset().mockResolvedValue(undefined);
    removeHandlers.mockReset();
  });

  it("on success", async () => {
    await run();

    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(removeHandlers).toHaveBeenCalledTimes(1);
  });

  it("on failure, and still rejects so the CLI exits non-zero", async () => {
    runMigrations.mockRejectedValue(new Error('Migration "x" failed: boom'));

    await expect(run()).rejects.toThrow('Migration "x" failed: boom');

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(removeHandlers).toHaveBeenCalledTimes(1);
  });

  it("applies --timeout in seconds", async () => {
    await run({ timeout: 90 });

    expect(setStepTimeout).toHaveBeenCalledWith(90_000);
  });

  it("rejects a bad --timeout before touching the database, and still closes", async () => {
    await expect(run({ timeout: "soon" })).rejects.toThrow("--timeout expects a number");

    expect(runMigrations).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
