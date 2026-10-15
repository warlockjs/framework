import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnsupportedQueryOperationError } from "../../../src/errors/unsupported-query-operation.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * MongoDB-only pipeline stages on a REAL Postgres: each one throws the named
 * error instead of being dropped from the query.
 *
 * Touches only `local_stage_*` tables. Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const POSTS = "local_stage_posts";

class StagePost extends Model {
  public static table = POSTS;
}

/** Run `build` and return what it threw. */
function thrownBy(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }

  return undefined;
}

suite("Postgres refuses MongoDB-only pipeline stages", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
    await harness.dropTables(POSTS);
    await harness.query(`CREATE TABLE "${POSTS}" (id INTEGER PRIMARY KEY, tags JSONB)`);
    await harness.query(`INSERT INTO "${POSTS}" VALUES (1, '["news","tech"]')`);
  });

  afterAll(async () => {
    await harness.dropTables(POSTS);
    await harness.stop();
  });

  it.each([
    ["unwind", () => StagePost.query().unwind("tags")],
    ["addFields", () => StagePost.query().addFields({ score: 1 })],
  ] as const)("%s() throws UnsupportedQueryOperationError", async (operation, build) => {
    const error = thrownBy(build);

    expect(error).toBeInstanceOf(UnsupportedQueryOperationError);
    expect((error as UnsupportedQueryOperationError).operation).toBe(operation);
    expect((error as UnsupportedQueryOperationError).driver).toBe("postgres");

    // The query without the stage still runs — nothing half-applied.
    expect(await StagePost.query().count()).toBe(1);
  });
});
