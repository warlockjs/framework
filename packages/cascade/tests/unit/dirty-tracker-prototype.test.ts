import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DatabaseDirtyTracker } from "../../src/database-dirty-tracker";
import { dataSourceRegistry } from "../../src/data-source/data-source-registry";
import { Model } from "../../src/model/model";
import { SqlDatabaseDirtyTracker } from "../../src/sql-database-dirty-tracker";
import { createMockDriver } from "../utils/test-helpers";

/**
 * A reserved path segment (`__proto__`, `constructor`, `prototype`) or a
 * `__proto__` key inside merged data must never reach `Object.prototype`
 * through the dirty tracker or the model accessors.
 */

const probe = "cascadePollutionProbe";

function prototypeIsClean(): boolean {
  return !Object.prototype.hasOwnProperty.call(Object.prototype, probe);
}

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)[probe];
});

describe.each([
  ["DatabaseDirtyTracker", (data: Record<string, unknown>) => new DatabaseDirtyTracker(data)],
  ["SqlDatabaseDirtyTracker", (data: Record<string, unknown>) => new SqlDatabaseDirtyTracker(data)],
])("%s refuses prototype paths", (_name, create) => {
  it("refuses setAtPath through __proto__", () => {
    const tracker = create({ name: "a" });

    expect(() => tracker.setAtPath(`__proto__.${probe}`, true)).toThrow(/__proto__/);
    expect(prototypeIsClean()).toBe(true);
    expect(tracker.hasChanges()).toBe(false);
  });

  it("refuses setAtPath through constructor.prototype", () => {
    const tracker = create({ name: "a" });

    expect(() => tracker.setAtPath(`constructor.prototype.${probe}`, true)).toThrow(/constructor/);
    expect(prototypeIsClean()).toBe(true);
  });

  it("refuses a merge carrying a __proto__ key, at any depth", () => {
    const tracker = create({ name: "a", profile: { bio: "x" } });

    expect(() => tracker.mergeChanges(JSON.parse(`{"__proto__":{"${probe}":true}}`))).toThrow(
      /__proto__/,
    );
    expect(() =>
      tracker.mergeChanges(JSON.parse(`{"profile":{"__proto__":{"${probe}":true}}}`)),
    ).toThrow(/profile\.__proto__/);
    expect(prototypeIsClean()).toBe(true);
    expect(tracker.hasChanges()).toBe(false);
  });

  it("refuses unset through __proto__ and leaves Object.prototype intact", () => {
    const tracker = create({ name: "a" });

    expect(() => tracker.unset("__proto__.hasOwnProperty")).toThrow(/__proto__/);
    expect(typeof Object.prototype.hasOwnProperty).toBe("function");
  });

  it("still merges data that merely has a constructor key", () => {
    const tracker = create({ id: 1, specs: { maker: "x" } });

    tracker.mergeChanges({ specs: { constructor: "Ford" } });

    expect(tracker.hasChanges()).toBe(true);
    expect(prototypeIsClean()).toBe(true);
  });
});

describe("Model accessors refuse prototype paths", () => {
  beforeAll(() => {
    dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  class Account extends Model {
    public static table = "accounts";
  }

  function loaded() {
    const account = new Account({ id: 1, name: "a" });
    account.isNew = false;
    return account;
  }

  it("refuses set() with a dotted __proto__ key from a request body", () => {
    const account = loaded();

    expect(() => account.set(JSON.parse(`{"name":"b","__proto__.${probe}":true}`))).toThrow(
      /__proto__/,
    );
    expect(prototypeIsClean()).toBe(true);
    // All or nothing: the valid key was not written either.
    expect(account.get("name")).toBe("a");
    expect(account.hasChanges()).toBe(false);
  });

  it("refuses set(field, value) with a reserved segment", () => {
    const account = loaded();

    expect(() => account.set(`__proto__.${probe}`, true)).toThrow(/__proto__/);
    expect(() => account.set("prototype", true)).toThrow(/prototype/);
    expect(prototypeIsClean()).toBe(true);
  });

  it("refuses merge() with a __proto__ key and leaves the data unchanged", () => {
    const account = loaded();

    expect(() => account.merge(JSON.parse(`{"name":"b","__proto__":{"${probe}":true}}`))).toThrow(
      /__proto__/,
    );
    expect(prototypeIsClean()).toBe(true);
    expect(account.get("name")).toBe("a");
  });

  it("refuses unset() with a reserved segment", () => {
    const account = loaded();

    expect(() => account.unset("__proto__.toString")).toThrow(/__proto__/);
    expect(typeof Object.prototype.toString).toBe("function");
  });
});
