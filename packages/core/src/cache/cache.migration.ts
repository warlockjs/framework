import { migrate } from "@warlock.js/cascade";
import { CacheModel } from "./database-cache-driver";

/**
 * Creates the `cache` table the `database` cache driver reads and writes.
 *
 * `key` has a unique index, which the driver's `upsert: true` option needs
 * (one upsert per `set` instead of a read followed by an insert or update).
 *
 * Register it with `database.migrations` in `warlock.config.ts`:
 * `migrations: [...authMigrations, cacheMigration]`.
 */
export const cacheMigration = migrate(CacheModel, {
  name: "cache",
  up() {
    this.createTableIfNotExists();

    this.primaryUuid();

    this.text("key").unique();
    this.text("namespace").index();
    this.json("data").nullable();
    this.integer("ttl").nullable();
    // Epoch milliseconds, the field name the driver writes and reads.
    this.bigInteger("expiresAt").index().nullable();

    this.timestamps();
  },
  down() {
    this.dropTableIfExists();
  },
});
