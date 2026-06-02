/**
 * Class-based migration fixtures for the Postgres migrations integration suite.
 *
 * Each migration is a hand-written `Migration` subclass (the lowest-level
 * authoring form) with a static `migrationName` so the `MigrationRunner` can
 * track it. Tables are namespaced with a `mig_` prefix so they never clash with
 * the CRUD (`integration_*`), relations (`rel_*`), or declarative-sync
 * (`sync_*`) suites sharing the same container database.
 *
 * The fixtures are deliberately small and single-purpose — one schema concern
 * per class — so each test can run + roll back exactly the surface it asserts.
 */
import { Migration } from "../../../../src/migration/migration";

/**
 * Full-featured table: auto-increment id, every common column type, a unique
 * column, an indexed column, and timestamps. Exercises the type-mapping and
 * modifier surface in a single `up()`.
 */
export class CreateWidgetsTable extends Migration {
  public static migrationName = "create_mig_widgets";

  public readonly table = "mig_widgets";

  public up(): void {
    this.createTable();
    this.id();
    this.string("name").notNullable();
    this.string("sku", 64).unique();
    this.text("description").nullable();
    this.integer("quantity").default(0);
    this.boolean("is_active").default(true);
    this.decimal("price", 10, 2).notNullable();
    this.json("metadata").nullable();
    this.uuid("public_id").nullable();
    this.enum("status", ["draft", "published", "archived"]).defaultString("draft");
    this.index("quantity");
    this.timestamps();
  }

  public down(): void {
    this.dropTable();
  }
}

/**
 * Parent table for the foreign-key fixture. Minimal on purpose — just an id and
 * a name — so the child's FK has something to reference.
 */
export class CreateAuthorsTable extends Migration {
  public static migrationName = "create_mig_authors";

  public readonly table = "mig_authors";

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
 * Child table whose `author_id` carries an inline foreign key to
 * `mig_authors`. Exercises the `references().onDelete()` → `ADD CONSTRAINT
 * ... FOREIGN KEY` path. Single migration, so the column + its constraint are
 * queued and executed in order against an already-created parent table.
 */
export class CreateBooksTable extends Migration {
  public static migrationName = "create_mig_books";

  public readonly table = "mig_books";

  public up(): void {
    this.createTable();
    this.id();
    this.string("title").notNullable();
    this.integer("author_id").references("mig_authors").onDelete("cascade");
  }

  public down(): void {
    this.dropTable();
  }
}

/**
 * Composite-index + composite-unique fixture. Two columns, one multi-column
 * index, one multi-column unique constraint — asserts the named-index DDL the
 * serializer emits for the array forms.
 */
export class CreateEventsTable extends Migration {
  public static migrationName = "create_mig_events";

  public readonly table = "mig_events";

  public up(): void {
    this.createTable();
    this.id();
    this.string("region").notNullable();
    this.string("code").notNullable();
    this.integer("year").notNullable();
    this.unique(["region", "code"], "uq_mig_events_region_code");
    this.index(["region", "year"], "idx_mig_events_region_year");
  }

  public down(): void {
    this.dropTable();
  }
}
