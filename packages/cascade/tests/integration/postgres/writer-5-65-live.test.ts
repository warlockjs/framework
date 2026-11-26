import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseWriterValidationError } from "../../../src/validation";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Live checks for a bounded `update()` and composite unique violations on a
 * real PostgreSQL. Touches only the `local_live565_*` tables.
 * Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const TASKS = "local_live565_tasks";
const RECEIPTS = "local_live565_receipts";

class Task extends Model {
  public static table = TASKS;
}

class Receipt extends Model {
  public static table = RECEIPTS;
}

suite("Postgres live: 5.65 bounded update and unique violations", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
  });

  beforeEach(async () => {
    await harness.dropTables(TASKS, RECEIPTS);
    await harness.query(
      `CREATE TABLE "${TASKS}" (id SERIAL PRIMARY KEY, rank INTEGER, status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`,
    );
    await harness.query(
      `INSERT INTO "${TASKS}" (rank, status) VALUES (3, 'open'), (1, 'open'), (2, 'open'), (4, 'done')`,
    );
    await harness.query(
      `CREATE TABLE "${RECEIPTS}" (id SERIAL PRIMARY KEY, "tenantId" INTEGER, "fileId" INTEGER, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, CONSTRAINT receipts_tenant_file UNIQUE ("tenantId", "fileId"))`,
    );
  });

  afterAll(async () => {
    await harness.dropTables(TASKS, RECEIPTS);
    await harness.stop();
  });

  it("updates only the row limit(1) with orderBy selects", async () => {
    const changed = await Task.query()
      .where("status", "open")
      .orderBy("rank", "asc")
      .limit(1)
      .update({ status: "claimed" });

    expect(changed).toBe(1);
    const claimed = await harness.query(`SELECT rank FROM "${TASKS}" WHERE status = 'claimed'`);
    expect(claimed.rows.map((row: { rank: number }) => row.rank)).toEqual([1]);
  });

  it("honours limit with offset, and updates every match without a bound", async () => {
    expect(
      await Task.query().where("status", "open").orderBy("rank", "asc").offset(1).limit(1).update({
        status: "second",
      }),
    ).toBe(1);
    const second = await harness.query(`SELECT rank FROM "${TASKS}" WHERE status = 'second'`);
    expect(second.rows.map((row: { rank: number }) => row.rank)).toEqual([2]);

    expect(await Task.query().where("status", "open").update({ status: "all" })).toBe(2);
  });

  it("names every column of a composite unique constraint, with the constraint and cause", async () => {
    await Receipt.create({ tenantId: 1, fileId: 2 });

    const error = await Receipt.create({ tenantId: 1, fileId: 2 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DatabaseWriterValidationError);
    const validation = error as DatabaseWriterValidationError;
    expect(validation.columns).toEqual(["tenantId", "fileId"]);
    expect(validation.constraint).toBe("receipts_tenant_file");
    expect(validation.errors[0]!.input).toBe("tenantId, fileId");
    expect((validation.cause as { code?: string }).code).toBe("23505");
  });
});
