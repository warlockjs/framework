import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseWriterValidationError } from "../../../src/validation";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Live checks for a bounded `update()` and compound unique violations on a
 * real mongod. Touches only the `live565_*` collections.
 * Skipped when LOCAL_MONGO_URI / LOCAL_MONGO_DATABASE are not configured.
 */

const suite = hasLocalMongodb() ? describe : describe.skip;

const TASKS = "live565_tasks";
const RECEIPTS = "live565_receipts";

class Task extends Model {
  public static table = TASKS;
}

class Receipt extends Model {
  public static table = RECEIPTS;
}

suite("MongoDB live: 5.65 bounded update and unique violations", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
  });

  beforeEach(async () => {
    await harness.dropCollections(TASKS, RECEIPTS);
    await harness.db.collection(TASKS).insertMany([
      { id: 1, rank: 3, status: "open" },
      { id: 2, rank: 1, status: "open" },
      { id: 3, rank: 2, status: "open" },
      { id: 4, rank: 4, status: "done" },
    ]);
    await harness.db
      .collection(RECEIPTS)
      .createIndex({ tenantId: 1, fileId: 1 }, { unique: true, name: "tenant_file" });
  });

  afterAll(async () => {
    await harness.dropCollections(TASKS, RECEIPTS);
    await harness.stop();
  });

  it("updates only the document limit(1) with orderBy selects", async () => {
    const changed = await Task.query()
      .where("status", "open")
      .orderBy("rank", "asc")
      .limit(1)
      .update({ status: "claimed" });

    expect(changed).toBe(1);
    const claimed = await harness.db.collection(TASKS).find({ status: "claimed" }).toArray();
    expect(claimed.map((doc) => doc.rank)).toEqual([1]);
  });

  it("honours skip with limit, and updates every match without a bound", async () => {
    expect(
      await Task.query().where("status", "open").orderBy("rank", "asc").skip(1).limit(2).update({
        status: "later",
      }),
    ).toBe(2);
    const later = await harness.db.collection(TASKS).find({ status: "later" }).toArray();
    expect(later.map((doc) => doc.rank).sort()).toEqual([2, 3]);

    expect(await Task.query().where("status", "open").update({ status: "all" })).toBe(1);
  });

  it("names every field of a compound unique index, with the index and cause", async () => {
    await Receipt.create({ tenantId: 1, fileId: 2 });

    const error = await Receipt.create({ tenantId: 1, fileId: 2 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DatabaseWriterValidationError);
    const validation = error as DatabaseWriterValidationError;
    expect(validation.columns).toEqual(["tenantId", "fileId"]);
    expect(validation.constraint).toBe("tenant_file");
    expect(validation.errors[0]!.input).toBe("tenantId, fileId");
    expect((validation.cause as { code?: number }).code).toBe(11000);
  });
});
