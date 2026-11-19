import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/**
 * `exportSQL()` writes the statements in migration order, the order `migrate`
 * runs them in. A later migration's data step never lands before an earlier
 * migration's, and the down file is the exact inverse.
 */
const fake = (name: string, createdAt: string, up: string[], down: string[]) => ({
  migrationName: name,
  createdAt,
  up,
  down,
});

describe("MigrationRunner.exportSQL — order", () => {
  let dir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps dependent data steps in migration order instead of grouping by SQL kind", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-sql-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const first = fake(
      "01-backfill",
      "01-01-2026_10-00-00",
      ['UPDATE "users" SET "status" = \'a\'', 'CREATE INDEX "i1" ON "users" ("status")'],
      ['DROP INDEX "i1"'],
    );
    const second = fake(
      "02-fix-backfill",
      "02-01-2026_10-00-00",
      ['ALTER TABLE "users" ADD COLUMN "flag" boolean', 'UPDATE "users" SET "status" = \'b\''],
      ['ALTER TABLE "users" DROP COLUMN "flag"'],
    );

    const runner = new MigrationRunner({ verbose: false }) as any;
    runner.getDataSource = () => ({ driver: { supportsSqlSerialization: true } });
    // Registered out of order on purpose.
    runner.migrations = [second, first];
    runner.createMigrationInstance = (klass: ReturnType<typeof fake>) => {
      let current: string[] = [];

      return {
        setDryRun: () => undefined,
        up: async () => void (current = klass.up),
        down: async () => void (current = klass.down),
        toSQL: () => current,
      };
    };

    await runner.exportSQL({ compact: true });

    const sqlDir = path.join(dir, "database", "sql");
    const files = fs.readdirSync(sqlDir);
    const up = fs.readFileSync(
      path.join(
        sqlDir,
        files.find((f) => f.endsWith(".up.sql"))!,
      ),
      "utf8",
    );
    const down = fs.readFileSync(
      path.join(
        sqlDir,
        files.find((f) => f.endsWith(".down.sql"))!,
      ),
      "utf8",
    );

    const at = (text: string, needle: string) => text.indexOf(needle);

    expect(at(up, "SET \"status\" = 'a'")).toBeLessThan(at(up, 'CREATE INDEX "i1"'));
    expect(at(up, 'CREATE INDEX "i1"')).toBeLessThan(at(up, 'ADD COLUMN "flag"'));
    expect(at(up, 'ADD COLUMN "flag"')).toBeLessThan(at(up, "SET \"status\" = 'b'"));
    expect(at(down, 'DROP COLUMN "flag"')).toBeLessThan(at(down, 'DROP INDEX "i1"'));
  });
  it("keeps a migration's interleaved phases in order in the grouped (non-compact) file", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-sql-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    // Data (phase 6), then DDL (phase 3), then data that needs the new column.
    const only = fake(
      "01-add-flag",
      "01-01-2026_10-00-00",
      [
        'UPDATE "users" SET "status" = \'a\'',
        'ALTER TABLE "users" ADD COLUMN "flag" boolean',
        'UPDATE "users" SET "flag" = true',
      ],
      ['ALTER TABLE "users" DROP COLUMN "flag"'],
    );

    const runner = new MigrationRunner({ verbose: false }) as any;
    runner.getDataSource = () => ({ driver: { supportsSqlSerialization: true } });
    runner.migrations = [only];
    runner.createMigrationInstance = (klass: ReturnType<typeof fake>) => {
      let current: string[] = [];

      return {
        setDryRun: () => undefined,
        up: async () => void (current = klass.up),
        down: async () => void (current = klass.down),
        toSQL: () => current,
      };
    };

    await runner.exportSQL();

    const sqlDir = path.join(dir, "database", "sql");
    const upFile = fs.readdirSync(sqlDir).find((f) => f.endsWith(".up.sql"))!;
    const up = fs.readFileSync(path.join(sqlDir, upFile), "utf8");
    const at = (needle: string) => up.indexOf(needle);

    expect(at("SET \"status\" = 'a'")).toBeLessThan(at('ADD COLUMN "flag"'));
    expect(at('ADD COLUMN "flag"')).toBeLessThan(at('SET "flag" = true'));
    // Three runs of statements, three headers: the two data steps are not merged.
    expect(up.match(/\/\* Phase \d+ \[/g)).toHaveLength(3);
  });
});
