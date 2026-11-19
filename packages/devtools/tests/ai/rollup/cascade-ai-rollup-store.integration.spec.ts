/**
 * The AI rollup store contract against a real database through `@warlock.js/cascade`.
 *
 * Not part of the default run. From `packages/devtools`:
 *
 *   DEVTOOLS_TEST_MONGO_URL=mongodb://127.0.0.1:27017/devtools_store_test \
 *   DEVTOOLS_TEST_PG_URL=postgresql://user:pass@127.0.0.1:5432/devtools_store_test \
 *   npx vitest run --config vitest.integration.config.ts tests/ai/rollup
 *
 * Use EMPTY databases made for the test: the spec creates the monitor's tables
 * with `devtoolsMigrations` and drops them at the end.
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
import { createCascadeAiRollupStore } from "../../../src/ai/rollup/cascade-store";
import { DevtoolsAiRollupRow } from "../../../src/production/store/models";
import { devtoolsMigrations } from "../../../src/production/store/migrations";
import { HOUR_START } from "./helpers";
import { ALL_TIME, deltaFor, describeAiRollupStoreContract } from "./store-contract";

const databases = [
  { label: "mongodb", driver: "mongodb", url: process.env.DEVTOOLS_TEST_MONGO_URL },
  { label: "postgres", driver: "postgres", url: process.env.DEVTOOLS_TEST_PG_URL },
] as const;

for (const database of databases) {
  describe.skipIf(!database.url)(`cascade ai rollup store on ${database.label}`, () => {
    let source: DataSource;

    beforeAll(async () => {
      dataSourceRegistry.clear();
      source = await connectToDatabase({
        driver: database.driver,
        uri: database.url!,
        database: new URL(database.url!).pathname.slice(1),
        isDefault: true,
      });
      // The runner is a process-wide singleton: point it at this database, not the previous suite's.
      migrationRunner.clear().setDataSource(source);
      migrationRunner.registerMany([...devtoolsMigrations]);
      await freshMigrate();
    });

    afterAll(async () => {
      await rollbackMigrations({ all: true });
      await source.driver.disconnect();
      dataSourceRegistry.clear();
    });

    describeAiRollupStoreContract(database.label, async () => {
      await (
        DevtoolsAiRollupRow.query() as unknown as {
          where(f: string, o: string, v: unknown): { delete(): Promise<number> };
        }
      )
        .where("id", "!=", "")
        .delete();

      return createCascadeAiRollupStore();
    });

    it("adds concurrent increments of one row without losing any", async () => {
      const store = await createCascadeAiRollupStore();

      await Promise.all(
        [1, 2, 3, 4, 5, 6, 7, 8].map(() =>
          store.increment([deltaFor(HOUR_START + 99 * 3_600_000)]),
        ),
      );

      const rows = await store.list({
        fromHour: HOUR_START + 99 * 3_600_000,
        toHour: Number.MAX_SAFE_INTEGER,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].runs).toBe(8);
    });
  });
}

describe("cascade ai rollup store without its table", () => {
  it("is not needed to import", () => {
    expect(ALL_TIME.fromHour).toBe(0);
    expect(typeof createCascadeAiRollupStore).toBe("function");
  });
});
