import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { PostgresDriver } from "../../../../src/drivers/postgres/postgres-driver";
import { PostgresQueryBuilder } from "../../../../src/drivers/postgres/postgres-query-builder";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";
import { $agg } from "../../../../src/expressions";
import { createMockDriver } from "../../../helpers/mock-driver";

/**
 * PostgreSQL builder hardening: operators and counts never spliced into SQL
 * text, identifiers quoted in the JSON/array helpers, a cast suffix limited to
 * type names, page-size ceilings, keyset chunking and parameter-bounded bulk
 * inserts.
 */
describe("PostgreSQL builder hardening", () => {
  let dataSource: DataSource;
  let driver: any;

  class Post {
    public static table = "posts";
    public static primaryKey = "id";
  }

  beforeEach(() => {
    driver = createMockDriver("postgres");
    driver.dialect = new PostgresDialect();
    driver.query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    dataSource = new DataSource({ name: "test", driver, isDefault: true });
    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.restoreAllMocks();
  });

  function builder(table = "authors"): PostgresQueryBuilder<any> {
    const query = new PostgresQueryBuilder<any>(table, dataSource);
    query.relationDefinitions = {
      posts: { type: "hasMany", model: Post, foreignKey: "author_id", localKey: "id" },
    };
    query.modelClass = { name: "Author", primaryKey: "id" };
    return query;
  }

  describe("has(relation, operator, count)", () => {
    it("binds the count and keeps the comparison in parentheses", () => {
      const { query, bindings } = builder().has("posts", ">", 2).parse();

      expect(query).toContain(
        `((SELECT COUNT(*) FROM "posts" WHERE "posts"."author_id" = "authors"."id") > $1)`,
      );
      expect(bindings).toEqual([2]);
    });

    it("accepts a digit-string count from a query string", () => {
      expect(
        builder()
          .has("posts", ">=", "3" as never)
          .parse().bindings,
      ).toEqual([3]);
    });

    it("refuses an injected count", () => {
      expect(() =>
        builder()
          .has("posts", ">=", "0 OR true" as never)
          .parse(),
      ).toThrow(/count/);
    });

    it("refuses an injected operator", () => {
      expect(() =>
        builder()
          .has("posts", "OR 1=1 --" as never, 1)
          .parse(),
      ).toThrow(/comparison operator/);
    });

    it("keeps an orWhereHas inside the user group, under the scopes", () => {
      const query = builder();
      query.pendingGlobalScopes = new Map([
        ["tenant", { callback: (q: any) => q.where("tenantId", 7), timing: "before" }],
      ]) as never;

      const { query: sql } = query
        .where("active", true)
        .orWhereHas("posts", (q: any) => q.where("pinned", true))
        .parse();

      // (tenant) AND (active OR EXISTS ...): the OR cannot reach other tenants.
      expect(sql).toMatch(
        /WHERE \("authors"\."tenantId" = \$1\) AND \("authors"\."active" = \$2 OR EXISTS \(SELECT 1 FROM "posts"/,
      );
    });
  });

  describe("having() on an aggregate alias", () => {
    it("refuses an operator outside the comparison set", () => {
      const query = builder().groupBy("status", { total: $agg.count() });

      expect(() => query.having("total", "OR 1=1 --" as never, 1).parse()).toThrow(
        /comparison operator/,
      );
    });
  });

  describe("JSON and array helpers", () => {
    const sqlOf = (query: PostgresQueryBuilder<any>) => query.parse().query;

    it("quotes the path of whereJsonContainsKey", () => {
      expect(sqlOf(builder().whereJsonContainsKey('x" IS NOT NULL OR true --'))).toContain(
        `WHERE "x"" IS NOT NULL OR true --" IS NOT NULL`,
      );
      expect(sqlOf(builder().whereJsonContainsKey("profile.avatar"))).toContain(
        `WHERE "profile"->'avatar' IS NOT NULL`,
      );
    });

    it("walks dot and arrow paths with escaped keys", () => {
      expect(sqlOf(builder().whereJsonIsArray("profile.roles"))).toContain(
        `jsonb_typeof("profile"->'roles') = 'array'`,
      );
      expect(sqlOf(builder().whereJsonIsObject("settings->'theme'"))).toContain(
        `jsonb_typeof("settings"->'theme') = 'object'`,
      );
      expect(sqlOf(builder().whereJsonIsObject("settings->a'b"))).toContain(
        `jsonb_typeof("settings"->'a''b') = 'object'`,
      );
      expect(sqlOf(builder().whereJsonIsObject("meta.x' OR '1'='1"))).toContain(
        `jsonb_typeof("meta"->'x'' OR ''1''=''1') = 'object'`,
      );
    });

    it("keeps a leading table name or alias of the query as table.column", () => {
      // The base table.
      expect(sqlOf(builder().whereJsonContainsKey("authors.meta"))).toContain(
        `WHERE "authors"."meta" IS NOT NULL`,
      );
      expect(sqlOf(builder().whereJsonIsObject("authors.meta.theme"))).toContain(
        `jsonb_typeof("authors"."meta"->'theme') = 'object'`,
      );
      expect(sqlOf(builder().whereJsonIsObject("authors.meta->theme"))).toContain(
        `jsonb_typeof("authors"."meta"->'theme') = 'object'`,
      );

      // A joined table, even when the join is added after the helper.
      const joined = builder()
        .whereJsonContainsKey("comments.meta")
        .whereJsonLength("comments.meta.tags", ">", 1)
        .join("comments", "authors.id", "comments.author_id");

      expect(sqlOf(joined)).toContain(`"comments"."meta" IS NOT NULL`);
      expect(sqlOf(joined)).toContain(`jsonb_array_length("comments"."meta"->'tags') > $1`);

      // Inside a condition group (global scopes wrap user conditions in one).
      const grouped = builder()
        .join("comments", "authors.id", "comments.author_id")
        .where((query: any) => query.whereJsonContainsKey("comments.meta"));

      expect(sqlOf(grouped)).toContain(`("comments"."meta" IS NOT NULL)`);

      // A join alias.
      const aliased = builder()
        .join({ table: "comments", alias: "c", localField: "id", foreignField: "author_id" })
        .whereJsonIsArray("c.meta.tags");

      expect(sqlOf(aliased)).toContain(`jsonb_typeof("c"."meta"->'tags') = 'array'`);

      // `selectJson` resolves the same way.
      expect(sqlOf(builder().selectJson("authors.meta.theme", "theme"))).toContain(
        `"authors"."meta"->>'theme' AS "theme"`,
      );
    });

    it("quotes and escapes the path inside a where() callback too", () => {
      const query = builder().where((group: any) =>
        group.whereJsonContainsKey('x" IS NOT NULL OR true --').whereJsonIsArray("meta.x' OR '1"),
      );

      expect(sqlOf(query)).toContain(
        `("x"" IS NOT NULL OR true --" IS NOT NULL AND jsonb_typeof("meta"->'x'' OR ''1') = 'array')`,
      );
      expect(() =>
        builder().where((group: any) => group.whereJsonLength("tags", "; DROP" as never, 1)),
      ).toThrow(/comparison operator/);
    });

    it("reads a first segment that is not a table or alias as the column", () => {
      // "comments" is a column here: the query joins no such table.
      expect(sqlOf(builder().whereJsonContainsKey("comments.meta"))).toContain(
        `WHERE "comments"->'meta' IS NOT NULL`,
      );
    });

    it("whitelists the operator of whereJsonLength / whereArrayLength", () => {
      expect(() => builder().whereArrayLength("tags", "> 0 OR 1=1 --" as never, 1)).toThrow(
        /comparison operator/,
      );
      expect(() => builder().whereJsonLength("tags", "; DROP" as never, 1)).toThrow(
        /comparison operator/,
      );
      expect(sqlOf(builder().whereArrayLength("roles", ">=", 2))).toContain(
        `array_length("roles", 1) >= $1`,
      );
      expect(sqlOf(builder().whereArrayLength("authors.roles", ">=", 2))).toContain(
        `array_length("authors"."roles", 1) >= $1`,
      );
      expect(sqlOf(builder().whereJsonLength("tags", ">", 3))).toContain(
        `jsonb_array_length("tags") > $1`,
      );
    });

    it("escapes selectJson keys and quotes the column", () => {
      const { query } = builder().selectJson("meta->x') FROM users --", "v").parse();

      expect(query).toContain(`"meta"->>'x'') FROM users --' AS "v"`);
    });

    it("whitelists the selectAggregate function and quotes selectExists", () => {
      expect(() => builder().selectAggregate("price", "sum) FROM x --" as never, "t")).toThrow(
        /unsupported aggregate/,
      );
      expect(builder().selectExists("deleted_at", "gone").parse().query).toContain(
        `"deleted_at" IS NOT NULL AS "gone"`,
      );
    });
  });

  describe("::cast suffix", () => {
    const parse = (operations: unknown[]) =>
      new PostgresQueryParser({
        table: "users",
        operations: operations as PostgresParserOperation[],
      }).parse();

    it("refuses boolean operators smuggled in as a type", () => {
      expect(() =>
        parse([
          {
            type: "where",
            data: { field: "email::text is not null or true or email", operator: "=", value: 1 },
          },
        ]),
      ).toThrow(/unsafe cast type/);
      expect(() =>
        parse([{ type: "where", data: { field: "a::int or true", operator: "=", value: 1 } }]),
      ).toThrow(/unsafe cast type/);
    });

    it("keeps multi-word and custom type names", () => {
      const { query } = parse([
        { type: "where", data: { field: "a::double precision", operator: "=", value: 1 } },
        { type: "where", data: { field: "b::character varying(20)", operator: "=", value: 1 } },
        { type: "where", data: { field: "c::my_enum", operator: "=", value: 1 } },
      ]);

      expect(query).toContain(`::double precision`);
      expect(query).toContain(`::character varying(20)`);
      expect(query).toContain(`::my_enum`);
    });
  });

  describe("paginate()", () => {
    it("caps the page size at maxLimit (default 1000)", async () => {
      vi.spyOn(PostgresQueryBuilder.prototype, "count").mockResolvedValue(0);

      const result = await builder().paginate({ limit: 1e7 });

      expect(result.pagination.limit).toBe(1000);
      expect(driver.query.mock.calls[0][0]).toContain("LIMIT 1000");
      expect((await builder().paginate({ limit: 5000, maxLimit: Infinity })).pagination.limit).toBe(
        5000,
      );
    });

    it("refuses a non-numeric limit", async () => {
      await expect(builder().paginate({ limit: "abc" as never })).rejects.toThrow(/whole number/);
    });
  });

  describe("chunk()", () => {
    it("pages by primary key instead of OFFSET when the query is unordered", async () => {
      driver.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });
      const query = builder().lean();
      const seen: unknown[] = [];

      await query.where("active", true).chunk(2, (rows) => {
        seen.push(...rows.map((row: any) => row.id));
      });

      expect(seen).toEqual([1, 2, 3]);
      const [first, second] = driver.query.mock.calls.map((call: unknown[]) => call);
      expect(first[0]).toBe(
        `SELECT * FROM "authors" WHERE "authors"."active" = $1 ORDER BY "authors"."id" ASC LIMIT 2`,
      );
      expect(second[0]).toBe(
        `SELECT * FROM "authors" WHERE "authors"."active" = $1 AND "authors"."id" > $2 ORDER BY "authors"."id" ASC LIMIT 2`,
      );
      expect(second[1]).toEqual([true, 2]);
    });

    it("keeps OFFSET paging for another order", async () => {
      driver.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await builder()
        .lean()
        .orderBy("name")
        .chunk(2, () => undefined);

      expect(driver.query.mock.calls[1][0]).toContain("OFFSET 2");
    });
  });
});

describe("PostgresDriver.insertMany", () => {
  function createDriver() {
    const query = vi.fn(async (_sql: string, params: unknown[]) => ({
      rows: params.map((value) => ({ value })),
      rowCount: params.length,
    }));
    const driver = new PostgresDriver({ database: "test" });
    (driver as unknown as { _pool: { query: typeof query } })._pool = { query };

    return { driver, query };
  }

  it("serializes each document once", async () => {
    const { driver } = createDriver();
    const serialize = vi.spyOn(driver, "serialize");

    await driver.insertMany("items", [{ a: 1 }, { a: 2 }, { b: 3 }]);

    expect(serialize).toHaveBeenCalledTimes(3);
  });

  it("splits a batch over the 65,535-parameter limit into several statements", async () => {
    const { driver, query } = createDriver();
    const transaction = vi
      .spyOn(driver, "transaction")
      .mockImplementation(async (fn: any) => fn({}));
    const documents = Array.from({ length: 70_000 }, (_, index) => ({ value: index }));

    const rows = await driver.insertMany("items", documents);

    expect(query).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(70_000);
    expect(query.mock.calls[0]![1] as unknown[]).toHaveLength(65_535);
  });

  it("keeps a small batch in one statement without a transaction", async () => {
    const { driver, query } = createDriver();
    const transaction = vi.spyOn(driver, "transaction");

    await driver.insertMany("items", [{ a: 1 }, { a: 2 }]);

    expect(query).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });
});
