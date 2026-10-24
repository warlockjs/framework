import {
  dataSourceRegistry,
  listExecutedMigrations,
  listPendingMigrations,
  runMigrations,
} from "@warlock.js/cascade";
import { loadAllMigrations } from "../database/migrate-action";
import type { MigrationProofProvider } from "./migrations-proof";

/**
 * The provider behind `warlock release migrations --prove`: migrations are
 * loaded the way `warlock migrate` loads them, the ledger and the run go
 * through cascade's migration API, and tables and indexes come from the
 * data source's driver blueprint, so it works for any driver that has one.
 *
 * The database connector must already be started.
 */
export async function createCascadeMigrationProvider(): Promise<MigrationProofProvider> {
  await loadAllMigrations();

  const blueprint = () => dataSourceRegistry.get().driver.blueprint;

  return {
    listExecuted: async () => (await listExecutedMigrations()).map((record) => record.name),
    listPending: async () => (await listPendingMigrations()).map((migration) => migration.name),
    listTables: () => blueprint().listTables(),
    listIndexes: async (table) => (await blueprint().listIndexes(table)).map((index) => index.name),
    runPending: async () => {
      const results = await runMigrations();
      const failed = results.find((result) => !result.success);

      if (failed) throw new Error(`${failed.name}: ${failed.error ?? "failed"}`);

      return results.filter((result) => result.direction === "up").map((result) => result.name);
    },
  };
}
