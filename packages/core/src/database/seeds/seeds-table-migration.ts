import { Migration } from "@warlock.js/cascade";
import { seedsTableName } from "./utils";

export class SeedsTableMigration extends Migration {
  public static migrationName = "seeds-table-migration";
  public static table = seedsTableName;

  public up() {
    this.createTableIfNotExists();

    this.int("id").unique().autoIncrement();
    this.string("name").unique();
    this.int("runCount").defaultTo(0);
    this.dateTime("createdAt").defaultToNow();
    this.dateTime("firstRunAt").defaultToNow();
    this.dateTime("lastRunAt").defaultToNow();
    this.int("totalRecordsCreated").defaultTo(0);
    this.int("lastRunRecordsCreated").defaultTo(0);
  }

  public down() {
    this.dropTableIfExists(seedsTableName);
  }
}
