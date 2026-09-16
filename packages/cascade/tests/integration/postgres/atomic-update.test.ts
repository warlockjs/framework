import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedUpdateOperationError } from "../../../src/errors/unsupported-update-operation.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Atomic update options against a REAL Postgres: upsert through
 * `INSERT … ON CONFLICT … DO UPDATE … RETURNING`, returnDocument, the named
 * error for every operation SQL cannot express, and the concurrency guarantee
 * behind quota reservations.
 *
 * Runs against a server this suite does not own and touches only `local_atomic_*`
 * tables. Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const COUNTERS = "local_atomic_counters";
const QUOTAS = "local_atomic_quotas";
const NOTES = "local_atomic_notes";

class Counter extends Model {
  public static table = COUNTERS;
}

class Quota extends Model {
  public static table = QUOTAS;
}

class Note extends Model {
  public static table = NOTES;
}

/** Assert the promise rejects with the named error for `operation` on postgres. */
async function expectUnsupported(promise: Promise<unknown>, operation: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(UnsupportedUpdateOperationError);
  expect((error as UnsupportedUpdateOperationError).operation).toBe(operation);
  expect((error as UnsupportedUpdateOperationError).driver).toBe("postgres");
}

suite("Postgres atomic updates — options and operators", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
    await harness.dropTables(COUNTERS, QUOTAS, NOTES);
    await harness.query(
      `CREATE TABLE "${COUNTERS}" (id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, count INTEGER, created_by TEXT)`,
    );
    await harness.query(`CREATE TABLE "${QUOTAS}" (id INTEGER PRIMARY KEY, used INTEGER NOT NULL)`);
    await harness.query(`CREATE TABLE "${NOTES}" (title TEXT, body TEXT)`);
  });

  afterAll(async () => {
    await harness.dropTables(COUNTERS, QUOTAS, NOTES);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.query(`TRUNCATE "${COUNTERS}", "${QUOTAS}", "${NOTES}" RESTART IDENTITY`);
  });

  it("upserts on a unique column with $inc + $setOnInsert and returns the new row in one call", async () => {
    const first = await Counter.findOneAndUpdate(
      { key: "signups" },
      { $inc: { count: 1 }, $setOnInsert: { created_by: "seed" } },
      { upsert: true },
    );

    expect(first?.get("count")).toBe(1);
    expect(first?.get("created_by")).toBe("seed");

    const second = await Counter.findOneAndUpdate(
      { key: "signups" },
      { $inc: { count: 1 }, $setOnInsert: { created_by: "other" } },
      { upsert: true },
    );

    expect(second?.get("count")).toBe(2);
    expect(second?.get("created_by")).toBe("seed");

    const rows = await harness.query(`SELECT * FROM "${COUNTERS}"`);
    expect(rows.rows).toHaveLength(1);
  });

  it("upserts on the primary key through atomic and counts insert then update", async () => {
    expect(await Quota.atomic({ id: 7 }, { $inc: { used: 2 } }, { upsert: true })).toBe(1);
    expect(await Quota.atomic({ id: 7 }, { $inc: { used: 2 } }, { upsert: true })).toBe(1);

    const rows = await harness.query<{ used: number }>(`SELECT used FROM "${QUOTAS}" WHERE id = 7`);
    expect(rows.rows[0].used).toBe(4);
  });

  it("a conditional upsert on an existing row that fails the predicate writes nothing", async () => {
    await harness.query(`INSERT INTO "${QUOTAS}" (id, used) VALUES (1, 10)`);

    const result = await Quota.findOneAndUpdate(
      { id: 1, used: { $lt: 10 } },
      { $inc: { used: 1 } },
      { upsert: true, trustedFilter: true },
    );

    expect(result).toBeNull();

    const rows = await harness.query<{ used: number }>(`SELECT used FROM "${QUOTAS}" WHERE id = 1`);
    expect(rows.rows[0].used).toBe(10);
  });

  it("upsert without a unique conflict target throws the named error", async () => {
    await expectUnsupported(
      Note.findOneAndUpdate({ title: "x" }, { $set: { body: "y" } }, { upsert: true }),
      "upsert without a unique conflict target",
    );
  });

  it("returnDocument defaults to after and honours before", async () => {
    await harness.query(`INSERT INTO "${QUOTAS}" (id, used) VALUES (1, 5)`);

    const after = await Quota.findOneAndUpdate({ id: 1 }, { $inc: { used: 1 } });
    expect(after?.get("used")).toBe(6);

    const before = await Quota.findOneAndUpdate(
      { id: 1 },
      { $inc: { used: 1 } },
      { returnDocument: "before" },
    );
    expect(before?.get("used")).toBe(6);
    expect(Object.keys(before!.data).sort()).toEqual(["id", "used"]);

    const rows = await harness.query<{ used: number }>(`SELECT used FROM "${QUOTAS}" WHERE id = 1`);
    expect(rows.rows[0].used).toBe(7);
  });

  it("returnDocument before combined with upsert throws the named error", async () => {
    await expectUnsupported(
      Quota.findOneAndUpdate(
        { id: 1 },
        { $inc: { used: 1 } },
        { upsert: true, returnDocument: "before" },
      ),
      "returnDocument: before with upsert",
    );
  });

  it("pipeline updates throw the named error", async () => {
    await expectUnsupported(Quota.atomic({ id: 1 }, [{ $set: { used: 1 } }]), "pipeline update");
  });

  it("arrayFilters throw the named error", async () => {
    await expectUnsupported(
      Quota.atomic({ id: 1 }, { $set: { used: 1 } }, { arrayFilters: [{ "x.a": 1 }] }),
      "arrayFilters",
    );
  });

  it("array operators and unknown operators are never silently ignored", async () => {
    await expectUnsupported(Quota.atomic({ id: 1 }, { $addToSet: { tags: "a" } }), "$addToSet");
    await expectUnsupported(Quota.atomic({ id: 1 }, { $push: { tags: "a" } }), "$push");
    await expectUnsupported(Quota.atomic({ id: 1 }, { $pull: { tags: "a" } }), "$pull");
    await expectUnsupported(
      Quota.atomic({ id: 1 }, { $rename: { used: "u" } } as never),
      "$rename",
    );
  });

  it("50 parallel atomic reservations against a limit of 10 — exactly 10 succeed", async () => {
    await harness.query(`INSERT INTO "${QUOTAS}" (id, used) VALUES (1, 0)`);

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        Quota.atomic({ id: 1, used: { $lt: 10 } }, { $inc: { used: 1 } }, { trustedFilter: true }),
      ),
    );

    expect(results.filter((affected) => affected === 1)).toHaveLength(10);

    const rows = await harness.query<{ used: number }>(`SELECT used FROM "${QUOTAS}" WHERE id = 1`);
    expect(rows.rows[0].used).toBe(10);
  });

  it("50 parallel findOneAndUpdate reservations — exactly 10 rows returned", async () => {
    await harness.query(`INSERT INTO "${QUOTAS}" (id, used) VALUES (2, 0)`);

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        Quota.findOneAndUpdate(
          { id: 2, used: { $lt: 10 } },
          { $inc: { used: 1 } },
          { trustedFilter: true },
        ),
      ),
    );

    const granted = results.filter((quota) => quota !== null);
    expect(granted).toHaveLength(10);
    expect(granted.map((quota) => quota!.get("used")).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);

    const rows = await harness.query<{ used: number }>(`SELECT used FROM "${QUOTAS}" WHERE id = 2`);
    expect(rows.rows[0].used).toBe(10);
  });

  it("50 parallel upserts on one new key produce one row counted to 50", async () => {
    await Promise.all(
      Array.from({ length: 50 }, () =>
        Counter.findOneAndUpdate({ key: "hits" }, { $inc: { count: 1 } }, { upsert: true }),
      ),
    );

    const rows = await harness.query<{ count: number }>(`SELECT count FROM "${COUNTERS}"`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].count).toBe(50);
  });
});
