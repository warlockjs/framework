import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseWriterValidationError } from "../../../src/validation";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class User extends Model {
  static table = "users";
  static autoGenerateId = false;
  static schema = v.object({ email: v.string(), name: v.string() });
}

const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
  code: "23505",
  detail: "Key (email)=(a@b.c) already exists.",
});

const mongoError = Object.assign(new Error("E11000 duplicate key error"), {
  code: 11000,
  keyPattern: { email: 1 },
});

const mongoMessageOnly = Object.assign(
  new Error("E11000 duplicate key error collection: db.users index: email_1 dup key"),
  { code: 11000 },
);

describe("unique violation from the driver becomes a field validation error", () => {
  const driver = createMockDriver();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(User, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
  });

  const insertModel = () => {
    const model = new User({ id: 1, email: "a@b.c", name: "n" });
    model.isNew = true;
    return model;
  };

  const updateModel = () => {
    const model = new User({ id: 1, email: "a@b.c", name: "n" });
    model.isNew = false;
    model.dirtyTracker.reset();
    model.set("email", "x@y.z");
    return model;
  };

  it.each([
    ["postgres 23505 (detail)", pgError],
    ["mongo 11000 (keyPattern)", mongoError],
    ["mongo 11000 (message index name)", mongoMessageOnly],
  ])("insert: %s maps to an `email` error", async (_label, error) => {
    (driver.insert as any).mockRejectedValueOnce(error);

    const failure = await new DatabaseWriter(insertModel()).save().catch((e) => e);

    expect(failure).toBeInstanceOf(DatabaseWriterValidationError);
    expect(failure.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatchObject({ type: "unique", input: "email" });
  });

  it("update: a violation maps to an `email` error", async () => {
    (driver.update as any).mockRejectedValueOnce(pgError);

    const failure = await new DatabaseWriter(updateModel()).save().catch((e) => e);

    expect(failure).toBeInstanceOf(DatabaseWriterValidationError);
    expect(failure.errors[0]).toMatchObject({ type: "unique", input: "email" });
  });

  it("accepts the mongo code as a string", async () => {
    (driver.insert as any).mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "11000", keyPattern: { email: 1 } }),
    );

    const failure = await new DatabaseWriter(insertModel()).save().catch((e) => e);

    expect(failure).toBeInstanceOf(DatabaseWriterValidationError);
  });

  it("leaves unrelated driver errors untouched", async () => {
    const boom = Object.assign(new Error("connection lost"), { code: "08006" });
    (driver.insert as any).mockRejectedValueOnce(boom);

    await expect(new DatabaseWriter(insertModel()).save()).rejects.toBe(boom);
  });
});
