import { describe, expect, it } from "vitest";
import { MongoQueryBuilder } from "./mongodb-query-builder";

function query() {
  const dataSource: any = {
    driver: { database: { collection: () => ({}) }, likeLimits: undefined },
    relationDefaults: undefined,
  };

  return new MongoQueryBuilder<any>("shipments", dataSource);
}

const matchOf = (builder: MongoQueryBuilder<any>) =>
  (builder.parse().query as unknown as any[]).find((stage) => stage.$match)?.$match;

describe("whereContains (MongoDB)", () => {
  it("builds a case-insensitive regex of the escaped value", () => {
    expect(matchOf(query().whereContains("title", "a.b*(c)%_"))).toEqual({
      title: { $regex: "a\\.b\\*\\(c\\)%_", $options: "i" },
    });
  });

  it("has an OR variant", () => {
    const match = matchOf(query().where("status", "open").orWhereContains("title", "x"));

    expect(match).toEqual({ $or: [{ status: "open" }, { title: { $regex: "x", $options: "i" } }] });
  });
});

describe("full-text options (MongoDB)", () => {
  it("accepts and ignores language and weights", () => {
    const match = matchOf(query().whereSearch("title", "ship", { language: "simple" }));

    expect(match).toEqual({ $text: { $search: "ship" } });
  });
});
