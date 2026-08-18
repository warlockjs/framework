import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../../src/drivers/mongodb/mongodb-query-builder";
import { UnsafeFilterError } from "../../../../src/errors/unsafe-filter.error";
import { UnsafeRawExpressionError } from "../../../../src/errors/unsafe-raw-expression.error";
import { deleteRecords } from "../../../../src/model/methods/delete-methods";
import {
  findAndReplaceRecord,
  findOneAndDeleteRecord,
  findOneAndUpdateRecord,
  performAtomic,
} from "../../../../src/model/methods/query-methods";
import { QueryBuilder } from "../../../../src/query-builder/query-builder";
import { escapeRegex, likePatternToRegexSource } from "../../../../src/utils/escape-regex";
import { createMockDriver } from "../../../helpers/mock-driver";

/**
 * Security regression tests.
 *
 * (a) NoSQL operator injection: equality-position values (`where(object)`,
 *     `where(field, value)`, filter-accepting statics) must reject smuggled
 *     `$`-prefixed operator keys such as `{ password: { $ne: null } }` — the
 *     classic auth-bypass primitive — while explicit operator APIs and plain
 *     equality/dotted/nested filters keep working.
 * (b) `$where` sink: string-mode `whereRaw()` used to compile to
 *     `{ $where: "<js>" }` (server-side JS execution). It must now throw;
 *     the object form (`{ $expr: … }`) must keep working.
 * (c) `$regex` injection / ReDoS: `whereLike` / `whereStartsWith` /
 *     `whereEndsWith` / `whereSearch` compiled their argument into `$regex`
 *     unescaped, handing a search box control of the regex engine inside
 *     `mongod`. String arguments must now be literals; only an explicit
 *     `RegExp` stays a pattern.
 */
describe("MongoQueryBuilder — filter security", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    const driver = createMockDriver("mongodb") as unknown as {
      database: { collection: (name: string) => unknown };
    };

    driver.database = {
      collection: (name: string) => ({ collectionName: name }),
    };

    dataSource = new DataSource({
      name: "test",
      driver: driver as never,
      isDefault: true,
    });

    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  function builder(table = "users"): MongoQueryBuilder {
    return new MongoQueryBuilder(table, dataSource);
  }

  describe("operator injection via where()", () => {
    it("rejects a $ne operator smuggled into an object-form equality value", () => {
      expect(() => builder().where({ password: { $ne: null } })).toThrow(UnsafeFilterError);
    });

    it("rejects a $gt operator smuggled into an object-form equality value", () => {
      expect(() => builder().where({ password: { $gt: "" } })).toThrow(UnsafeFilterError);
    });

    it("rejects a $-operator smuggled into a two-argument equality value", () => {
      expect(() => builder().where("password", { $ne: null })).toThrow(UnsafeFilterError);
    });

    it("rejects a $-operator smuggled into a three-argument '=' equality value", () => {
      expect(() => builder().where("password", "=", { $ne: null })).toThrow(UnsafeFilterError);
    });

    it("rejects a top-level $where key in an object-form filter", () => {
      expect(() => builder().where({ $where: "this.isAdmin" })).toThrow(UnsafeFilterError);
    });

    it("rejects operator keys nested deep inside an equality value", () => {
      expect(() => builder().where({ profile: { settings: { $where: "1" } } })).toThrow(
        UnsafeFilterError,
      );
    });

    it("rejects operator keys via orWhere()", () => {
      expect(() => builder().where("a", 1).orWhere({ token: { $ne: null } })).toThrow(
        UnsafeFilterError,
      );
    });

    it("reports the offending field and operator key", () => {
      try {
        builder().where({ password: { $ne: null } });
        expect.unreachable("where() should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UnsafeFilterError);
        expect((error as UnsafeFilterError).field).toBe("password");
        expect((error as UnsafeFilterError).operatorKey).toBe("$ne");
      }
    });

    it("still allows plain object-form equality filters", () => {
      const pipeline = builder().where({ name: "John", age: 25 }).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { name: "John", age: 25 } }]);
    });

    it("still allows the explicit operator API", () => {
      const pipeline = builder().where("age", ">", 18).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { age: { $gt: 18 } } }]);
    });

    it("still allows dotted field paths", () => {
      const pipeline = builder().where({ "profile.name": "Jane" }).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { "profile.name": "Jane" } }]);
    });

    it("still allows nested sub-document equality without operator keys", () => {
      const pipeline = builder().where("address", { city: "NY", zip: "10001" }).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { address: { city: "NY", zip: "10001" } } }]);
    });

    it("still allows Date values in equality position", () => {
      const createdAt = new Date("2026-01-01T00:00:00Z");
      const pipeline = builder().where("createdAt", createdAt).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { createdAt } }]);
    });

    it("still allows whereIn and the other dedicated operator methods", () => {
      const pipeline = builder().whereIn("id", [1, 2, 3]).parse().pipeline;

      expect(pipeline).toEqual([{ $match: { id: { $in: [1, 2, 3] } } }]);
    });
  });

  describe("whereRaw() $where sink", () => {
    it("throws for string-mode whereRaw instead of compiling to $where", () => {
      expect(() => builder().whereRaw("this.age > 18").parse()).toThrow(UnsafeRawExpressionError);
    });

    it("throws for string-mode whereRaw with bindings", () => {
      expect(() => builder().whereRaw("this.age > ?", [30]).parse()).toThrow(
        UnsafeRawExpressionError,
      );
    });

    it("throws for string-mode orWhereRaw", () => {
      expect(() => builder().where("a", 1).orWhereRaw("this.isAdmin").parse()).toThrow(
        UnsafeRawExpressionError,
      );
    });

    it("keeps the object/$expr form working", () => {
      const expression = { $expr: { $gt: ["$stock", "$reserved"] } };
      const pipeline = builder().whereRaw(expression).parse().pipeline;

      expect(pipeline).toEqual([{ $match: expression }]);
    });

    it("rejects $where in the object form of whereRaw", () => {
      expect(() => builder().whereRaw({ $where: "this.isAdmin === true" }).parse()).toThrow(
        UnsafeRawExpressionError,
      );
    });

    it("rejects $function nested inside an object-form raw expression", () => {
      expect(() =>
        builder()
          .whereRaw({
            $expr: { $function: { body: "function() { return true; }", args: [], lang: "js" } },
          })
          .parse(),
      ).toThrow(UnsafeRawExpressionError);
    });
  });

  describe("regex injection via pattern matching helpers", () => {
    /** The `$regex` source the first `$match` stage compiled for `field`. */
    function regexSourceOf(pipeline: any[], field = "name"): string {
      const condition = pipeline[0].$match[field];
      return (condition.$not ?? condition).$regex;
    }

    it("treats whereLike metacharacters as literals", () => {
      const pipeline = builder().whereLike("name", "a.b*c").parse().pipeline;

      expect(regexSourceOf(pipeline)).toBe("a\\.b\\*c");
    });

    it("does not compile a catastrophically backtracking pattern from a string", () => {
      const pipeline = builder().whereLike("name", "(a+)+$").parse().pipeline;
      const source = regexSourceOf(pipeline);

      expect(source).toBe("\\(a\\+\\)\\+\\$");

      // Nothing the caller typed is left acting as a quantifier or a group:
      // the compiled regex matches its own text and nothing else.
      const compiled = new RegExp(source);

      expect(compiled.test("(a+)+$")).toBe(true);
      expect(compiled.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    });

    it("neutralizes an anchored match-everything injection", () => {
      const pipeline = builder().whereLike("name", "^.*$").parse().pipeline;
      const compiled = new RegExp(regexSourceOf(pipeline));

      expect(compiled.test("Alice")).toBe(false);
      expect(compiled.test("^.*$")).toBe(true);
    });

    it("neutralizes an alternation injection", () => {
      const pipeline = builder().whereLike("name", "admin|root").parse().pipeline;
      const compiled = new RegExp(regexSourceOf(pipeline));

      expect(compiled.test("root")).toBe(false);
      expect(compiled.test("admin|root")).toBe(true);
    });

    it("keeps the documented % wildcard working", () => {
      const pipeline = builder().whereLike("email", "%@gmail.com").parse().pipeline;
      const source = regexSourceOf(pipeline, "email");

      expect(source).toBe(".*@gmail\\.com");
      expect(new RegExp(source).test("alice@gmail.com")).toBe(true);
      expect(new RegExp(source).test("alice@gmail-com")).toBe(false);
    });

    it("collapses a run of % into a single wildcard", () => {
      const pipeline = builder().whereLike("name", "%%%%%%%%%%a%%%%%%%%%%").parse().pipeline;

      expect(regexSourceOf(pipeline)).toBe(".*a.*");
    });

    it("keeps plain substring matching unchanged", () => {
      const pipeline = builder().whereLike("name", "ar").parse().pipeline;

      expect(pipeline).toEqual([{ $match: { name: { $regex: "ar", $options: "i" } } }]);
    });

    it("still honors an explicit RegExp as a pattern", () => {
      const pipeline = builder().whereLike("name", /^ali.e$/i).parse().pipeline;

      expect(regexSourceOf(pipeline)).toBe("^ali.e$");
    });

    it("escapes whereNotLike patterns too", () => {
      const pipeline = builder().whereNotLike("name", "a+b").parse().pipeline;

      expect(pipeline).toEqual([
        { $match: { name: { $not: { $regex: "a\\+b", $options: "i" } } } },
      ]);
    });

    it("escapes whereStartsWith while keeping the ^ anchor", () => {
      const pipeline = builder().whereStartsWith("name", ".*").parse().pipeline;

      expect(regexSourceOf(pipeline)).toBe("^\\.\\*");
    });

    it("escapes whereEndsWith while keeping the $ anchor", () => {
      const pipeline = builder().whereEndsWith("email", "ob@example.com").parse().pipeline;

      expect(regexSourceOf(pipeline, "email")).toBe("ob@example\\.com$");
    });

    it("escapes whereNotStartsWith and whereNotEndsWith", () => {
      const starts = builder().whereNotStartsWith("name", "(a+)+").parse().pipeline;
      const ends = builder().whereNotEndsWith("name", "(a+)+").parse().pipeline;

      expect(regexSourceOf(starts)).toBe("^\\(a\\+\\)\\+");
      expect(regexSourceOf(ends)).toBe("\\(a\\+\\)\\+$");
    });

    it("escapes a regex-mode whereSearch operation", () => {
      // `whereSearch()` compiles to $text on this builder; the $regex form of
      // the operation is still reachable through the parser, so it is pinned
      // here directly.
      const query = builder();

      query.operations.push({
        stage: "$match",
        mergeable: true,
        type: "whereSearch",
        data: { field: "name", query: "(a+)+$" },
      } as never);

      const pipeline = query.parse().pipeline;

      expect(pipeline).toEqual([
        { $match: { name: { $regex: "\\(a\\+\\)\\+\\$", $options: "i" } } },
      ]);
    });
  });

  describe("delete statics filter sanitization", () => {
    function fakeModelClass(deleteMany: ReturnType<typeof vi.fn>) {
      return {
        table: "users",
        getDriver: () => ({ deleteMany }),
      } as never;
    }

    it("rejects operator keys in a deleteMany filter", async () => {
      const deleteMany = vi.fn().mockResolvedValue(0);

      await expect(deleteRecords(fakeModelClass(deleteMany), { role: { $ne: "admin" } })).rejects.toThrow(
        UnsafeFilterError,
      );
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it("still forwards plain equality deleteMany filters", async () => {
      const deleteMany = vi.fn().mockResolvedValue(2);

      await expect(deleteRecords(fakeModelClass(deleteMany), { role: "member" })).resolves.toBe(2);
      expect(deleteMany).toHaveBeenCalledWith("users", { role: "member" });
    });
  });

  describe("atomic/find-and-modify statics filter sanitization", () => {
    function fakeModelClass(driver: Record<string, ReturnType<typeof vi.fn>>) {
      return {
        table: "users",
        getDriver: () => driver,
      } as never;
    }

    it("rejects operator keys in an atomic() filter", async () => {
      const atomic = vi.fn().mockResolvedValue({ modifiedCount: 0 });

      await expect(
        performAtomic(fakeModelClass({ atomic }), { role: { $ne: "admin" } }, { $inc: { age: 1 } }),
      ).rejects.toThrow(UnsafeFilterError);
      expect(atomic).not.toHaveBeenCalled();
    });

    it("forwards plain atomic() filters with the update operators untouched", async () => {
      const atomic = vi.fn().mockResolvedValue({ modifiedCount: 2 });

      await expect(
        performAtomic(fakeModelClass({ atomic }), { role: "member" }, { $inc: { age: 1 } }),
      ).resolves.toBe(2);
      expect(atomic).toHaveBeenCalledWith("users", { role: "member" }, { $inc: { age: 1 } });
    });

    it("rejects operator keys in a findOneAndUpdate() filter", async () => {
      const findOneAndUpdate = vi.fn().mockResolvedValue(null);

      await expect(
        findOneAndUpdateRecord(
          fakeModelClass({ findOneAndUpdate }),
          { password: { $ne: null } },
          { $set: { visited: true } },
        ),
      ).rejects.toThrow(UnsafeFilterError);
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("forwards plain findOneAndUpdate() filters with the update operators untouched", async () => {
      const findOneAndUpdate = vi.fn().mockResolvedValue(null);

      await expect(
        findOneAndUpdateRecord(
          fakeModelClass({ findOneAndUpdate }),
          { email: "a@b.c" },
          { $set: { visited: true } },
        ),
      ).resolves.toBeNull();
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        "users",
        { email: "a@b.c" },
        { $set: { visited: true } },
      );
    });

    it("rejects operator keys in a findAndReplace() filter", async () => {
      const replace = vi.fn().mockResolvedValue(null);

      await expect(
        findAndReplaceRecord(fakeModelClass({ replace }), { role: { $gt: "" } }, { name: "x" }),
      ).rejects.toThrow(UnsafeFilterError);
      expect(replace).not.toHaveBeenCalled();
    });

    it("rejects operator keys in a findOneAndDelete() filter", async () => {
      const findOneAndDelete = vi.fn().mockResolvedValue(null);

      await expect(
        findOneAndDeleteRecord(fakeModelClass({ findOneAndDelete }), { token: { $ne: null } }),
      ).rejects.toThrow(UnsafeFilterError);
      expect(findOneAndDelete).not.toHaveBeenCalled();
    });
  });
});

describe("QueryBuilder (base) — filter security", () => {
  it("rejects operator keys in object-form where()", () => {
    expect(() => new QueryBuilder().where({ password: { $ne: null } })).toThrow(UnsafeFilterError);
  });

  it("rejects operator keys in two-argument equality where()", () => {
    expect(() => new QueryBuilder().where("password", { $gt: "" })).toThrow(UnsafeFilterError);
  });

  it("rejects operator keys in three-argument '=' equality where()", () => {
    expect(() => new QueryBuilder().where("password", "=", { $ne: null })).toThrow(
      UnsafeFilterError,
    );
  });

  it("rejects operator keys in three-argument '=' equality orWhere()", () => {
    expect(() => new QueryBuilder().where("a", 1).orWhere("password", "=", { $ne: null })).toThrow(
      UnsafeFilterError,
    );
  });

  it("still records plain object-form equality operations", () => {
    const qb = new QueryBuilder().where({ role: "admin" });

    expect(qb.operations).toEqual([
      { type: "where", data: { field: "role", operator: "=", value: "admin" } },
    ]);
  });

  it("still records explicit operator operations", () => {
    const qb = new QueryBuilder().where("age", ">", 18);

    expect(qb.operations).toEqual([
      { type: "where", data: { field: "age", operator: ">", value: 18 } },
    ]);
  });

  it("records a string LIKE pattern without flagging it as a regex", () => {
    const qb = new QueryBuilder().whereLike("name", "(a+)+");

    expect(qb.operations).toEqual([
      { type: "whereLike", data: { field: "name", pattern: "(a+)+" } },
    ]);
  });

  it("flags an explicit RegExp so drivers keep pattern semantics", () => {
    const qb = new QueryBuilder().whereLike("name", /^ali.e$/i);

    expect(qb.operations).toEqual([
      { type: "whereLike", data: { field: "name", pattern: "^ali.e$", isRegExp: true } },
    ]);
  });

  it("routes whereStartsWith through the escaped LIKE path", () => {
    const qb = new QueryBuilder().whereStartsWith("name", "a.b");

    expect(qb.operations).toEqual([
      { type: "whereLike", data: { field: "name", pattern: "a.b%" } },
    ]);
  });
});

describe("escapeRegex / likePatternToRegexSource", () => {
  it("escapes every regex metacharacter", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(escapeRegex("alice smith")).toBe("alice smith");
  });

  it("makes an escaped pattern match only its own text", () => {
    const compiled = new RegExp(`^${escapeRegex("a.b")}$`);

    expect(compiled.test("a.b")).toBe(true);
    expect(compiled.test("axb")).toBe(false);
  });

  it("translates % to a wildcard and escapes the rest", () => {
    expect(likePatternToRegexSource("%a.b%")).toBe(".*a\\.b.*");
  });
});
