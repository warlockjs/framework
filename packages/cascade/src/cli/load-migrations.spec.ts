import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const register = vi.fn();

vi.mock("../migration/migration-runner", () => ({
  inferMigrationName: (file: string) => path.basename(file),
  migrationRunner: { register },
}));

const { loadMigrations } = await import("./load-migrations");

describe("loadMigrations", () => {
  let directory: string;

  beforeEach(() => {
    register.mockClear();
    directory = mkdtempSync(path.join(tmpdir(), "load-migrations-"));
    mkdirSync(path.join(directory, "migrations"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("registers migrations and skips spec and test files beside them", async () => {
    const body = "export default class Migration {}\n";
    const throwing = "throw new Error('Vitest mocker was not initialized');\n";
    const folder = path.join(directory, "migrations");

    writeFileSync(path.join(folder, "01-01-2026_00-00-00-users.migration.mjs"), body);
    writeFileSync(path.join(folder, "users.migration.spec.mjs"), throwing);
    writeFileSync(path.join(folder, "users.migration.test.mjs"), throwing);

    const count = await loadMigrations(`${directory.replace(/\\/g, "/")}/migrations/*.mjs`);

    expect(count).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
