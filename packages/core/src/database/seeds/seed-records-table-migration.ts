import { Migration } from "@warlock.js/cascade";
import { seedRecordsTableName } from "./utils";

/**
 * Creates the `seed_records` table that backs `warlock seed --drop`.
 *
 * Each row is a reference to a single record a seeder created, captured via the
 * `track` helper inside the same transaction the seed ran in. `--drop` reads
 * these refs to delete exactly (and only) the records a seed produced, then
 * resets the matching seeds-log row so a `once: true` seed can re-run.
 */
export class SeedRecordsTableMigration extends Migration {
  public static migrationName = "seed-records-table-migration";
  public table = seedRecordsTableName;

  public up() {
    this.createTableIfNotExists();

    this.id();
    this.text("seeder");
    this.text("table");
    this.text("recordId");
    this.dateTime("runAt").useCurrent();
  }

  public down() {
    this.dropTableIfExists(seedRecordsTableName);
  }
}
