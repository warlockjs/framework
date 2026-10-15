import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../src/drivers/postgres/postgres-query-builder";
import { UnsupportedLeanOperationError } from "../../../src/errors/unsupported-lean-operation.error";
import { Model } from "../../../src/model/model";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * `.lean()` read mode: plain objects straight from the driver, no Model
 * hydration and no driver deserialization — but `static hidden` fields are
 * still stripped, so a lean read can never leak a credential column.
 */

type LeanUserSchema = {
  id: number;
  name: string;
  password: string;
  createdAt: string;
};

class LeanUser extends Model<LeanUserSchema> {
  public static table = "lean_users";
  public static hidden = ["password"];
}

const ROWS = (): Record<string, unknown>[] => [
  { id: 1, name: "Alice", password: "hash-a", createdAt: "2024-01-01T00:00:00.000Z" },
  { id: 2, name: "Bob", password: "hash-b", createdAt: "2024-01-02T00:00:00.000Z" },
];

describe.each(["postgres", "mongodb"] as const)("lean read mode (%s builder)", (driverName) => {
  let rawRows: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const driver = createMockDriver({ name: driverName }) as unknown as Record<string, unknown>;
    const dataSource = new DataSource({
      name: "lean-test",
      driver: driver as never,
      isDefault: true,
    });

    rawRows = vi.fn(async () => ROWS());

    if (driverName === "postgres") {
      driver.dialect = new PostgresDialect();
      driver.query = vi.fn(async () => ({ rows: await rawRows(), rowCount: 2 }));
      driver.queryBuilder = (table: string) => new PostgresQueryBuilder(table, dataSource);
    } else {
      // On the prototype so clones (paginate/chunk) execute against it too.
      vi.spyOn(MongoQueryBuilder.prototype as never, "execute").mockImplementation(async function (
        this: { operations: unknown[] },
      ) {
        this.operations = [];
        return rawRows();
      } as never);
      driver.queryBuilder = (table: string) => new MongoQueryBuilder(table, dataSource);
    }

    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.restoreAllMocks();
  });

  it("hydrated reads (control) return Model instances with deserialized dates", async () => {
    const users = await LeanUser.query().get();

    expect(users[0]).toBeInstanceOf(LeanUser);
  });

  it("returns plain objects, not Model instances", async () => {
    const users = await LeanUser.query().lean().get();

    expect(users).toHaveLength(2);
    expect(users[0]).not.toBeInstanceOf(Model);
    expect(Object.getPrototypeOf(users[0])).toBe(Object.prototype);
    expect(users[0]?.name).toBe("Alice");
  });

  it("does not cast values (no driver deserialization)", async () => {
    const [user] = await LeanUser.query().lean().get();

    expect(user?.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("still strips static hidden fields", async () => {
    const users = await LeanUser.query().lean().get();

    for (const user of users) {
      expect(user).not.toHaveProperty("password");
    }
  });

  it("is chainable anywhere before execution and applies to first()", async () => {
    const user = await LeanUser.query().where("id", 1).lean().orderBy("id").first();

    expect(user).not.toBeInstanceOf(Model);
    expect(user).not.toHaveProperty("password");
  });

  it("survives clone() — paginate() returns lean data", async () => {
    const query = LeanUser.query().lean();
    vi.spyOn(query, "count").mockResolvedValue(2);

    const page = await query.paginate({ page: 1, limit: 10 });

    expect(page.data[0]).not.toBeInstanceOf(Model);
    expect(page.data[0]).not.toHaveProperty("password");
  });

  it("does not emit the model fetched event (listeners expect models)", async () => {
    const listener = vi.fn();
    const unsubscribe = LeanUser.events().on("fetched", listener);

    await LeanUser.query().lean().get();
    unsubscribe?.();

    expect(listener).not.toHaveBeenCalled();
  });

  it("throws UnsupportedLeanOperationError when eager-loading relations with with()", async () => {
    const error = await LeanUser.query()
      .lean()
      .with("posts")
      .get()
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(UnsupportedLeanOperationError);
    expect((error as UnsupportedLeanOperationError).operation).toBe("with");
    expect(rawRows).not.toHaveBeenCalled();
  });
});
