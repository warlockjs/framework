import type { DataSource } from "@warlock.js/cascade";
import { seedRecordsTableName, seedsTableName } from "./utils";

/**
 * Empty the seed ledger (which seeders ran, and the records they tracked).
 *
 * `migrate --fresh` rebuilds the schema but the ledger tables are not owned by
 * any app migration, so their rows would survive and make the next `seed` skip
 * every `once` seeder against an empty database. Missing tables are ignored.
 */
export async function resetSeedLedger(datasource: DataSource): Promise<void> {
  const { driver } = datasource;

  for (const table of [seedRecordsTableName, seedsTableName]) {
    if (await driver.blueprint.tableExists(table)) {
      await driver.deleteMany(table, {});
    }
  }
}
