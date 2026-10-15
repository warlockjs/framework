import { describe, expect, it } from "vitest";
import { FilterApplicator } from "./filter-applicator";

/** Records builder calls; callbacks run against a nested recorder. */
function recorder() {
  const calls: any[] = [];
  const make = (log: any[]): any =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (...args: any[]) => {
          log.push([
            method,
            ...args.map((arg) => {
              if (typeof arg !== "function") return arg;
              const nested: any[] = [];
              arg(make(nested));
              return nested;
            }),
          ]);
          return make(log);
        },
      },
    );

  return { query: make(calls), calls };
}

describe("FilterApplicator multi-column filters", () => {
  it("groups a multi-column like search so it ANDs with an org_id filter", () => {
    const { query, calls } = recorder();

    new FilterApplicator().apply(
      query,
      { org_id: "=", search: ["like", ["name", "email"]] } as any,
      { org_id: 5, search: "%acme%" },
      {} as any,
    );

    expect(calls).toEqual([
      ["where", "org_id", 5],
      [
        "where",
        [
          ["where", [["where", "name", "like", "%acme%"]]],
          ["orWhere", [["where", "email", "like", "%acme%"]]],
        ],
      ],
    ]);
    expect(calls.some(([method]) => method === "orWhere")).toBe(false);
  });
});

describe("FilterApplicator value handling", () => {
  const run = (rules: any, values: any, options: any = {}) => {
    const { query, calls } = recorder();
    new FilterApplicator().apply(query, rules, values, options);
    return calls;
  };

  it("wraps a plain like value so it is a contains match on every driver", () => {
    expect(run({ name: "like" }, { name: "john" })).toEqual([["whereLike", "name", "%john%"]]);
  });

  it("supports startsWith and endsWith", () => {
    expect(run({ name: "startsWith" }, { name: "jo" })).toEqual([["whereLike", "name", "jo%"]]);
    expect(run({ name: "endsWith" }, { name: "hn" })).toEqual([["whereLike", "name", "%hn"]]);
  });

  it("parses dates with the declared format", () => {
    const calls = run({ created: "date" }, { created: "24-09-2026" }, { dateFormat: "DD-MM-YYYY" });
    const date = calls[0][2] as Date;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 24]);
  });

  it("rejects invalid dates and integers with a 400 instead of a 500", () => {
    expect(() => run({ created: "date" }, { created: "nope" }, { dateFormat: "DD-MM-YYYY" })).toThrow(
      expect.objectContaining({ name: "BadRequestError" }),
    );
    expect(() => run({ x: "int" }, { x: "abc" })).toThrow(
      expect.objectContaining({ name: "BadRequestError" }),
    );
  });
});
