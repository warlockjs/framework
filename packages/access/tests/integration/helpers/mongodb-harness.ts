import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { DataSource, dataSourceRegistry, MongoDbDriver } from "@warlock.js/cascade";
import type { Db } from "mongodb";

const DEFAULT_MONGODB_IMAGE = "mongo:7";
const DEFAULT_DATABASE = "access_test";

/**
 * A live MongoDB test harness for `@warlock.js/access` (single-node replica
 * set). Built on the PUBLIC cascade surface; collections auto-create on first
 * write, so there is no migration step.
 */
export type MongodbHarness = {
  container: StartedMongoDBContainer;
  driver: MongoDbDriver;
  dataSource: DataSource;
  db: Db;
  dropCollections: (...collections: string[]) => Promise<void>;
  stop: () => Promise<void>;
};

export async function startMongodbHarness(): Promise<MongodbHarness> {
  const container = await new MongoDBContainer(DEFAULT_MONGODB_IMAGE).start();

  const driver = new MongoDbDriver({
    uri: container.getConnectionString(),
    database: DEFAULT_DATABASE,
    logging: false,
    clientOptions: { directConnection: true },
  });

  await driver.connect();

  const dataSource = new DataSource({ name: "mongo-test", driver, isDefault: true });

  dataSourceRegistry.register(dataSource);

  const db = driver.getDatabase();

  const dropCollections = async (...collections: string[]) => {
    for (const collection of collections) {
      await db
        .collection(collection)
        .drop()
        .catch(() => undefined);
    }
  };

  const stop = async () => {
    await driver.disconnect();
    dataSourceRegistry.clear();
    await container.stop();
  };

  return { container, driver, dataSource, db, dropCollections, stop };
}
