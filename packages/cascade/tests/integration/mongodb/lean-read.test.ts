import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedLeanOperationError } from "../../../src/errors/unsupported-lean-operation.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Lean read mode against a REAL mongod: plain documents, no hydration, hidden
 * fields stripped, the rest of the builder unchanged.
 *
 * Skipped when LOCAL_MONGO_URI / LOCAL_MONGO_DATABASE are not configured.
 */

const suite = hasLocalMongodb() ? describe : describe.skip;

const MEMBERS = "lean_members";

type MemberSchema = {
  id: number;
  name: string;
  age: number;
  password: string;
  joinedAt: string;
};

class Member extends Model<MemberSchema> {
  public static table = MEMBERS;
  public static hidden = ["password"];
}

suite("MongoDB lean read mode", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
  });

  afterAll(async () => {
    await harness.dropCollections(MEMBERS);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropCollections(MEMBERS);
    await harness.db.collection(MEMBERS).insertMany([
      { id: 1, name: "Alice", age: 30, password: "h1", joinedAt: "2024-01-01T00:00:00.000Z" },
      { id: 2, name: "Bob", age: 41, password: "h2", joinedAt: "2024-02-01T00:00:00.000Z" },
      { id: 3, name: "Carol", age: 25, password: "h3", joinedAt: "2024-03-01T00:00:00.000Z" },
    ]);
  });

  it("returns plain documents with hidden fields stripped and no casting", async () => {
    const rows = await Member.query().lean().orderBy("id").get();

    expect(rows).toHaveLength(3);

    const [first] = rows;
    expect(first).not.toBeInstanceOf(Model);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(first).not.toHaveProperty("password");
    expect(first?.name).toBe("Alice");
    // A date-shaped string stays a string: no driver deserialization in lean mode.
    expect(first?.joinedAt).toBe("2024-01-01T00:00:00.000Z");
    expect((first as { _id?: unknown })._id).toBeInstanceOf(ObjectId);

    // Control: the hydrated read casts the same field.
    const hydrated = await Member.query().orderBy("id").first();
    expect(hydrated?.get("joinedAt")).toBeInstanceOf(Date);
  });

  it("where / select / orderBy / limit behave the same as a hydrated read", async () => {
    const rows = await Member.query()
      .where("age", ">", 26)
      // The sort key is selected: the Mongo builder emits $project before
      // $sort, so sorting on an unselected field is a no-op (hydrated too).
      .select(["id", "name", "age", "password"])
      .orderBy("age", "desc")
      .limit(1)
      .lean()
      .get();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Bob");
    expect(rows[0]).not.toHaveProperty("password");
    expect(rows[0]).not.toHaveProperty("joinedAt");
  });

  it("paginate() returns lean data with the correct total", async () => {
    const page = await Member.query().lean().orderBy("id").paginate({ page: 2, limit: 2 });

    expect(page.pagination.total).toBe(3);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).not.toBeInstanceOf(Model);
    expect(page.data[0]?.name).toBe("Carol");
    expect(page.data[0]).not.toHaveProperty("password");
  });

  it("throws UnsupportedLeanOperationError for with()", async () => {
    await expect(Member.query().lean().with("posts").get()).rejects.toBeInstanceOf(
      UnsupportedLeanOperationError,
    );
  });
});
