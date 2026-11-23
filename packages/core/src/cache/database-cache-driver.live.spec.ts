/**
 * The database cache driver against a real database, on PostgreSQL and
 * MongoDB. Skips unless the environment names a server:
 *
 *   LOCAL_PG_DATABASE, LOCAL_PG_USER, LOCAL_PG_PASSWORD (LOCAL_PG_HOST, LOCAL_PG_PORT)
 *   LOCAL_MONGO_URI, LOCAL_MONGO_DATABASE
 *
 * Use a database made for tests: the suite drops and recreates the `cache`
 * table (collection) with `cacheMigration`.
 */
import {
  DataSource,
  dataSourceRegistry,
  MigrationRunner,
  MongoDbDriver,
  PostgresDriver,
} from "@warlock.js/cascade";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cacheMigration } from "./cache.migration";
import { CacheModel, DatabaseCacheDriver } from "./database-cache-driver";

type Target = {
  label: string;
  available: boolean;
  connect: () => Promise<{
    dataSource: DataSource;
    dropCache: () => Promise<void>;
    stop: () => Promise<void>;
  }>;
};

const targets: Target[] = [
  {
    label: "postgres",
    available: Boolean(process.env.LOCAL_PG_DATABASE && process.env.LOCAL_PG_USER),
    async connect() {
      const database = process.env.LOCAL_PG_DATABASE ?? "";
      const user = process.env.LOCAL_PG_USER ?? "";
      const password = process.env.LOCAL_PG_PASSWORD ?? "";
      const host = process.env.LOCAL_PG_HOST ?? "127.0.0.1";
      const port = process.env.LOCAL_PG_PORT ?? "5432";
      const driver = new PostgresDriver({
        connectionString: `postgres://${user}:${password}@${host}:${port}/${database}`,
        database,
        logging: false,
      });

      await driver.connect();

      const dataSource = new DataSource({
        name: "cache-live-pg",
        driver,
        isDefault: true,
        migrationDefaults: { primaryKey: "uuid" },
      });

      dataSourceRegistry.register(dataSource);

      return {
        dataSource,
        dropCache: async () => void (await driver.query('DROP TABLE IF EXISTS "cache" CASCADE')),
        stop: async () => {
          await driver.disconnect();
          dataSourceRegistry.clear();
        },
      };
    },
  },
  {
    label: "mongodb",
    available: Boolean(process.env.LOCAL_MONGO_URI && process.env.LOCAL_MONGO_DATABASE),
    async connect() {
      const driver = new MongoDbDriver({
        uri: process.env.LOCAL_MONGO_URI ?? "",
        database: process.env.LOCAL_MONGO_DATABASE ?? "",
        logging: false,
        clientOptions: { directConnection: true },
      });

      await driver.connect();

      const dataSource = new DataSource({ name: "cache-live-mongo", driver, isDefault: true });

      dataSourceRegistry.register(dataSource);

      return {
        dataSource,
        dropCache: async () =>
          void (await driver
            .getDatabase()
            .collection("cache")
            .drop()
            .catch(() => undefined)),
        stop: async () => {
          await driver.disconnect();
          dataSourceRegistry.clear();
        },
      };
    },
  },
];

describe.each(targets)("DatabaseCacheDriver on $label", ({ available, connect }) => {
  let session: Awaited<ReturnType<Target["connect"]>>;

  const migrate = async () => {
    await session.dropCache();
    await new MigrationRunner({ dataSource: session.dataSource, verbose: false }).run(
      cacheMigration as never,
    );
  };

  beforeAll(async () => {
    if (!available) return;

    session = await connect();
    await migrate();
  });

  afterAll(async () => {
    if (!available) return;

    await session.dropCache();
    await session.stop();
  });

  it.skipIf(!available)(
    "stores, reads and overwrites an entry with one upsert (detected)",
    async () => {
      const driver = new DatabaseCacheDriver().setOptions({ model: CacheModel });

      await driver.set("live.a", { n: 1 });
      await driver.set("live.a", { n: 2 });

      expect(await driver.get("live.a")).toEqual({ n: 2 });
      expect(await CacheModel.query().where("key", "live.a").count()).toBe(1);
    },
  );

  it.skipIf(!available)("agrees with the read-then-write path (upsert: false)", async () => {
    const driver = new DatabaseCacheDriver().setOptions({ model: CacheModel, upsert: false });

    await driver.set("live.b", "one");
    await driver.set("live.b", "two");

    expect(await driver.get("live.b")).toBe("two");
    expect(await CacheModel.query().where("key", "live.b").count()).toBe(1);
  });

  it.skipIf(!available)("writes one row per key with upsert: true, and stays silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const driver = new DatabaseCacheDriver().setOptions({ model: CacheModel, upsert: true });

      await driver.set("live.c", 1);
      await driver.set("live.c", 2);

      expect(await driver.get("live.c")).toBe(2);
      expect(await CacheModel.query().where("key", "live.c").count()).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
