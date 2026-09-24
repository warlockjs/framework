import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../src/drivers/postgres/postgres-query-builder";
import { UnsupportedQueryOperationError } from "../../../src/errors/unsupported-query-operation.error";
import { createMockDriver } from "../../helpers/mock-driver";

/**
 * Public aggregation stages: `unwind()` / `addFields()` / pipeline-form `join()`
 * emit real MongoDB stages (they used to be dropped by the pipeline parser),
 * and the Postgres builder refuses Mongo-only stages with a named error.
 */

describe("MongoDB pipeline stages", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    const driver = createMockDriver("mongodb") as unknown as {
      database: { collection: (name: string) => unknown };
    };

    driver.database = { collection: (name: string) => ({ collectionName: name }) };
    dataSource = new DataSource({ name: "test", driver: driver as never, isDefault: true });
    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  const builder = (): MongoQueryBuilder => new MongoQueryBuilder("posts", dataSource);

  it("unwind(field) emits the short $unwind form", () => {
    expect(builder().unwind("tags").parse().pipeline).toEqual([{ $unwind: "$tags" }]);
  });

  it("unwind(field, options) emits the document form with only the given options", () => {
    expect(
      builder()
        .unwind("tags", { preserveNullAndEmptyArrays: true, includeArrayIndex: "tagIndex" })
        .parse().pipeline,
    ).toEqual([
      {
        $unwind: { path: "$tags", preserveNullAndEmptyArrays: true, includeArrayIndex: "tagIndex" },
      },
    ]);
  });

  it("keeps call order around unwind: a later where filters the unwound documents", () => {
    expect(
      builder().where("status", "published").unwind("tags").where("tags", "a").parse().pipeline,
    ).toEqual([
      { $match: { status: "published" } },
      { $unwind: "$tags" },
      { $match: { tags: "a" } },
    ]);
  });

  it("addFields(fields) emits $addFields", () => {
    expect(
      builder()
        .addFields({ score: { $add: ["$likes", "$shares"] } })
        .parse().pipeline,
    ).toEqual([{ $addFields: { score: { $add: ["$likes", "$shares"] } } }]);
  });

  it("join() with a pipeline emits a pipeline $lookup", () => {
    expect(
      builder()
        .join({ table: "comments", alias: "approved", pipeline: [{ $match: { approved: true } }] })
        .parse().pipeline,
    ).toEqual([
      { $lookup: { from: "comments", as: "approved", pipeline: [{ $match: { approved: true } }] } },
    ]);
  });

  it("similarTo() emits its $vectorSearch and score $addFields stages", () => {
    const pipeline = builder().limit(3).similarTo("embedding", [0.1, 0.2]).parse().pipeline;

    expect(pipeline).toContainEqual({
      $vectorSearch: {
        index: "embedding_vector_idx",
        path: "embedding",
        queryVector: [0.1, 0.2],
        numCandidates: 30,
        limit: 3,
      },
    });
    expect(pipeline).toContainEqual({ $addFields: { score: { $meta: "vectorSearchScore" } } });
  });

  it("joinRaw(stage | stages) emits the stages verbatim in call order", () => {
    const lookup = {
      $lookup: { from: "comments", localField: "id", foreignField: "postId", as: "c" },
    };

    expect(
      builder().where("id", 1).joinRaw(lookup).where("c.approved", true).parse().pipeline,
    ).toEqual([{ $match: { id: 1 } }, lookup, { $match: { "c.approved": true } }]);
    expect(
      builder()
        .joinRaw([lookup, { $unwind: "$c" }])
        .parse().pipeline,
    ).toEqual([lookup, { $unwind: "$c" }]);
  });

  it("joinRaw() rejects a SQL string or a non-stage object with a named error", () => {
    expect(() => builder().joinRaw("LEFT JOIN comments ON 1 = 1")).toThrow(
      UnsupportedQueryOperationError,
    );
    expect(() => builder().joinRaw({ from: "comments" })).toThrow(UnsupportedQueryOperationError);
    expect(() => builder().joinRaw([])).toThrow(UnsupportedQueryOperationError);
  });

  it("raw() receives the pipeline so far; a returned array replaces it, later stages append", () => {
    const pipeline = builder()
      .where("a", 1)
      .raw((stages) => [...(stages as object[]), { $sample: { size: 2 } }])
      .limit(5)
      .parse().pipeline;

    expect(pipeline).toEqual([{ $match: { a: 1 } }, { $sample: { size: 2 } }, { $limit: 5 }]);
  });

  it("raw() throws a named error when the callback returns a non-pipeline", () => {
    expect(() =>
      builder()
        .raw(() => ({ $match: {} }))
        .parse(),
    ).toThrow(UnsupportedQueryOperationError);
  });

  it("select() then orderBy(unselected) sorts before the projection", () => {
    expect(builder().select(["title"]).orderBy("likes", "desc").limit(2).parse().pipeline).toEqual([
      { $sort: { likes: -1 } },
      { $project: { title: 1 } },
      { $limit: 2 },
    ]);
  });

  it("orderBy(computed alias) keeps the projection first; mixed keys use $addFields", () => {
    const score = { $add: ["$likes", "$shares"] };

    expect(builder().selectRaw({ score }).orderBy("score").parse().pipeline).toEqual([
      { $project: { score } },
      { $sort: { score: 1 } },
    ]);
    expect(
      builder().select(["title"]).selectRaw({ score }).orderBy("score").orderBy("likes").parse()
        .pipeline,
    ).toEqual([
      { $addFields: { score } },
      { $sort: { score: 1, likes: 1 } },
      { $project: { title: 1, score: 1 } },
    ]);
  });
});

describe("Postgres refuses MongoDB-only stages", () => {
  let queryBuilder: PostgresQueryBuilder;

  beforeEach(() => {
    const driver = createMockDriver("postgres") as unknown as Record<string, unknown>;
    driver.dialect = new PostgresDialect();
    const dataSource = new DataSource({ name: "test", driver: driver as never, isDefault: true });
    dataSourceRegistry.register(dataSource);
    queryBuilder = new PostgresQueryBuilder("posts", dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
  });

  it.each([
    ["unwind", (q: PostgresQueryBuilder) => q.unwind("tags")],
    ["addFields", (q: PostgresQueryBuilder) => q.addFields({ score: 1 })],
  ] as const)("%s() throws UnsupportedQueryOperationError", (operation, call) => {
    let error: unknown;

    try {
      call(queryBuilder);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UnsupportedQueryOperationError);
    expect((error as UnsupportedQueryOperationError).operation).toBe(operation);
    expect((error as UnsupportedQueryOperationError).driver).toBe("postgres");
  });
});
