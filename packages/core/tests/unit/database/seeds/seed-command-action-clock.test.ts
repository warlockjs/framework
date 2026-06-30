import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDriver, type InMemoryDriver } from "./in-memory-driver";

/**
 * `seedCommandAction`'s programmatic `clock` override (S6) flows through to the
 * `SeedersManager` and onto the seeder's `now()`.
 *
 * `@warlock.js/cascade` is mocked (`transaction` inline, datasource INJECTED via
 * the registry mock). The dev-server file-discovery surface is stubbed so a
 * single seeder can be loaded by `--path` without touching the filesystem.
 *
 * NO real database — Docker / Mongo / Postgres are not used.
 */

const memoryRef: { current?: InMemoryDriver } = {};

vi.mock("@warlock.js/cascade", () => {
  return {
    transaction: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) => fn({})),
    migrationRunner: { run: vi.fn(async () => undefined) },
    // The command pulls the datasource from the registry; hand it ours.
    dataSourceRegistry: { get: vi.fn(() => ({ driver: memoryRef.current!.driver })) },
    DatabaseWriterValidationError: class DatabaseWriterValidationError extends Error {},
    Migration: class Migration {},
  };
});

const load = vi.fn();

vi.mock("../../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: { load: (...args: unknown[]) => load(...args) },
}));
vi.mock("../../../../src/dev-server/path", () => ({
  Path: { toAbsolute: (p: string) => p, toRelative: (p: string) => p },
}));
vi.mock("../../../../src/dev-server/utils", () => ({
  getFilesFromDirectory: vi.fn(async () => []),
}));
vi.mock("../../../../src/utils", () => ({
  srcPath: vi.fn(() => ""),
}));

import { seedCommandAction } from "../../../../src/database/seed-command-action";
import type { SeedContext } from "../../../../src/database/seeds/types";
import { seedRecordsTableName, seedsTableName } from "../../../../src/database/seeds/utils";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const memory = createInMemoryDriver();
  memory.createTable(seedsTableName);
  memory.createTable(seedRecordsTableName);
  memoryRef.current = memory;
});

describe("seedCommandAction — clock override", () => {
  it("threads the injected clock to the seeder's now()", async () => {
    const fixed = new Date("2017-11-11T11:11:11.000Z");
    let seen: Date | undefined;

    load.mockResolvedValue({
      default: {
        name: "from-command",
        async run({ track, now }: SeedContext) {
          seen = now();
          track("users", 1);
        },
      },
    });

    await seedCommandAction(
      { args: [], options: { path: "app/users/seeds/users.ts", transaction: true } },
      { clock: () => fixed },
    );

    expect(seen).toBe(fixed);

    // The same clock stamps the seeds-log metadata.
    const log = memoryRef.current!.rowsOf(seedsTableName).find(
      (row) => row.name === "from-command",
    );
    expect(log?.firstRunAt).toBe(fixed);
  });
});
