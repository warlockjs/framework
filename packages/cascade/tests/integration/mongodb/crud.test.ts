import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * End-to-end proof that a cascade `Model` performs the full CRUD cycle against a
 * REAL MongoDB server (via testcontainers): insert → read back → update →
 * delete, asserting each step both through the model API and directly against
 * the native collection.
 *
 * This is the FOUNDATION smoke test for the MongoDB harness, not exhaustive
 * coverage.
 */
const COLLECTION = "integration_users";

class User extends Model {
  public static table = COLLECTION;
}

describe("MongoDB integration — model CRUD", () => {
  let harness: MongodbHarness;

  beforeAll(async () => {
    harness = await startMongodbHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  // Fresh collection per test keeps state isolated.
  beforeEach(async () => {
    await harness.dropCollections(COLLECTION);
  });

  it("inserts a document and returns a model carrying a generated id", async () => {
    const user = await User.create({ name: "Alice", email: "alice@example.com", age: 30 });

    expect(typeof user.id).toBe("number");
    expect(user.get("name")).toBe("Alice");

    const stored = await harness.db.collection(COLLECTION).findOne({ id: user.id });

    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      name: "Alice",
      email: "alice@example.com",
      age: 30,
    });
  });

  it("reads a document back through the model query API", async () => {
    await User.create({ name: "Bob", email: "bob@example.com", age: 41 });

    const found = await User.first({ email: "bob@example.com" });

    expect(found).not.toBeNull();
    expect(found!.get("name")).toBe("Bob");
    expect(found!.get("age")).toBe(41);

    const byId = await User.find(found!.id);

    expect(byId).not.toBeNull();
    expect(byId!.get("email")).toBe("bob@example.com");
  });

  it("updates a document and persists the change", async () => {
    const user = await User.create({ name: "Carol", email: "carol@example.com", age: 25 });

    user.set("age", 26);
    await user.save();

    const refreshed = await User.find(user.id);

    expect(refreshed!.get("age")).toBe(26);
    expect(refreshed!.get("name")).toBe("Carol");

    const stored = await harness.db.collection<{ age: number }>(COLLECTION).findOne({ id: user.id });

    expect(stored!.age).toBe(26);
  });

  it("permanently deletes a document from the collection", async () => {
    const user = await User.create({ name: "Dave", email: "dave@example.com", age: 50 });

    const result = await user.destroy({ strategy: "permanent" });

    expect(result.success).toBe(true);

    const found = await User.find(user.id);

    expect(found).toBeNull();

    const count = await harness.db.collection(COLLECTION).countDocuments();

    expect(count).toBe(0);
  });
});
