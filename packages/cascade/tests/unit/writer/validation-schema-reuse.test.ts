import { ObjectValidator, v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "../../../src/model/model";
import type { StrictMode } from "../../../src/types";
import { DatabaseWriterValidationError } from "../../../src/validation";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

function modelClass(strictMode: StrictMode) {
  return class Post extends Model {
    public static table = "posts";
    public static autoGenerateId = false;
    public static schema = v.object({ title: v.string(), meta: v.object({ a: v.string() }) });
    public static strictMode = strictMode;
  };
}

describe("writer validation schema", () => {
  const driver = createMockDriver();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function bind<T extends typeof Model>(ModelClass: T): T {
    vi.spyOn(ModelClass, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
    return ModelClass;
  }

  it("builds the schema on the first save only", async () => {
    const Post = bind(modelClass("strip"));

    await new DatabaseWriter(new Post({ title: "a", meta: { a: "x" } })).save();

    const clone = vi.spyOn(ObjectValidator.prototype, "clone");

    try {
      await new DatabaseWriter(new Post({ title: "b", meta: { a: "y" } })).save();

      expect(clone).not.toHaveBeenCalled();
    } finally {
      clone.mockRestore();
    }
  });

  it("rebuilds the schema when the model's schema is replaced", async () => {
    const Post = bind(modelClass("fail"));

    await new DatabaseWriter(new Post({ title: "a", meta: { a: "x" } })).save();

    Post.schema = v.object({
      title: v.string(),
      meta: v.object({ a: v.string() }),
      extra: v.string(),
    });

    await expect(
      new DatabaseWriter(new Post({ title: "b", meta: { a: "y" }, extra: "z" })).save(),
    ).resolves.toMatchObject({ success: true });
  });

  it("strips an unknown top-level column on insert (strip)", async () => {
    const Post = bind(modelClass("strip"));
    const post = new Post({ title: "a", meta: { a: "x" }, isAdmin: true });

    await new DatabaseWriter(post).save();

    const inserted = (driver.insert as any).mock.calls.at(-1)[1];

    expect(inserted).not.toHaveProperty("isAdmin");
    expect(post.get("isAdmin")).toBeUndefined();
  });

  it("rejects an unknown top-level column on insert (fail)", async () => {
    const Post = bind(modelClass("fail"));

    await expect(
      new DatabaseWriter(new Post({ title: "a", meta: { a: "x" }, isAdmin: true })).save(),
    ).rejects.toBeInstanceOf(DatabaseWriterValidationError);
  });

  it("keeps an unknown top-level column on insert (allow)", async () => {
    const Post = bind(modelClass("allow"));

    await new DatabaseWriter(new Post({ title: "a", meta: { a: "x" }, source: "import" })).save();

    expect((driver.insert as any).mock.calls.at(-1)[1]).toMatchObject({ source: "import" });
  });

  it("validates concurrent inserts independently", async () => {
    const Post = bind(modelClass("fail"));

    const results = await Promise.allSettled([
      new DatabaseWriter(new Post({ title: "a", meta: { a: "x" } })).save(),
      new DatabaseWriter(new Post({ title: 5 as unknown as string, meta: { a: "x" } })).save(),
      new DatabaseWriter(new Post({ title: "c", meta: { a: "z" } })).save(),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
