import { describe, expect, it } from "vitest";
import type { FilterOptions, FilterRules } from "../../../src/repositories/contracts";
import { FilterApplicator } from "../../../src/repositories/adapters/cascade/filter-applicator";

/**
 * Unit coverage for the Cascade FilterApplicator — the previously untested
 * translator from repository filter rules to Cascade query-builder calls.
 *
 * A RecordingQuery captures every builder method the applicator touches so we
 * can assert on the SHAPE of the query without a live database. Only the
 * methods the applicator actually reaches for are implemented.
 *
 * Source: core/src/repositories/adapters/cascade/filter-applicator.ts
 */
class RecordingQuery {
  public calls: Array<{ method: string; args: unknown[] }> = [];

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });

    return this;
  }

  public where(...args: unknown[]) {
    return this.record("where", args);
  }

  public orWhere(...args: unknown[]) {
    return this.record("orWhere", args);
  }

  public whereIn(...args: unknown[]) {
    return this.record("whereIn", args);
  }

  public whereNotIn(...args: unknown[]) {
    return this.record("whereNotIn", args);
  }

  public whereNull(...args: unknown[]) {
    return this.record("whereNull", args);
  }

  public whereNotNull(...args: unknown[]) {
    return this.record("whereNotNull", args);
  }

  public whereDate(...args: unknown[]) {
    return this.record("whereDate", args);
  }

  public whereLike(...args: unknown[]) {
    return this.record("whereLike", args);
  }

  public scope(...args: unknown[]) {
    return this.record("scope", args);
  }

  public with(...args: unknown[]) {
    return this.record("with", args);
  }

  public similarTo(...args: unknown[]) {
    return this.record("similarTo", args);
  }

  /** The first recorded call to `method`, or undefined. */
  public callTo(method: string) {
    return this.calls.find((call) => call.method === method);
  }

  /** All recorded calls to `method`. */
  public callsTo(method: string) {
    return this.calls.filter((call) => call.method === method);
  }

  public get methodNames(): string[] {
    return this.calls.map((call) => call.method);
  }
}

const noOptions: FilterOptions = {};

function apply(filters: FilterRules, data: any, options: FilterOptions = noOptions) {
  const query = new RecordingQuery();
  new FilterApplicator().apply(query as any, filters, data, options);
  return query;
}

describe("FilterApplicator — value gating", () => {
  it("skips a filter whose value is undefined", () => {
    const query = apply({ status: "=" }, {});

    expect(query.calls).toHaveLength(0);
  });

  it("applies a filter whose value is explicitly false (not skipped)", () => {
    const query = apply({ isActive: "bool" }, { isActive: false });

    expect(query.callTo("where")?.args).toEqual(["isActive", false]);
  });
});

describe("FilterApplicator — boolean coercion", () => {
  it("coerces truthy string/number forms to true", () => {
    for (const value of ["true", true, 1, "1"]) {
      const query = apply({ flag: "boolean" }, { flag: value });
      expect(query.callTo("where")?.args).toEqual(["flag", true]);
    }
  });

  it("coerces falsy string/number forms to false (no isEmpty inversion)", () => {
    for (const value of ["false", false, 0, "0"]) {
      const query = apply({ flag: "bool" }, { flag: value });
      // Regression: the old `|| !isEmpty(value)` fallback turned false/0 into true.
      expect(query.callTo("where")?.args).toEqual(["flag", false]);
    }
  });

  it("maps a boolean over multiple columns to an orWhere object", () => {
    const query = apply({ flag: ["bool", ["a", "b"]] }, { flag: 0 });

    expect(query.callTo("orWhere")?.args).toEqual([{ a: false, b: false }]);
  });
});

describe("FilterApplicator — numeric filters", () => {
  it("int parses the value to an integer equality", () => {
    const query = apply({ age: "int" }, { age: "42" });

    expect(query.callTo("where")?.args).toEqual(["age", 42]);
  });

  it("int comparison operators pass through", () => {
    const query = apply({ age: "int>=" }, { age: "18" });

    expect(query.callTo("where")?.args).toEqual(["age", ">=", 18]);
  });
});

describe("FilterApplicator — null filters", () => {
  it("null maps to whereNull", () => {
    const query = apply({ deletedAt: "null" }, { deletedAt: true });

    expect(query.callTo("whereNull")?.args).toEqual(["deletedAt"]);
  });

  it("notNull maps to whereNotNull", () => {
    const query = apply({ deletedAt: "notNull" }, { deletedAt: true });

    expect(query.callTo("whereNotNull")?.args).toEqual(["deletedAt"]);
  });
});

describe("FilterApplicator — date / datetime filters", () => {
  it("date maps to whereDate with a parsed Date", () => {
    const query = apply({ createdAt: "date" }, { createdAt: "2024-05-01" });

    const call = query.callTo("whereDate");
    expect(call?.args[0]).toBe("createdAt");
    expect(call?.args[1]).toBeInstanceOf(Date);
  });

  it("dateTime maps to a where equality with a parsed Date", () => {
    const query = apply({ createdAt: "dateTime" }, { createdAt: "2024-05-01 10:30:00" });

    const call = query.callTo("where");
    expect(call?.args[0]).toBe("createdAt");
    expect(call?.args[1]).toBeInstanceOf(Date);
  });

  it("passes a Date value through untouched", () => {
    const when = new Date("2024-01-01T00:00:00Z");
    const query = apply({ createdAt: "date" }, { createdAt: when });

    expect(query.callTo("whereDate")?.args[1]).toBe(when);
  });
});

describe("FilterApplicator — scope filter", () => {
  it("applies a scope using the filter key as the scope name", () => {
    const query = apply({ active: "scope" }, { active: true });

    expect(query.callTo("scope")?.args).toEqual(["active", true]);
  });

  it("applies a scope using a custom scope name", () => {
    const query = apply({ isAdmin: ["scope", "admin"] }, { isAdmin: "yes" });

    expect(query.callTo("scope")?.args).toEqual(["admin", "yes"]);
  });
});

describe("FilterApplicator — with (eager load) filter", () => {
  it("eager-loads a single named relation when the value is truthy", () => {
    const query = apply({ withModel: ["with", "ai_model"] }, { withModel: true });

    expect(query.callTo("with")?.args).toEqual(["ai_model"]);
  });

  it("does NOT eager-load when the value is falsy", () => {
    const query = apply({ withModel: ["with", "ai_model"] }, { withModel: false });

    expect(query.methodNames).not.toContain("with");
  });

  it("eager-loads multiple relations from the columns array", () => {
    const query = apply({ withAll: ["with", ["ai_model", "unit"]] }, { withAll: true });

    expect(query.callsTo("with").map((c) => c.args)).toEqual([["ai_model"], ["unit"]]);
  });
});

describe("FilterApplicator — similarTo (vector) filter", () => {
  it("calls similarTo with the column and embedding array", () => {
    const embedding = [0.1, 0.2, 0.3];
    const query = apply({ embedding: "similarTo" }, { embedding });

    expect(query.callTo("similarTo")?.args).toEqual(["embedding", embedding]);
  });

  it("ignores a non-array similarTo value", () => {
    const query = apply({ embedding: "similarTo" }, { embedding: "not-an-array" });

    expect(query.methodNames).not.toContain("similarTo");
  });
});

describe("FilterApplicator — custom function filter", () => {
  it("invokes a custom filter function with value, query, and data", () => {
    let received: { value: unknown; query: unknown; data: unknown } | undefined;

    const query = apply(
      {
        custom: (value, q, data) => {
          received = { value, query: q, data };
        },
      },
      { custom: "x", other: 1 },
    );

    expect(received?.value).toBe("x");
    expect(received?.query).toBe(query);
    expect(received?.data).toEqual({ custom: "x", other: 1 });
  });
});

describe("FilterApplicator — standard where operators", () => {
  it("'=' maps to a plain where", () => {
    const query = apply({ name: "=" }, { name: "Ada" });

    expect(query.callTo("where")?.args).toEqual(["name", "Ada"]);
  });

  it("'in' maps to whereIn, wrapping a scalar in an array", () => {
    const query = apply({ id: "in" }, { id: 5 });

    expect(query.callTo("whereIn")?.args).toEqual(["id", [5]]);
  });

  it("'like' maps to whereLike", () => {
    const query = apply({ email: "like" }, { email: "%@x.com" });

    expect(query.callTo("whereLike")?.args).toEqual(["email", "%@x.com"]);
  });
});
