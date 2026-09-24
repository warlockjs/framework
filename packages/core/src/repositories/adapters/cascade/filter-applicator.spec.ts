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
