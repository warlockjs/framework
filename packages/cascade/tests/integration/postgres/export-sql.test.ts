import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import {
  CreateAuthorsTable,
  CreateEventsTable,
  CreateWidgetsTable,
} from "../fixtures/migrations/postgres-migrations";
import { startPostgresHarness, type PostgresHarness } from "../helpers";

/**
 * ⚠️ NOT YET EXECUTED — written 2026-08-10 against a machine with no running
 * Docker daemon, so not one assertion below has ever run. Until someone runs it
 * and says so here, this file is a SPECIFICATION of what we intend to check, not
 * evidence that anything holds. Do not cite it as coverage. Delete this notice
 * the moment it goes green, and only then.
 *
 * Integration coverage for `MigrationRunner.exportSQL()` against a REAL Postgres
 * server (via testcontainers).
 *
 * Why this file exists: operators are told to reach for
 * `warlock migrate --sql --pending-only` as a read-only pre-flight — "what will
 * run next?" — before applying DDL to a shared database. Until this suite, the
 * ONLY coverage of `exportSQL` was the MongoDB negative case
 * (`tests/integration/mongodb/sync.test.ts`), which asserts it throws on a
 * driver with no SQL dialect. The success path — the one an operator actually
 * uses — was entirely unexercised.
 *
 * Each test therefore pins a property the operator's PROCEDURE depends on, not
 * just the runner's internals:
 *
 *   1. how many files appear, and what they are named
 *   2. where the migration names live in the output
 *   3. what `compact` removes
 *   4. what "nothing is pending" looks like on disk
 *   5. that `pendingOnly` really does exclude executed migrations
 *
 * Assertions read the FILES ON DISK, never the runner's return value, because
 * the file is what the operator reads.
 */

const MIG_TABLES = ["mig_widgets", "mig_authors", "mig_events", "_migrations"];

/**
 * `exportSQL` hardcodes its output to `<cwd>/database/sql` — it takes no path
 * option — so the tests have to look there and clean up after themselves.
 */
const SQL_DIR = path.join(process.cwd(), "database", "sql");

describe("Postgres integration — exportSQL() output shape", () => {
  let harness: PostgresHarness;
  let runner: MigrationRunner;

  /**
   * Filenames present in the export directory before a test ran. Only files
   * absent from this set are deleted afterwards, so a developer's own
   * `database/sql` contents survive the suite.
   */
  let preExistingFiles: Set<string>;
  let sqlDirPreExisted: boolean;

  beforeAll(async () => {
    harness = await startPostgresHarness();
    sqlDirPreExisted = fs.existsSync(SQL_DIR);
  });

  afterAll(async () => {
    await harness.stop();

    // Only remove the directory if this suite is what created it.
    if (!sqlDirPreExisted && fs.existsSync(SQL_DIR) && fs.readdirSync(SQL_DIR).length === 0) {
      fs.rmdirSync(SQL_DIR);
    }
  });

  beforeEach(async () => {
    await harness.dropTables(...MIG_TABLES);

    runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });

    preExistingFiles = new Set(fs.existsSync(SQL_DIR) ? fs.readdirSync(SQL_DIR) : []);
  });

  afterEach(async () => {
    for (const file of exportedFiles()) {
      fs.unlinkSync(path.join(SQL_DIR, file));
    }

    await harness.dropTables(...MIG_TABLES);
  });

  /** Files this test created, ignoring anything that was already there. */
  function exportedFiles(): string[] {
    if (!fs.existsSync(SQL_DIR)) return [];

    return fs.readdirSync(SQL_DIR).filter((file) => !preExistingFiles.has(file));
  }

  function readExported(file: string): string {
    return fs.readFileSync(path.join(SQL_DIR, file), "utf8");
  }

  it("writes exactly two files, both named for the clock rather than for any migration", async () => {
    runner.registerMany([CreateWidgetsTable, CreateAuthorsTable]);

    await runner.exportSQL({ pendingOnly: true });

    const files = exportedFiles().sort();

    expect(files).toHaveLength(2);

    const [downFile, upFile] = files;

    expect(upFile).toMatch(/^migration_[\d-]+_[\d-]+\.up\.sql$/);
    expect(downFile).toMatch(/^migration_[\d-]+_[\d-]+\.down\.sql$/);

    // The operator's instinct is to read the pending set off the filenames.
    // It is not there — two migrations went in, and neither name comes out.
    expect(upFile).not.toContain("widgets");
    expect(upFile).not.toContain("authors");
    expect(upFile).not.toContain("create_mig");
  });

  /**
   * `CreateWidgetsTable` is chosen deliberately: it emits `CREATE TABLE`
   * (SQLGrammar phase 2) AND `CREATE [UNIQUE] INDEX` for `sku` / `quantity`
   * (phase 4). Since headers are grouped by (phase, migration), that single
   * migration necessarily produces two headers.
   *
   * The phases are asserted explicitly rather than left implicit in a
   * `headers.length > names.size` comparison. A single-phase fixture would make
   * that comparison fail against entirely correct output, and the failure would
   * look like a defect in `exportSQL` instead of a fixture that stopped
   * spanning phases.
   */
  it("puts the migration names only inside the file, repeated once per phase", async () => {
    runner.registerMany([CreateWidgetsTable]);

    await runner.exportSQL({ pendingOnly: true });

    const upFile = exportedFiles().find((file) => file.endsWith(".up.sql"))!;
    const contents = readExported(upFile);

    const headers = contents.match(/\/\* Phase (\d+) \[([^\]]+)\] \*\//g) ?? [];

    expect(headers.length).toBeGreaterThan(0);

    const names = new Set<string>();
    const phases = new Set<string>();

    for (const header of headers) {
      const parsed = header.match(/\/\* Phase (\d+) \[([^\]]+)\] \*\//)!;
      phases.add(parsed[1]);
      names.add(parsed[2]);
    }

    // Exactly one migration is in the export...
    expect(names).toEqual(new Set(["create_mig_widgets"]));

    // ...spread across the table-creation and index-creation phases.
    expect(phases).toEqual(new Set(["2", "4"]));

    // Which is the operator-facing consequence: a naive `grep | wc -l` over the
    // headers reports 2 pending migrations when there is 1. Reading this file
    // means deduplicating, not counting.
    expect(headers.length).toBeGreaterThan(names.size);
  });

  it("strips every migration name from the file when compact is set", async () => {
    runner.registerMany([CreateWidgetsTable]);

    await runner.exportSQL({ pendingOnly: true, compact: true });

    const upFile = exportedFiles().find((file) => file.endsWith(".up.sql"))!;
    const contents = readExported(upFile);

    expect(contents).not.toContain("create_mig_widgets");
    expect(contents).not.toContain("/*");

    // The SQL is still there. That is what makes it dangerous: the file looks
    // complete and answers the operator's question with nothing at all.
    expect(contents.toUpperCase()).toContain("CREATE TABLE");
  });

  it("writes no files at all when nothing is pending", async () => {
    runner.registerMany([CreateAuthorsTable]);

    await runner.runAll();

    expect(await runner.getExecutedMigrations()).toHaveLength(1);

    await runner.exportSQL({ pendingOnly: true });

    // The all-clear is signalled by absence of output — indistinguishable at a
    // glance from the command having failed to do anything.
    expect(exportedFiles()).toHaveLength(0);
  });

  it("excludes already-executed migrations from the pending export", async () => {
    runner.registerMany([CreateAuthorsTable, CreateEventsTable]);

    await runner.run(CreateAuthorsTable, { record: true });

    await runner.exportSQL({ pendingOnly: true });

    const upFile = exportedFiles().find((file) => file.endsWith(".up.sql"))!;
    const contents = readExported(upFile);

    expect(contents).toContain("create_mig_events");
    expect(contents).not.toContain("create_mig_authors");
  });

  it("includes executed migrations when pendingOnly is not set", async () => {
    runner.registerMany([CreateAuthorsTable, CreateEventsTable]);

    await runner.run(CreateAuthorsTable, { record: true });

    await runner.exportSQL();

    const upFile = exportedFiles().find((file) => file.endsWith(".up.sql"))!;
    const contents = readExported(upFile);

    expect(contents).toContain("create_mig_events");
    expect(contents).toContain("create_mig_authors");
  });
});
