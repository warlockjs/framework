import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedLeanOperationError } from "../../../src/errors/unsupported-lean-operation.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Lean read mode against a REAL Postgres: plain rows, no hydration, hidden
 * columns stripped, the rest of the builder unchanged.
 *
 * Touches only `local_lean_*` tables. Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const MEMBERS = "local_lean_members";

type MemberSchema = {
  id: number;
  name: string;
  age: number;
  password: string;
  joined_at: string;
};

class Member extends Model<MemberSchema> {
  public static table = MEMBERS;
  public static hidden = ["password"];
}

suite("Postgres lean read mode", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
    await harness.dropTables(MEMBERS);
    await harness.query(
      `CREATE TABLE "${MEMBERS}" (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, password TEXT, joined_at TEXT)`,
    );
  });

  afterAll(async () => {
    await harness.dropTables(MEMBERS);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.query(`TRUNCATE "${MEMBERS}"`);
    await harness.query(
      `INSERT INTO "${MEMBERS}" VALUES
        (1, 'Alice', 30, 'h1', '2024-01-01T00:00:00.000Z'),
        (2, 'Bob', 41, 'h2', '2024-02-01T00:00:00.000Z'),
        (3, 'Carol', 25, 'h3', '2024-03-01T00:00:00.000Z')`,
    );
  });

  it("returns plain rows with hidden columns stripped and no casting", async () => {
    const rows = await Member.query().lean().orderBy("id").get();

    expect(rows).toHaveLength(3);

    const [first] = rows;
    expect(first).not.toBeInstanceOf(Model);
    expect(first).not.toHaveProperty("password");
    expect(first?.name).toBe("Alice");
    expect(first?.joined_at).toBe("2024-01-01T00:00:00.000Z");

    // Control: the hydrated read casts the same column.
    const hydrated = await Member.query().orderBy("id").first();
    expect(hydrated?.get("joined_at")).toBeInstanceOf(Date);
  });

  it("where / select / orderBy / limit behave the same as a hydrated read", async () => {
    const rows = await Member.query()
      .where("age", ">", 26)
      .select(["id", "name", "password"])
      .orderBy("age", "desc")
      .limit(1)
      .lean()
      .get();

    expect(rows).toEqual([{ id: 2, name: "Bob" }]);
  });

  it("paginate() returns lean data with the correct total", async () => {
    const page = await Member.query().lean().orderBy("id").paginate({ page: 2, limit: 2 });

    expect(page.pagination.total).toBe(3);
    expect(page.data).toEqual([
      { id: 3, name: "Carol", age: 25, joined_at: "2024-03-01T00:00:00.000Z" },
    ]);
  });

  it("throws UnsupportedLeanOperationError for with()", async () => {
    await expect(Member.query().lean().with("posts").get()).rejects.toBeInstanceOf(
      UnsupportedLeanOperationError,
    );
  });
});
