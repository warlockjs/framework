import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../../src/drivers/mongodb/mongodb-query-builder";
import { resolveMongoLikePattern } from "../../../../src/drivers/mongodb/mongodb-query-parser";
import { UnsafeFilterError } from "../../../../src/errors/unsafe-filter.error";
import { UnsupportedQueryOperationError } from "../../../../src/errors/unsupported-query-operation.error";
import { createMockDriver } from "../../../helpers/mock-driver";

/**
 * MongoDB filter hardening: LIKE patterns with linear cost, no filter dropped
 * from the pipeline, operator-position values and field names refused,
 * integer page sizes, and the count/chunk pipelines.
 */
describe("MongoDB filter hardening", () => {
  let dataSource: DataSource;
  let driver: Record<string, unknown>;

  beforeEach(() => {
    driver = createMockDriver("mongodb") as unknown as Record<string, unknown>;
    driver.database = { collection: (name: string) => ({ collectionName: name }) };

    dataSource = new DataSource({ name: "test", driver: driver as never, isDefault: true });
    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.restoreAllMocks();
  });

  function builder(table = "users"): MongoQueryBuilder<any> {
    return new MongoQueryBuilder(table, dataSource);
  }

  function pipelineOf(query: MongoQueryBuilder<any>): any[] {
    return query.parse().pipeline as any[];
  }

  describe("LIKE patterns", () => {
    it("refuses a pattern with more than two % wildcards", () => {
      expect(() => pipelineOf(builder().whereLike("name", "%a%a%a%b"))).toThrow(UnsafeFilterError);
      expect(() => pipelineOf(builder().where("name", "like", "%a%a%a%b"))).toThrow(
        UnsafeFilterError,
      );
      expect(() => pipelineOf(builder().whereNotLike("name", "%a%b%c%"))).toThrow(
        UnsafeFilterError,
      );
    });

    it("keeps %term%, prefix% and %suffix searches working", () => {
      expect(pipelineOf(builder().whereLike("name", "%term%"))).toEqual([
        { $match: { name: { $regex: "term", $options: "i" } } },
      ]);
      expect(resolveMongoLikePattern("prefix%")).toBe("prefix");
      expect(resolveMongoLikePattern("%suffix")).toBe("suffix");
      expect(resolveMongoLikePattern("a%b")).toBe("a.*b");
    });

    it("counts a run of % as one wildcard", () => {
      expect(resolveMongoLikePattern("%%%a%%%")).toBe("a");
    });

    it("refuses a pattern over the length cap", () => {
      expect(() => resolveMongoLikePattern("a".repeat(257))).toThrow(UnsafeFilterError);
      expect(resolveMongoLikePattern("a".repeat(256))).toBe("a".repeat(256));
    });

    it("reads the caps from the data source's like driver option", () => {
      driver.likeLimits = { maxWildcards: 4, maxLength: 10 };

      expect(pipelineOf(builder().whereLike("name", "%a%b%c%"))).toEqual([
        { $match: { name: { $regex: "a.*b.*c", $options: "i" } } },
      ]);
      expect(() => pipelineOf(builder().whereLike("name", "abcdefghijk"))).toThrow(
        UnsafeFilterError,
      );
    });

    it("matches a numeric pattern as its text instead of crashing", () => {
      expect(pipelineOf(builder().whereLike("code", 123 as never))).toEqual([
        { $match: { code: { $regex: "123", $options: "i" } } },
      ]);
    });

    it("refuses an object pattern", () => {
      expect(() => pipelineOf(builder().whereLike("name", { $ne: null } as never))).toThrow(
        UnsafeFilterError,
      );
    });

    it("leaves an explicit RegExp uncapped", () => {
      expect(pipelineOf(builder().whereLike("name", /a.*b.*c.*d/))).toEqual([
        { $match: { name: { $regex: "a.*b.*c.*d", $options: "i" } } },
      ]);
    });
  });

  describe("filters are never dropped from the pipeline", () => {
    const start = new Date("2024-05-01T10:00:00.000Z");
    const end = new Date("2024-05-03T10:00:00.000Z");

    it("whereDateBetween / whereDateNotBetween cover whole days", () => {
      const bounds = {
        $gte: new Date("2024-05-01T00:00:00.000Z"),
        $lte: new Date("2024-05-03T23:59:59.999Z"),
      };

      expect(pipelineOf(builder().whereDateBetween("createdAt", [start, end]))).toEqual([
        { $match: { createdAt: bounds } },
      ]);
      expect(pipelineOf(builder().whereDateNotBetween("createdAt", [start, end]))).toEqual([
        { $match: { createdAt: { $not: bounds } } },
      ]);
    });

    it("whereArrayNotContains / whereArrayNotHaveOrEmpty exclude the value", () => {
      expect(pipelineOf(builder().whereArrayNotContains("blocked", 7))).toEqual([
        { $match: { blocked: { $ne: 7 } } },
      ]);
      expect(pipelineOf(builder().whereArrayNotContains("roles", "admin", "name"))).toEqual([
        { $match: { roles: { $not: { $elemMatch: { name: "admin" } } } } },
      ]);
      expect(pipelineOf(builder().whereArrayNotHaveOrEmpty("blocked", 7))).toEqual([
        { $match: { blocked: { $ne: 7 } } },
      ]);
    });

    it("whereArrayHasOrEmpty matches the value, an empty array or a missing field", () => {
      expect(pipelineOf(builder().whereArrayHasOrEmpty("perms", "admin"))).toEqual([
        {
          $match: {
            $or: [{ perms: "admin" }, { perms: { $size: 0 } }, { perms: null }],
          },
        },
      ]);
    });

    it("having() filters the grouped rows after the $group", () => {
      const pipeline = pipelineOf(builder().groupBy("userId").having("count", ">", 5));

      expect(pipeline[0]).toHaveProperty("$group");
      expect(pipeline.at(-1)).toEqual({ $match: { count: { $gt: 5 } } });
    });

    it("having(condition) and havingRaw() reach the pipeline", () => {
      expect(pipelineOf(builder().groupBy("userId").having({ total: 3 })).at(-1)).toEqual({
        $match: { total: 3 },
      });
      expect(
        pipelineOf(
          builder()
            .groupBy("userId")
            .having(["total", ">=", 3] as never),
        ).at(-1),
      ).toEqual({ $match: { total: { $gte: 3 } } });
      expect(
        pipelineOf(
          builder()
            .groupBy("userId")
            .havingRaw({ $expr: { $gt: ["$total", 3] } }),
        ).at(-1),
      ).toEqual({ $match: { $expr: { $gt: ["$total", 3] } } });
    });

    it.each([
      ["has", (q: MongoQueryBuilder<any>) => q.has("posts")],
      ["whereHas", (q: MongoQueryBuilder<any>) => q.whereHas("posts", () => undefined)],
      ["orWhereHas", (q: MongoQueryBuilder<any>) => q.orWhereHas("posts", () => undefined)],
      ["doesntHave", (q: MongoQueryBuilder<any>) => q.doesntHave("posts")],
      [
        "whereDoesntHave",
        (q: MongoQueryBuilder<any>) => q.whereDoesntHave("posts", () => undefined),
      ],
    ])("%s is refused instead of dropped", (_name, apply) => {
      expect(() => pipelineOf(apply(builder().where("tenantId", 1)))).toThrow(
        UnsupportedQueryOperationError,
      );
    });

    it("an unknown filter operation throws", () => {
      const query = builder();
      query.operations.push({ stage: "$match", mergeable: true, type: "whereBogus", data: {} });

      expect(() => pipelineOf(query)).toThrow(UnsupportedQueryOperationError);
    });

    it("an operation with no known stage throws", () => {
      const query = builder();
      query.operations.push({ stage: undefined as never, mergeable: false, type: "x", data: {} });

      expect(() => pipelineOf(query)).toThrow(UnsupportedQueryOperationError);
    });

    it("delete() with whereHas never reaches the driver", async () => {
      await expect(
        builder()
          .whereHas("thread", () => undefined)
          .delete(),
      ).rejects.toThrow(UnsupportedQueryOperationError);
      expect(driver.deleteMany).not.toHaveBeenCalled();
    });

    it("a write refuses a grouped having filter instead of dropping the group", async () => {
      await expect(builder().groupBy("userId").having("count", ">", 5).delete()).rejects.toThrow(
        UnsupportedQueryOperationError,
      );
      expect(driver.deleteMany).not.toHaveBeenCalled();
    });

    it("a write refuses an inner join it cannot apply", async () => {
      await expect(
        builder().innerJoin("posts", "id", "userId").update({ active: false }),
      ).rejects.toThrow(UnsupportedQueryOperationError);
      expect(driver.updateMany).not.toHaveBeenCalled();
    });

    it("a plain filtered write still goes through", async () => {
      await builder().where("status", "old").delete();

      expect(driver.deleteMany).toHaveBeenCalledWith("users", { status: "old" });
    });
  });

  describe("operator-position values and field names", () => {
    it.each([
      [
        "whereArrayContains",
        (q: MongoQueryBuilder<any>) => q.whereArrayContains("tags", { $ne: null }),
      ],
      [
        "whereArrayNotContains",
        (q: MongoQueryBuilder<any>) => q.whereArrayNotContains("tags", { $ne: null }),
      ],
      [
        "whereArrayHasOrEmpty",
        (q: MongoQueryBuilder<any>) => q.whereArrayHasOrEmpty("tags", { $ne: null }),
      ],
      [
        "whereArrayNotHaveOrEmpty",
        (q: MongoQueryBuilder<any>) => q.whereArrayNotHaveOrEmpty("tags", { $ne: null }),
      ],
      [
        "whereJsonContains",
        (q: MongoQueryBuilder<any>) => q.whereJsonContains("meta", { $gt: "" }),
      ],
      [
        "whereJsonDoesntContain",
        (q: MongoQueryBuilder<any>) => q.whereJsonDoesntContain("meta", { $gt: "" }),
      ],
      ["textSearch", (q: MongoQueryBuilder<any>) => q.textSearch("x", { owner: { $ne: null } })],
    ])("%s refuses a $-operator value", (_name, apply) => {
      expect(() => apply(builder())).toThrow(UnsafeFilterError);
    });

    it.each([
      [
        "whereDay",
        (q: MongoQueryBuilder<any>) => q.whereDay("at", { $dayOfMonth: "$at" } as never),
      ],
      ["whereMonth", (q: MongoQueryBuilder<any>) => q.whereMonth("at", "5" as never)],
      [
        "whereYear",
        (q: MongoQueryBuilder<any>) =>
          q.whereYear("at", { $function: { body: "x", args: [], lang: "js" } } as never),
      ],
      ["whereJsonLength", (q: MongoQueryBuilder<any>) => q.whereJsonLength("m", ">", {} as never)],
      ["whereArrayLength", (q: MongoQueryBuilder<any>) => q.whereArrayLength("m", ">", NaN)],
      ["whereSize", (q: MongoQueryBuilder<any>) => q.whereSize("m", ">", { $gt: 1 } as never)],
      ["whereTime", (q: MongoQueryBuilder<any>) => q.whereTime("at", { $literal: 1 } as never)],
    ])("%s refuses anything but a primitive of its type", (_name, apply) => {
      expect(() => apply(builder())).toThrow(UnsafeFilterError);
    });

    it("primitives still build the same pipeline", () => {
      expect(pipelineOf(builder().whereArrayContains("tags", "x"))).toEqual([
        { $match: { tags: "x" } },
      ]);
      expect(pipelineOf(builder().whereDay("at", 5))).toEqual([
        { $match: { $expr: { $eq: [{ $dayOfMonth: "$at" }, 5] } } },
      ]);
      expect(pipelineOf(builder().whereTime("at", "14:30"))).toEqual([
        {
          $match: {
            $expr: { $eq: [{ $dateToString: { format: "%H:%M", date: "$at" } }, "14:30"] },
          },
        },
      ]);
    });

    it("refuses a $-prefixed field name", () => {
      expect(() => builder().where("$where", "1")).toThrow(UnsafeFilterError);
      expect(() => builder().where("$or", "=", [{ role: "admin" }])).toThrow(UnsafeFilterError);
      expect(() => builder().where("a.$b", 1)).toThrow(UnsafeFilterError);
      expect(() => pipelineOf(builder().whereIn("$or", []))).toThrow(UnsafeFilterError);
      expect(() => pipelineOf(builder().whereNotNull("$where"))).toThrow(UnsafeFilterError);
    });

    it("keeps dotted field paths working", () => {
      expect(pipelineOf(builder().where("profile.name", "Ann"))).toEqual([
        { $match: { "profile.name": "Ann" } },
      ]);
    });
  });

  describe("limit / skip / paginate", () => {
    it("refuses a non-integer limit or skip", () => {
      expect(() => builder().limit("abc" as never)).toThrow(/whole number/);
      expect(() => builder().skip(-1)).toThrow(/whole number/);
      expect(() => builder().limit(1.5)).toThrow(/whole number/);
    });

    it("accepts a digit string", () => {
      expect(pipelineOf(builder().limit("10" as never))).toEqual([{ $limit: 10 }]);
    });

    it("caps paginate()'s page size at maxLimit (default 1000)", async () => {
      const get = vi.spyOn(MongoQueryBuilder.prototype, "get").mockResolvedValue([]);
      vi.spyOn(MongoQueryBuilder.prototype, "count").mockResolvedValue(0);

      const result = await builder().paginate({ limit: 1e7 });

      expect(result.pagination.limit).toBe(1000);
      const pageQuery = get.mock.contexts[0] as MongoQueryBuilder<any>;
      expect(pipelineOf(pageQuery)).toEqual([{ $skip: 0 }, { $limit: 1000 }]);

      const raised = await builder().paginate({ limit: 5000, maxLimit: 10_000 });
      expect(raised.pagination.limit).toBe(5000);
    });

    it("refuses a paginate() limit or page that is not a number", async () => {
      await expect(builder().paginate({ limit: "abc" as never })).rejects.toThrow(/whole number/);
      await expect(builder().paginate({ page: 0 })).rejects.toThrow(/whole number/);
      // A typed refusal, so an HTTP layer can answer 400 instead of 500.
      await expect(builder().paginate({ page: "x" as never })).rejects.toBeInstanceOf(
        UnsafeFilterError,
      );
    });

    it("caps cursorPaginate()'s page size", async () => {
      const get = vi.spyOn(MongoQueryBuilder.prototype, "get").mockResolvedValue([]);

      await builder().cursorPaginate({ limit: 1e7 });

      const pageQuery = get.mock.contexts[0] as MongoQueryBuilder<any>;
      expect(pipelineOf(pageQuery).at(-1)).toEqual({ $limit: 1001 });
    });
  });

  describe("count()", () => {
    function countPipeline(query: MongoQueryBuilder<any>): Promise<any[]> {
      const execute = vi
        .spyOn(MongoQueryBuilder.prototype as any, "execute")
        .mockResolvedValue([{ total: 3 }]);

      return query.count().then((total) => {
        expect(total).toBe(3);
        return execute.mock.calls[0]?.[0] as any[];
      });
    }

    it("drops the sort and the projection", async () => {
      const pipeline = await countPipeline(
        builder().where("status", "active").orderBy("createdAt", "desc").select(["name"]),
      );

      expect(pipeline).toEqual([{ $match: { status: "active" } }, { $count: "total" }]);
    });

    it("drops a left join nothing reads", async () => {
      const pipeline = await countPipeline(builder().join("posts", "id", "userId"));

      expect(pipeline).toEqual([{ $count: "total" }]);
    });

    it("keeps grouping, inner joins, limits and random samples", async () => {
      expect(await countPipeline(builder().groupBy("userId"))).toContainEqual(
        expect.objectContaining({ $group: expect.anything() }),
      );
      vi.restoreAllMocks();
      expect(await countPipeline(builder().innerJoin("posts", "id", "userId"))).toContainEqual(
        expect.objectContaining({ $lookup: expect.anything() }),
      );
      vi.restoreAllMocks();
      expect(await countPipeline(builder().orderBy("a").limit(5))).toEqual([
        { $limit: 5 },
        { $count: "total" },
      ]);
      vi.restoreAllMocks();
      expect(await countPipeline(builder().orderByRandom(3))).toContainEqual({
        $sample: { size: 3 },
      });
    });

    it("keeps a projection a later filter reads", async () => {
      const pipeline = await countPipeline(
        builder()
          .selectRaw({ score: { $add: ["$a", "$b"] } })
          .limit(50)
          .where("score", ">", 3),
      );

      expect(pipeline.some((stage) => stage.$project)).toBe(true);
    });
  });

  describe("chunk()", () => {
    function recordPages(rows: Array<Record<string, unknown>[]>) {
      const pages: any[][] = [];
      let call = 0;

      vi.spyOn(MongoQueryBuilder.prototype, "get").mockImplementation(async function (
        this: MongoQueryBuilder<any>,
      ) {
        pages.push(pipelineOf(this));
        return (rows[call++] ?? []) as never;
      });

      return pages;
    }

    it("pages an unordered query by _id instead of skip", async () => {
      const pages = recordPages([[{ _id: 1 }, { _id: 2 }], [{ _id: 3 }]]);
      const seen: unknown[] = [];

      await builder()
        .where("active", true)
        .chunk(2, (rows) => {
          seen.push(...rows.map((row: any) => row._id));
        });

      expect(seen).toEqual([1, 2, 3]);
      expect(pages).toEqual([
        [{ $match: { active: true } }, { $sort: { _id: 1 } }, { $limit: 2 }],
        [{ $match: { active: true, _id: { $gt: 2 } } }, { $sort: { _id: 1 } }, { $limit: 2 }],
      ]);
      expect(JSON.stringify(pages)).not.toContain("$skip");
    });

    it("follows a primary-key order in its direction", async () => {
      const pages = recordPages([[{ id: 9 }, { id: 8 }], []]);
      const query = builder().orderBy("id", "desc");
      query.modelClass = { primaryKey: "id" };

      await query.chunk(2, () => undefined);

      expect(pages[1]).toEqual([
        { $match: { id: { $lt: 8 } } },
        { $sort: { id: -1 } },
        { $limit: 2 },
      ]);
    });

    it("keeps skip paging for any other order", async () => {
      const pages = recordPages([[{ _id: 1 }, { _id: 2 }], []]);

      await builder()
        .orderBy("name")
        .chunk(2, () => undefined);

      expect(pages[1]).toEqual([{ $sort: { name: 1 } }, { $skip: 2 }, { $limit: 2 }]);
    });

    it("keeps skip paging after a top-level orWhere", async () => {
      const pages = recordPages([[{ _id: 1 }], []]);

      await builder()
        .where("a", 1)
        .orWhere("b", 2)
        .chunk(5, () => undefined);

      expect(JSON.stringify(pages[0])).toContain("$skip");
    });

    it("stops when the callback returns false", async () => {
      recordPages([
        [{ _id: 1 }, { _id: 2 }],
        [{ _id: 3 }, { _id: 4 }],
      ]);
      const callback = vi.fn().mockReturnValue(false);

      await builder().chunk(2, callback);

      expect(callback).toHaveBeenCalledOnce();
    });
  });
});
