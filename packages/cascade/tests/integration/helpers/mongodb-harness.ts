import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { Db } from "mongodb";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoDbDriver } from "../../../src/drivers/mongodb/mongodb-driver";
import type { ModelDefaults } from "../../../src/types";
import { hasLocalMongodb, startLocalMongodbHarness } from "./local-mongodb-harness";

/**
 * Default MongoDB image. Pinned to a major tag so the harness is reproducible
 * and aligned with the `mongodb` client major (`^7`) the workspace installs.
 * `MongoDBContainer` boots a single-node replica set, which MongoDB needs for
 * the multi-document transactions cascade uses (e.g. the ID generator).
 */
const DEFAULT_MONGODB_IMAGE = "mongo:7";

/**
 * Database name selected on the live server. The container's connection string
 * has no database path, so the driver selects this one explicitly.
 */
const DEFAULT_DATABASE = "cascade_test";

/**
 * Options for spinning up a MongoDB integration harness.
 */
export type MongodbHarnessOptions = {
  /** Docker image tag to run. Defaults to `mongo:7`. */
  image?: string;
  /** Database name to use on the server. Defaults to `"cascade_test"`. */
  database?: string;
  /** Name registered for the data source. Defaults to `"mongo-test"`. */
  dataSourceName?: string;
  /** Whether the registered data source is the default one. Defaults to `true`. */
  isDefault?: boolean;
  /** Enable cascade's command logging. Defaults to `false` (quiet test output). */
  logging?: boolean;
  /**
   * Model defaults set on the data source (they win over the driver's). The
   * MongoDB driver infers camelCase relation keys (`userId`); a suite whose
   * fixtures store snake_case keys passes `{ namingConvention: "snake_case" }`.
   */
  modelDefaults?: Partial<ModelDefaults>;
};

/**
 * A live MongoDB test harness: a running container (single-node replica set), a
 * connected cascade `MongoDbDriver` + `DataSource` registered in the global
 * registry, the native `Db` handle, plus helpers to reset state and tear
 * everything down.
 *
 * Every field is what an integration test actually touches — there is no hidden
 * lifecycle. Call `stop()` once in `afterAll`.
 */
export type MongodbHarness = {
  /** The started testcontainers MongoDB instance; `undefined` when `LOCAL_MONGO_URI` points at an existing server. */
  container?: StartedMongoDBContainer;
  /** The connected cascade MongoDB driver. */
  driver: MongoDbDriver;
  /** The registered cascade data source wrapping the driver. */
  dataSource: DataSource;
  /** The native MongoDB database handle, for direct assertions or cleanup. */
  db: Db;
  /**
   * Drop the given collections (ignoring "namespace not found") so each test
   * starts from a clean slate. Pass the collections the test wrote to.
   */
  dropCollections: (...collections: string[]) => Promise<void>;
  /** Disconnect the driver, clear the registry, and stop the container. */
  stop: () => Promise<void>;
};

/**
 * Start a real MongoDB container, connect a cascade data source to it, and
 * register that data source as the default so `Model` subclasses resolve to it
 * automatically.
 *
 * When `LOCAL_MONGO_URI` and `LOCAL_MONGO_DATABASE` are set, no container is
 * started: the harness connects to that existing server instead (see
 * `local-mongodb-harness.ts`).
 *
 * The first call is slow because Docker pulls the image, boots the server, and
 * initializes the replica set; subsequent runs reuse the cached image. Always
 * pair it with `stop()` in `afterAll`.
 *
 * @example
 * ```typescript
 * let harness: MongodbHarness;
 *
 * beforeAll(async () => {
 *   harness = await startMongodbHarness();
 * });
 *
 * afterAll(async () => {
 *   await harness.stop();
 * });
 *
 * class User extends Model {
 *   static table = "users";
 * }
 *
 * const user = await User.create({ name: "Alice" });
 * // collections are created on first write — no DDL needed.
 * ```
 */
export async function startMongodbHarness(
  options: MongodbHarnessOptions = {},
): Promise<MongodbHarness> {
  const dataSourceName = options.dataSourceName ?? "mongo-test";
  const isDefault = options.isDefault ?? true;

  // An existing server named by LOCAL_MONGO_* replaces the container: no
  // Docker, and teardown only disconnects. See tests/integration/README.md.
  if (hasLocalMongodb()) {
    return startLocalMongodbHarness({
      dataSourceName,
      isDefault,
      logging: options.logging,
      modelDefaults: options.modelDefaults,
    });
  }

  const image = options.image ?? DEFAULT_MONGODB_IMAGE;
  const database = options.database ?? DEFAULT_DATABASE;

  const container = await new MongoDBContainer(image).start();

  const driver = new MongoDbDriver({
    uri: container.getConnectionString(),
    database,
    logging: options.logging ?? false,
    clientOptions: { directConnection: true },
  });

  await driver.connect();

  const dataSource = new DataSource({
    name: dataSourceName,
    driver,
    isDefault,
    modelDefaults: options.modelDefaults,
  });

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
