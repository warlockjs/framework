import type { Db } from "mongodb";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoDbDriver } from "../../../src/drivers/mongodb/mongodb-driver";
import type { ModelDefaults } from "../../../src/types";

/**
 * A harness for a MongoDB server this process did NOT start — the MongoDB
 * counterpart of `local-postgres-harness.ts`, for machines with a `mongod`
 * binary but no Docker.
 *
 * It connects to ONE database named by `LOCAL_MONGO_DATABASE`, drops only the
 * collections it is explicitly given, and on teardown disconnects without
 * touching the server.
 */
export type LocalMongodbHarnessOptions = {
  /** Data source name in the registry. Defaults to `"local-mongo-test"`. */
  readonly dataSourceName?: string;
  /** Register as the default data source. Defaults to `true`. */
  readonly isDefault?: boolean;
  /** Log commands. Defaults to `false`. */
  readonly logging?: boolean;
  /**
   * Model defaults set on the data source (they win over the driver's). The
   * MongoDB driver infers camelCase relation keys (`userId`); a suite whose
   * fixtures store snake_case keys passes `{ namingConvention: "snake_case" }`.
   */
  readonly modelDefaults?: Partial<ModelDefaults>;
};

export type LocalMongodbHarness = {
  readonly driver: MongoDbDriver;
  readonly dataSource: DataSource;
  /** The native database handle, for seeding and direct assertions. */
  readonly db: Db;
  /** Drop the named collections if they exist. Pass only collections the test created. */
  readonly dropCollections: (...collections: string[]) => Promise<void>;
  /** Disconnect and clear the registry. Does NOT stop the server. */
  readonly stop: () => Promise<void>;
};

/**
 * Whether the local MongoDB suite has been given somewhere to connect.
 *
 * Used to skip rather than fail on a machine with no local server.
 */
export function hasLocalMongodb(): boolean {
  return Boolean(process.env.LOCAL_MONGO_URI && process.env.LOCAL_MONGO_DATABASE);
}

/**
 * Connect a cascade MongoDB data source to the server named by
 * `LOCAL_MONGO_URI` / `LOCAL_MONGO_DATABASE` and register it as the default.
 */
export async function startLocalMongodbHarness(
  options: LocalMongodbHarnessOptions = {},
): Promise<LocalMongodbHarness> {
  const uri = process.env.LOCAL_MONGO_URI;
  const database = process.env.LOCAL_MONGO_DATABASE;

  if (!uri || !database) {
    throw new Error(
      "LOCAL_MONGO_URI and LOCAL_MONGO_DATABASE must be set. The local MongoDB suite refuses to guess a connection target.",
    );
  }

  const driver = new MongoDbDriver({
    uri,
    database,
    logging: options.logging ?? false,
    clientOptions: { directConnection: true },
  });

  await driver.connect();

  const dataSource = new DataSource({
    name: options.dataSourceName ?? "local-mongo-test",
    driver,
    isDefault: options.isDefault ?? true,
    modelDefaults: options.modelDefaults,
  });

  dataSourceRegistry.register(dataSource);

  const db = driver.getDatabase();

  return {
    driver,
    dataSource,
    db,
    dropCollections: async (...collections: string[]) => {
      for (const collection of collections) {
        await db
          .collection(collection)
          .drop()
          .catch(() => undefined);
      }
    },
    stop: async () => {
      await driver.disconnect();
      dataSourceRegistry.clear();
    },
  };
}
