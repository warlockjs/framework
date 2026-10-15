/**
 * Model fixtures for the declarative-schema integration suites
 * (`Migration.create` / `Migration.alter`).
 *
 * These are intentionally plain `Model` subclasses — no relation decorators —
 * because the suites under test exercise SCHEMA generation, not the relation
 * graph. Each model only needs a `table` (the declarative factories read
 * `model.table` and `model.dataSource`).
 *
 * Tables are namespaced (`sync_*` for Postgres, `msync_*` for MongoDB) so they
 * never clash with the sibling CRUD / migrations / relations suites that share
 * the same container database.
 */
import { Model } from "../../../../src/model/model";

/** Postgres declarative-schema target. */
export class SyncWidget extends Model {
  public static table = "sync_widgets";
}

/** Postgres declarative parent table referenced by a foreign key in alter(). */
export class SyncCategory extends Model {
  public static table = "sync_categories";
}

/** MongoDB declarative-schema target (index + validation sync). */
export class MongoSyncWidget extends Model {
  public static table = "msync_widgets";
}
