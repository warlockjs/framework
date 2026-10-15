import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import { startPostgresHarness, type PostgresHarness } from "../helpers";

/**
 * End-to-end proof that a cascade `Model` performs the full CRUD cycle against a
 * REAL Postgres server (via testcontainers): insert → read back → update →
 * delete, asserting each step both through the model API and with raw SQL
 * straight against the database.
 *
 * This is the FOUNDATION smoke test for the Postgres harness, not exhaustive
 * coverage.
 */
const TABLE = "integration_users";

class User extends Model {
  public static table = TABLE;
}

describe("Postgres integration — model CRUD", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgresHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  // Fresh table per test keeps state isolated and ids deterministic.
  beforeEach(async () => {
    await harness.dropTables(TABLE);
    await harness.query(`
      CREATE TABLE "${TABLE}" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
      )
    `);
  });

  it("inserts a row and returns a model carrying the DB-generated id", async () => {
    const user = await User.create({ name: "Alice", email: "alice@example.com", age: 30 });

    expect(user.id).toBe(1);
    expect(user.get("name")).toBe("Alice");

    const rows = await harness.query<{ id: number; name: string; email: string; age: number }>(
      `SELECT id, name, email, age FROM "${TABLE}"`,
    );

    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      id: 1,
      name: "Alice",
      email: "alice@example.com",
      age: 30,
    });
  });

  it("reads a row back through the model query API", async () => {
    await User.create({ name: "Bob", email: "bob@example.com", age: 41 });

    const found = await User.first({ email: "bob@example.com" });

    expect(found).not.toBeNull();
    expect(found!.get("name")).toBe("Bob");
    expect(found!.get("age")).toBe(41);

    const byId = await User.find(found!.id);

    expect(byId).not.toBeNull();
    expect(byId!.get("email")).toBe("bob@example.com");
  });

  it("updates a row and persists only the changed column", async () => {
    const user = await User.create({ name: "Carol", email: "carol@example.com", age: 25 });

    user.set("age", 26);
    await user.save();

    const refreshed = await User.find(user.id);

    expect(refreshed!.get("age")).toBe(26);
    expect(refreshed!.get("name")).toBe("Carol");

    const rows = await harness.query<{ age: number }>(
      `SELECT age FROM "${TABLE}" WHERE id = $1`,
      [user.id],
    );

    expect(rows.rows[0].age).toBe(26);
  });

  it("permanently deletes a row from the database", async () => {
    const user = await User.create({ name: "Dave", email: "dave@example.com", age: 50 });

    const result = await user.destroy({ strategy: "permanent" });

    expect(result.success).toBe(true);

    const found = await User.find(user.id);

    expect(found).toBeNull();

    const rows = await harness.query(`SELECT id FROM "${TABLE}"`);

    expect(rows.rowCount).toBe(0);
  });
});
