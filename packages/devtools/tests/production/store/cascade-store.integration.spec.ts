/**
 * The store contract against a real database through `@warlock.js/cascade`.
 *
 * Not part of the default run. From `packages/devtools`:
 *
 *   DEVTOOLS_TEST_MONGO_URL=mongodb://127.0.0.1:27017/devtools_store_test \
 *   DEVTOOLS_TEST_PG_URL=postgresql://user:pass@127.0.0.1:5432/devtools_store_test \
 *   npx vitest run --config vitest.integration.config.ts
 *
 * Each variable is optional; a driver whose variable is unset is skipped. Use
 * EMPTY databases made for the test: the spec creates the monitor's tables
 * with `devtoolsMigrations`, deletes every row between tests and drops the
 * tables at the end.
 */
import {
  connectToDatabase,
  dataSourceRegistry,
  freshMigrate,
  migrationRunner,
  rollbackMigrations,
  type DataSource,
} from "@warlock.js/cascade";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DevtoolsProductionConfigError } from "../../../src/production/errors";
import { createCascadeStore } from "../../../src/production/store/cascade-store";
import {
  DevtoolsAccountRow,
  DevtoolsAuditRow,
  DevtoolsInviteRow,
  DevtoolsReportRow,
  DevtoolsSampleRow,
  DevtoolsSessionRow,
  DevtoolsShareRow,
  DevtoolsStateRow,
} from "../../../src/production/store/models";
import { devtoolsMigrations } from "../../../src/production/store/migrations";
import { describeStoreContract } from "./store-contract";

const TABLES = [
  DevtoolsAccountRow,
  DevtoolsSessionRow,
  DevtoolsShareRow,
  DevtoolsInviteRow,
  DevtoolsAuditRow,
  DevtoolsStateRow,
  DevtoolsSampleRow,
  DevtoolsReportRow,
];

const databases = [
  { label: "mongodb", driver: "mongodb", url: process.env.DEVTOOLS_TEST_MONGO_URL },
  { label: "postgres", driver: "postgres", url: process.env.DEVTOOLS_TEST_PG_URL },
] as const;

for (const database of databases) {
  describe.skipIf(!database.url)(`cascade store on ${database.label}`, () => {
    let source: DataSource;
    let now = 1000;

    beforeAll(async () => {
      dataSourceRegistry.clear();
      source = await connectToDatabase({
        driver: database.driver,
        uri: database.url!,
        // MongoDB takes the database from the uri; PostgreSQL ignores this field with a uri.
        database: new URL(database.url!).pathname.slice(1),
        isDefault: true,
      });
      migrationRunner.registerMany([...devtoolsMigrations]);
      await freshMigrate();
    });

    afterAll(async () => {
      await rollbackMigrations({ all: true });
      await source.driver.disconnect();
      dataSourceRegistry.clear();
    });

    it("verifies once the tables exist", async () => {
      const store = await createCascadeStore();

      await expect(store.verify()).resolves.toBeUndefined();
    });

    describeStoreContract(database.label, async () => {
      for (const table of TABLES) {
        await (
          table.query() as unknown as {
            where(f: string, o: string, v: unknown): { delete(): Promise<number> };
          }
        )
          .where("id", "!=", "")
          .delete();
      }

      now = 1000;

      const store = await createCascadeStore({ now: () => now });

      return { store, setNow: (at) => void (now = at) };
    });
  });
}

describe("cascade store without a data source", () => {
  it("refuses with DT005", async () => {
    dataSourceRegistry.clear();

    await expect(createCascadeStore()).rejects.toBeInstanceOf(DevtoolsProductionConfigError);
    await expect(createCascadeStore()).rejects.toMatchObject({ code: "DT005" });
  });
});
