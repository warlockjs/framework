import { describe, expect, it } from "vitest";
import { PostgresDialect, safeTextSearchConfig } from "./postgres-dialect";
import { PostgresDriver } from "./postgres-driver";
import { PostgresQueryBuilder } from "./postgres-query-builder";
import { PostgresSQLSerializer } from "./postgres-sql-serializer";

function queryFor(textSearchConfig?: string) {
  const driver = new PostgresDriver({ database: "test", textSearchConfig });
  const dataSource: any = { driver, relationDefaults: undefined };

  return new PostgresQueryBuilder<any>("shipments", dataSource);
}

describe("PostgreSQL full-text search language", () => {
  it("uses the given language for both the vector and the query", () => {
    const { query, bindings } = queryFor().whereSearch("title", "الخامس", { language: "simple" }).parse();

    expect(query).toContain("to_tsvector('simple'");
    expect(query).toContain("plainto_tsquery('simple'");
    expect(query).not.toContain("english");
    expect(bindings).toEqual(["الخامس"]);
  });

  it("defaults to english", () => {
    const { query } = queryFor().whereFullText(["title", "body"], "ship").parse();

    expect(query).toContain("to_tsvector('english'");
    expect(query).toContain("plainto_tsquery('english'");
  });

  it("uses the data source default when no language is given", () => {
    const { query } = queryFor("simple").whereFullText("title", "ship").parse();

    expect(query).toContain("to_tsvector('simple'");
    expect(query).toContain("plainto_tsquery('simple'");
  });

  it("lets a call override the data source default", () => {
    const { query } = queryFor("simple")
      .whereFullText("title", "ship", { language: "german" })
      .parse();

    expect(query).toContain("to_tsvector('german'");
  });

  it("applies the language and weights to orWhereFullText", () => {
    const { query } = queryFor()
      .where("status", "open")
      .orWhereFullText(["title", "body"], "ship", {
        language: "simple",
        weights: { body: "B" },
      })
      .parse();

    expect(query).toContain(" OR ");
    expect(query).toContain("setweight(to_tsvector('simple', COALESCE(\"title\", '')), 'A')");
    expect(query).toContain("setweight(to_tsvector('simple', COALESCE(\"body\", '')), 'B')");
  });

  it("never lets a language inject SQL", () => {
    const { query } = queryFor()
      .whereFullText("title", "x", { language: "simple'); DROP TABLE users; --" })
      .parse();

    expect(query).toContain("to_tsvector('english'");
    expect(query).not.toContain("DROP");
  });

  it("uses the data source default in textSearch()", () => {
    const { query } = queryFor("simple").textSearch("ship").parse();

    expect(query).toContain("to_tsvector('simple'");
  });

  it("validates the configuration name", () => {
    expect(safeTextSearchConfig("simple")).toBe("simple");
    expect(safeTextSearchConfig("pg_catalog.simple")).toBe("english");
    expect(safeTextSearchConfig(undefined, "simple")).toBe("simple");
    expect(new PostgresDialect({ textSearchConfig: "x'y" }).textSearchConfig).toBe("english");
  });
});

describe("createFullTextIndex uses the same default", () => {
  const index = (dialect: PostgresDialect, language?: string) =>
    new PostgresSQLSerializer(dialect).serialize(
      {
        type: "createFullTextIndex",
        payload: { columns: ["title"], options: language ? { language } : undefined },
      } as never,
      "shipments",
    );

  it("falls back to english", () => {
    expect(JSON.stringify(index(new PostgresDialect()))).toContain("to_tsvector('english'");
  });

  it("falls back to the data source default, so the index matches the query", () => {
    const dialect = new PostgresDialect({ textSearchConfig: "simple" });

    expect(JSON.stringify(index(dialect))).toContain("to_tsvector('simple', COALESCE(");
    expect(JSON.stringify(index(dialect, "german"))).toContain("to_tsvector('german'");
  });
});

describe("whereContains (PostgreSQL)", () => {
  it("emits an escaped ILIKE with an ESCAPE clause", () => {
    const { query, bindings } = queryFor().whereContains("title", "50%_off\\x").parse();

    expect(query).toContain('"title" ILIKE $1 ESCAPE');
    expect(bindings).toEqual(["%50\\%\\_off\\\\x%"]);
  });

  it("has an OR variant", () => {
    const { query } = queryFor().where("a", 1).orWhereContains("title", "x").parse();

    expect(query).toContain(' OR "shipments"."title" ILIKE');
  });
});
