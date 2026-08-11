import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { migrationRunner } from "../../../src/migration/migration-runner";
import { listExecutedMigrations, listPendingMigrations } from "../../../src/operations/migrations";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Proof that `listPendingMigrations()` answers "what will run next" correctly
 * against a REAL database — the question `warlock migrate` could not answer.
 *
 * Two properties are under test, and they are the two the reporter's manual
 * workaround got wrong:
 *
 *   1. A migration contributed by a PACKAGE (registered as a class, never a
 *      file under `src/app`) appears under executed once it has run. The old
 *      `files − executed` arithmetic subtracted these from a population that
 *      never contained them, under-counting pending in the "safe to proceed"
 *      direction.
 *   2. A fully-migrated database yields an EMPTY pending list — a real answer,
 *      distinct from the empty list an unregistered runner would produce.
 *
 * Runs against a Postgres server this suite does not own. It never creates or
 * drops a database, and touches only `local_mig_*` tables it created itself.
 * Skipped entirely when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

/** Stands in for an app's own migration file under `src/app`. */
class CreateLocalWidgets extends Migration {
  public static migrationName = "create_local_mig_widgets";

  public readonly table = "local_mig_widgets";

  public up(): void {
    this.createTable();
    this.id();
    this.string("name").notNullable();
  }

  public down(): void {
    this.dropTable();
  }
}

/**
 * Stands in for a package-contributed migration — the `@warlock.js/auth` shape.
 * Registered as a class through config, never globbed off disk, and carrying an
 * explicit name that does not match any filename.
 */
class PackageAccessToken extends Migration {
  public static migrationName = "accessToken";

  public readonly table = "local_mig_access_tokens";

  public up(): void {
    this.createTable();
    this.id();
    this.text("token");
  }

  public down(): void {
    this.dropTable();
  }
}

const TABLES = ["local_mig_widgets", "local_mig_access_tokens", "_migrations"];

suite("listPendingMigrations — against a live Postgres", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
  });

  afterAll(async () => {
    await harness.dropTables(...TABLES);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropTables(...TABLES);
    migrationRunner.clear();
  });

  afterEach(async () => {
    migrationRunner.clear();
  });

  it("separates an executed package migration from a pending local one", async () => {
    migrationRunner.registerMany([PackageAccessToken, CreateLocalWidgets]);

    // The package migration has already run — as it would in an app that
    // installed the package some releases ago.
    await migrationRunner.run(PackageAccessToken, { record: true });

    const executed = await listExecutedMigrations();
    const pending = await listPendingMigrations();

    expect(executed.map((record) => record.name)).toEqual(["accessToken"]);
    expect(pending.map((migration) => migration.name)).toEqual(["create_local_mig_widgets"]);
  });

  it("shows why files − executed under-counts: the package migration is in one set only", async () => {
    migrationRunner.registerMany([PackageAccessToken, CreateLocalWidgets]);

    await migrationRunner.run(PackageAccessToken, { record: true });

    const executed = await listExecutedMigrations();
    const pending = await listPendingMigrations();

    // `--all` globs src/app, so it would see ONE file (the local migration).
    const filesOnDisk = 1;

    // The reporter's arithmetic. It reports zero pending; there is one.
    expect(filesOnDisk - executed.length).toBe(0);
    expect(pending).toHaveLength(1);
  });

  it("returns an empty list — a real answer — once everything has run", async () => {
    migrationRunner.registerMany([PackageAccessToken, CreateLocalWidgets]);

    await migrationRunner.runAll();

    const executed = await listExecutedMigrations();
    const pending = await listPendingMigrations();

    expect(executed).toHaveLength(2);
    expect(pending).toEqual([]);
  });

  it("orders pending migrations as they will execute, not as registered", async () => {
    // Registered out of order on purpose: the value of the listing is that it
    // is a dry run, and a dry run in the wrong order is not one.
    migrationRunner.registerMany([CreateLocalWidgets, PackageAccessToken]);

    const pending = await listPendingMigrations();

    expect(pending.map((migration) => migration.name)).toEqual([
      "accessToken",
      "create_local_mig_widgets",
    ]);
  });

  it("reports nothing pending when NOTHING is registered — the trap, pinned", async () => {
    migrationRunner.clear();

    const pending = await listPendingMigrations();

    // This is why the CLI must load before it reports: an empty registry and a
    // fully-migrated database are indistinguishable here, and only the caller
    // knows which one it is looking at.
    expect(pending).toEqual([]);
  });
});
