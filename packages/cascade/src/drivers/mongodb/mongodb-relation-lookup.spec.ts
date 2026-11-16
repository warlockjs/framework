import { describe, expect, it, vi } from "vitest";
import { UnsupportedQueryOperationError } from "../../errors/unsupported-query-operation.error";
import { MongoQueryBuilder } from "./mongodb-query-builder";

class Comment {
  public static table = "comments";
  public static primaryKey = "id";
  public static relations = {};
}

class Tag {
  public static table = "tags";
  public static primaryKey = "id";
  public static relations = {};
}

class Author {
  public static table = "authors";
  public static primaryKey = "id";
  public static relations = {};
}

class Post {
  public static table = "posts";
  public static primaryKey = "id";
  public static relations = {
    comments: { type: "hasMany", model: Comment, foreignKey: "postId", localKey: "id" },
    author: { type: "belongsTo", model: Author, foreignKey: "authorId", localKey: "id" },
    tags: {
      type: "belongsToMany",
      model: Tag,
      pivot: "post_tags",
      localKey: "postId",
      foreignKey: "tagId",
      pivotLocalKey: "id",
      pivotForeignKey: "id",
    },
  };
}

function postQuery() {
  const dataSource: any = {
    driver: { database: { collection: () => ({}) }, likeLimits: undefined },
    relationDefaults: undefined,
  };
  const builder = new MongoQueryBuilder<any>("posts", dataSource);

  builder.relationDefinitions = Post.relations;
  builder.modelClass = Post;

  return builder;
}

const pipelineOf = (builder: MongoQueryBuilder<any>) => (builder.parse() as any).pipeline as any[];

describe("MongoDB relation existence filters", () => {
  it("compiles has() on a hasMany relation to a lookup and an existence condition", () => {
    const pipeline = pipelineOf(postQuery().has("comments"));

    expect(pipeline[0].$lookup).toMatchObject({
      from: "comments",
      let: { key: "$id" },
      as: "__rel_0",
    });
    expect(pipeline[0].$lookup.pipeline[0].$match).toEqual({
      $expr: { $eq: ["$postId", "$$key"] },
    });
    expect(pipeline[1]).toEqual({ $match: { $expr: { $gt: [{ $size: "$__rel_0" }, 0] } } });
    expect(pipeline.at(-1)).toEqual({ $unset: ["__rel_0"] });
  });

  it("puts a whereHas() constraint inside the lookup", () => {
    const pipeline = pipelineOf(
      postQuery().whereHas("comments", (query) => {
        query.where("approved", true);
      }),
    );

    expect(pipeline[0].$lookup.pipeline[0].$match.$and).toEqual([
      { $expr: { $eq: ["$postId", "$$key"] } },
      { approved: true },
    ]);
  });

  it("compares the related count for has() with an operator", () => {
    const pipeline = pipelineOf(postQuery().has("comments", ">=", 3));

    expect(pipeline[0].$lookup.pipeline.at(-1)).toEqual({ $count: "n" });
    expect(pipeline[1].$match.$expr.$gte[1]).toBe(3);
  });

  it("rejects an unknown comparison operator", () => {
    expect(() => postQuery().has("comments", "; DROP", 2).parse()).toThrow(/operator/);
  });

  it("negates for doesntHave()", () => {
    const pipeline = pipelineOf(postQuery().doesntHave("comments"));

    expect(pipeline[1].$match.$expr).toEqual({ $eq: [{ $size: "$__rel_0" }, 0] });
  });

  it("joins an orWhereHas() to the same OR as the other conditions", () => {
    const pipeline = pipelineOf(
      postQuery()
        .where("status", "published")
        .orWhereHas("comments", (query) => {
          query.where("approved", true);
        }),
    );
    const match = pipeline.find((stage) => stage.$match).$match;

    expect(match.$or).toHaveLength(2);
    expect(JSON.stringify(match.$or)).toContain("__rel_0");
  });

  it("compiles belongsTo through the local foreign key", () => {
    const pipeline = pipelineOf(postQuery().has("author"));

    expect(pipeline[0].$lookup).toMatchObject({ from: "authors", let: { key: "$authorId" } });
    expect(pipeline[0].$lookup.pipeline[0].$match).toEqual({
      $expr: { $eq: ["$id", "$$key"] },
    });
  });

  it("compiles belongsToMany through the pivot, checking the related side only with a constraint", () => {
    const plain = pipelineOf(postQuery().has("tags"));

    expect(plain[0].$lookup.from).toBe("post_tags");
    expect(plain[0].$lookup.pipeline).toHaveLength(3);

    const constrained = pipelineOf(
      postQuery().whereHas("tags", (query) => {
        query.where("name", "news");
      }),
    );
    const inner = constrained[0].$lookup.pipeline;

    expect(inner[1].$lookup.from).toBe("tags");
    expect(inner[1].$lookup.pipeline[0].$match.$and[1]).toEqual({ name: "news" });
    expect(inner[2]).toEqual({ $match: { __related: { $ne: [] } } });
  });

  it("fails clearly for an unknown relation", () => {
    expect(() => postQuery().has("nothing").parse()).toThrow(/Relation "nothing" not found/);
  });

  it("refuses a relation filter in an update or delete", async () => {
    await expect(postQuery().has("comments").delete()).rejects.toBeInstanceOf(
      UnsupportedQueryOperationError,
    );
    await expect(
      postQuery()
        .whereHas("comments", () => {})
        .update({ a: 1 }),
    ).rejects.toThrow(/whereIn/);
  });

  it("refuses a relation filter nested in a constraint", () => {
    const query = postQuery().whereHas("comments", (sub) => {
      sub.has("replies");
    });

    expect(() => query.parse()).toThrow(UnsupportedQueryOperationError);
  });
});

describe("MongoDB withCount()", () => {
  it("adds the related count as a field, after the filters", () => {
    const pipeline = pipelineOf(postQuery().where("status", "published").withCount("comments"));
    const kinds = pipeline.map((stage) => Object.keys(stage)[0]);

    expect(kinds).toEqual(["$match", "$lookup", "$addFields", "$unset"]);
    expect(pipeline[1].$lookup.pipeline.at(-1)).toEqual({ $count: "n" });
    expect(pipeline[2].$addFields.commentsCount).toEqual({
      $ifNull: [{ $arrayElemAt: ["$__rel_0.n", 0] }, 0],
    });
  });

  it("honors an alias and a constraint", () => {
    const pipeline = pipelineOf(
      postQuery().withCount({
        "comments as approvedComments": (query: any) => query.where("approved", true),
      }),
    );

    expect(pipeline[0].$lookup.pipeline[0].$match.$and[1]).toEqual({ approved: true });
    expect(pipeline[1].$addFields).toHaveProperty("approvedComments");
  });

  it("counts before the filters when one reads the count field", () => {
    const pipeline = pipelineOf(postQuery().withCount("comments").where("commentsCount", ">", 2));

    expect(Object.keys(pipeline[0])[0]).toBe("$lookup");
    expect(Object.keys(pipeline[1])[0]).toBe("$addFields");
    expect(Object.keys(pipeline[2])[0]).toBe("$match");
  });

  it("keeps the counts on a clone", () => {
    const pipeline = pipelineOf(postQuery().withCount("comments").clone());

    expect(pipeline.some((stage) => stage.$addFields)).toBe(true);
  });
});

describe("MongoDB joinWith()", () => {
  it("loads the relations like with()", () => {
    const builder = postQuery().joinWith("comments", ["author"], { tags: "id,name" });

    expect([...builder.eagerLoadRelations.keys()]).toEqual(["comments", "author", "tags"]);
    expect(typeof builder.eagerLoadRelations.get("tags")).toBe("function");
  });

  it("applies a column shorthand as a select on the relation", () => {
    const select = vi.fn();
    const builder = postQuery().joinWith({ tags: "id, name" });

    (builder.eagerLoadRelations.get("tags") as (query: any) => void)({ select });

    expect(select).toHaveBeenCalledWith(["id", "name"]);
  });
});

describe("MongoDB cursorPaginate()", () => {
  it("reads cursor values of a model column through get()", async () => {
    const rows = [1, 2, 3].map((n) => ({
      get: (column: string) => (column === "createdAt" ? `2026-01-0${n}` : undefined),
    }));
    const builder = postQuery();

    vi.spyOn(builder, "get").mockResolvedValue(rows as any);

    const result = await builder.cursorPaginate({ limit: 2, column: "createdAt", cursor: "2025" });

    expect(result.pagination.nextCursor).toBe("2026-01-02");
    expect(result.pagination.prevCursor).toBe("2026-01-01");
  });
});
