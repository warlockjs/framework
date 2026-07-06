import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import {
  CreateAuthorsTable,
  CreateBooksTable,
  CreateEventsTable,
  CreateWidgetsTable,
} from "../fixtures/migrations/postgres-migrations";
import { startPostgresHarness, type PostgresHarness } from "../helpers";

/**
 * Integration coverage for cascade's Postgres MIGRATION RUNNER executed against
 * a REAL Postgres server (via testcontainers).
 *
 * Migrations are run PROGRAMMATICALLY through `MigrationRunner` — the same
 * executor the CLI wraps — never via a shell. The flow under test is:
 *
 *   runner.run(MigrationClass)      → migration.up()  → toSQL() → driver.query()
 *   runner.rollback(MigrationClass) → migration.down() → toSQL() → driver.query()
 *
 * Every assertion reads the LIVE catalog (`information_schema.*`, `pg_indexes`)
 * rather than trusting the runner's own report, so a green test means the DDL
 * actually landed in the database.
 *
 * Tables are namespaced `mig_*` to stay isolated from the sibling suites.
 */

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

const MIG_TABLES = [
  "mig_widgets",
  "mig_books",
  "mig_authors",
  "mig_events",
  "_migrations",
];

describe("Postgres integration — migration runner (up / down)", () => {
  let harness: PostgresHarness;
  let runner: MigrationRunner;

  beforeAll(async () => {
    harness = await startPostgresHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  // A fresh runner + a clean slate of mig_* tables per test. Dropping
  // `_migrations` too keeps batch numbers deterministic across tests.
  beforeEach(async () => {
    await harness.dropTables(...MIG_TABLES);
    runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });
  });

  /** Read live column metadata for a table, keyed by column name. */
  async function getColumns(table: string): Promise<Map<string, ColumnRow>> {
    const result = await harness.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default,
              character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );

    return new Map(result.rows.map((row) => [row.column_name, row]));
  }

  /** Read live index definitions for a table, keyed by index name. */
  async function getIndexes(table: string): Promise<Map<string, string>> {
    const result = await harness.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    );

    return new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
  }

  /** Whether a table currently exists in the public schema. */
  async function tableExists(table: string): Promise<boolean> {
    const result = await harness.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS exists`,
      [table],
    );

    return result.rows[0]?.exists ?? false;
  }

  it("creates the table with all columns on up(), then removes it on down()", async () => {
    await runner.run(CreateWidgetsTable);

    expect(await tableExists("mig_widgets")).toBe(true);

    const columns = await getColumns("mig_widgets");

    expect([...columns.keys()].sort()).toEqual(
      [
        "created_at",
        "description",
        "id",
        "is_active",
        "metadata",
        "name",
        "price",
        "public_id",
        "quantity",
        "sku",
        "status",
        "updated_at",
      ].sort(),
    );

    await runner.rollback(CreateWidgetsTable);

    expect(await tableExists("mig_widgets")).toBe(false);
  });

  it("maps abstract column types to the correct real Postgres types", async () => {
    await runner.run(CreateWidgetsTable);

    const columns = await getColumns("mig_widgets");

    expect(columns.get("id")!.data_type).toBe("integer");
    // string() defaults to length 255 → VARCHAR(255), reported as "character varying"
    expect(columns.get("name")!.data_type).toBe("character varying");
    expect(columns.get("name")!.character_maximum_length).toBe(255);
    expect(columns.get("sku")!.data_type).toBe("character varying");
    expect(columns.get("sku")!.character_maximum_length).toBe(64);
    // text() (no length) → TEXT
    expect(columns.get("description")!.data_type).toBe("text");
    expect(columns.get("quantity")!.data_type).toBe("integer");
    expect(columns.get("is_active")!.data_type).toBe("boolean");
    expect(columns.get("price")!.data_type).toBe("numeric");
    expect(columns.get("price")!.numeric_precision).toBe(10);
    expect(columns.get("price")!.numeric_scale).toBe(2);
    expect(columns.get("metadata")!.data_type).toBe("jsonb");
    expect(columns.get("public_id")!.data_type).toBe("uuid");
    // enum maps to TEXT on Postgres (CREATE TYPE is not emitted by the builder)
    expect(columns.get("status")!.data_type).toBe("text");
  });

  it("applies nullability, defaults, and the SERIAL primary key correctly", async () => {
    await runner.run(CreateWidgetsTable);

    const columns = await getColumns("mig_widgets");

    // id() → SERIAL → integer NOT NULL with a nextval(...) default
    expect(columns.get("id")!.is_nullable).toBe("NO");
    expect(columns.get("id")!.column_default).toContain("nextval");

    // notNullable() vs nullable()
    expect(columns.get("name")!.is_nullable).toBe("NO");
    expect(columns.get("description")!.is_nullable).toBe("YES");

    // numeric default
    expect(columns.get("quantity")!.column_default).toContain("0");

    // boolean default
    expect(columns.get("is_active")!.column_default).toBe("true");

    // defaultString() → escaped literal default
    expect(columns.get("status")!.column_default).toContain("'draft'");

    // id is the primary key
    const pk = await harness.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'mig_widgets'
         AND tc.constraint_type = 'PRIMARY KEY'`,
    );

    expect(pk.rows.map((row) => row.column_name)).toEqual(["id"]);
  });

  it("creates the unique index and the regular index, and drops both on down()", async () => {
    await runner.run(CreateWidgetsTable);

    const indexes = await getIndexes("mig_widgets");

    // column .unique() → CREATE UNIQUE INDEX idx_mig_widgets_sku
    const uniqueIndex = indexes.get("idx_mig_widgets_sku");
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex).toContain("UNIQUE");
    expect(uniqueIndex).toContain("sku");

    // column .index() (via this.index("quantity")) → CREATE INDEX idx_mig_widgets_quantity
    const regularIndex = indexes.get("idx_mig_widgets_quantity");
    expect(regularIndex).toBeDefined();
    expect(regularIndex).not.toContain("UNIQUE");
    expect(regularIndex).toContain("quantity");

    await runner.rollback(CreateWidgetsTable);

    expect(await tableExists("mig_widgets")).toBe(false);
  });

  it("creates a composite unique constraint and a composite index", async () => {
    await runner.run(CreateEventsTable);

    const indexes = await getIndexes("mig_events");

    const compositeUnique = indexes.get("uq_mig_events_region_code");
    expect(compositeUnique).toBeDefined();
    expect(compositeUnique).toContain("UNIQUE");
    expect(compositeUnique).toContain("region");
    expect(compositeUnique).toContain("code");

    const compositeIndex = indexes.get("idx_mig_events_region_year");
    expect(compositeIndex).toBeDefined();
    expect(compositeIndex).toContain("region");
    expect(compositeIndex).toContain("year");
  });

  it("creates an enforced foreign key with ON DELETE CASCADE", async () => {
    // Parent must exist before the child FK is added.
    await runner.run(CreateAuthorsTable);
    await runner.run(CreateBooksTable);

    const fk = await harness.query<{
      constraint_name: string;
      delete_rule: string;
      foreign_table_name: string;
    }>(
      `SELECT tc.constraint_name,
              rc.delete_rule,
              ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON rc.unique_constraint_name = ccu.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'mig_books'
         AND tc.constraint_type = 'FOREIGN KEY'`,
    );

    expect(fk.rows).toHaveLength(1);
    expect(fk.rows[0].constraint_name).toBe("fk_mig_books_author_id_mig_authors");
    expect(fk.rows[0].delete_rule).toBe("CASCADE");
    expect(fk.rows[0].foreign_table_name).toBe("mig_authors");

    // The FK is real: deleting a referenced author cascades to its books.
    await harness.query(`INSERT INTO "mig_authors" (name) VALUES ('Asimov')`);
    await harness.query(`INSERT INTO "mig_books" (title, author_id) VALUES ('Foundation', 1)`);

    await harness.query(`DELETE FROM "mig_authors" WHERE id = 1`);

    const remainingBooks = await harness.query(`SELECT id FROM "mig_books"`);
    expect(remainingBooks.rowCount).toBe(0);
  });

  it("runs a migration twice without error or duplicate columns (idempotency via createTableIfNotExists)", async () => {
    // Use a runner whose first run records into _migrations so the second
    // runAll() treats the migration as already-applied (the production
    // idempotency guarantee).
    runner.register(CreateEventsTable);

    const first = await runner.runAll();
    expect(first).toHaveLength(1);
    expect(first[0].success).toBe(true);

    // Second runAll on the SAME runner: migration is already recorded → no-op.
    const second = await runner.runAll();
    expect(second).toHaveLength(0);

    // Exactly one row in the tracking table, one set of columns.
    const tracked = await harness.query<{ name: string }>(
      `SELECT name FROM "_migrations" WHERE name = 'create_mig_events'`,
    );
    expect(tracked.rowCount).toBe(1);

    const columns = await getColumns("mig_events");
    expect(columns.size).toBeGreaterThan(0);
  });

  it("records and removes migration tracking rows across runAll / rollbackAll", async () => {
    runner.registerMany([CreateAuthorsTable, CreateEventsTable]);

    const runResults = await runner.runAll();
    expect(runResults.every((result) => result.success)).toBe(true);

    const recorded = await runner.getExecutedMigrations();
    expect(recorded.map((row) => row.name).sort()).toEqual(
      ["create_mig_authors", "create_mig_events"].sort(),
    );
    // Both ran in the same batch.
    expect(new Set(recorded.map((row) => row.batch)).size).toBe(1);

    await runner.rollbackAll();

    const afterRollback = await runner.getExecutedMigrations();
    expect(afterRollback).toHaveLength(0);

    expect(await tableExists("mig_authors")).toBe(false);
    expect(await tableExists("mig_events")).toBe(false);
  });

  it("reports status() with executed flags for registered migrations", async () => {
    runner.registerMany([CreateAuthorsTable, CreateEventsTable]);

    await runner.run(CreateAuthorsTable, { record: true });

    const status = await runner.status();
    const byName = new Map(status.map((entry) => [entry.name, entry]));

    expect(byName.get("create_mig_authors")!.executed).toBe(true);
    expect(byName.get("create_mig_events")!.executed).toBe(false);
  });

  // CHECK constraints defined via the migration builder (column `.check()` or
  // `this.check()`) are serialized on the SQL path: PostgresSQLSerializer emits
  // `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` for the "addCheck"
  // operation and for a column's `checkConstraint`, matching the direct
  // driver path (PostgresMigrationDriver.addCheck).
  it("creates a CHECK constraint via the builder", async () => {
    class CreateCheckTable extends (await import("../../../src/migration/migration")).Migration {
      public static migrationName = "create_mig_checks";
      public readonly table = "mig_checks";

      public up(): void {
        this.createTable();
        this.id();
        this.integer("age").check("age >= 0", "chk_mig_checks_age");
      }

      public down(): void {
        this.dropTable();
      }
    }

    await runner.run(CreateCheckTable as never);

    const checks = await harness.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND table_name = 'mig_checks'
         AND constraint_type = 'CHECK' AND constraint_name = 'chk_mig_checks_age'`,
    );

    expect(checks.rowCount).toBe(1);

    await harness.dropTables("mig_checks");
  });

  afterEach(async () => {
    await harness.dropTables(...MIG_TABLES);
  });
});
