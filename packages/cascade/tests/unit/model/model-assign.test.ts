import { v } from "@warlock.js/seal";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import type { ModelData } from "../../../src/model/model.types";
import { createMockDriver } from "../../utils/test-helpers";

const schema = v.object({
  name: v.string().required(),
  filters: v.object({ status: v.string(), owner: v.string() }).optional(),
  tags: v.array(v.string()).optional(),
});

class Report extends Model<ModelData<typeof schema>> {
  public static table = "reports";
  public static primaryKey = "id";
  public static schema = schema;
}

function loaded(data: Record<string, unknown>) {
  const report = new Report(data as any);
  report.isNew = false;
  return report;
}

const stored = () => ({
  id: 1,
  name: "Weekly",
  filters: { status: "open", owner: "ada" },
  tags: ["a", "b"],
});

beforeAll(() => {
  dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
});

afterAll(() => {
  dataSourceRegistry.clear();
});

describe("assign()", () => {
  it("replaces a nested object whole, so omitted keys are gone", () => {
    const report = loaded(stored());

    report.assign({ filters: { status: "closed" } as any });

    expect(report.get("filters")).toEqual({ status: "closed" });
  });

  it("leaves columns that are not named alone", () => {
    const report = loaded(stored());

    report.assign({ name: "Monthly" });

    expect(report.get("name")).toBe("Monthly");
    expect(report.get("filters")).toEqual({ status: "open", owner: "ada" });
    expect(report.get("tags")).toEqual(["a", "b"]);
  });

  it("marks the replaced column dirty and reports it as replaced", () => {
    const report = loaded(stored());

    report.assign({ filters: { status: "open" } as any });

    expect(report.getDirtyColumns().some((column) => column.startsWith("filters"))).toBe(true);
    expect(report.dirtyTracker.getReplacedColumns()).toEqual(["filters"]);
  });

  it("does not mark an unchanged column dirty", () => {
    const report = loaded(stored());

    report.assign({ name: "Weekly" });

    expect(report.hasChanges()).toBe(false);
  });

  it("behaves like set() for each key", () => {
    const viaAssign = loaded(stored());
    const viaSet = loaded(stored());

    viaAssign.assign({ filters: { status: "x" } as any, name: "N" });
    viaSet.set("filters", { status: "x" } as any).set("name", "N");

    expect(viaAssign.data).toEqual(viaSet.data);
    expect(viaAssign.getDirtyColumns()).toEqual(viaSet.getDirtyColumns());
  });

  it("drops identity columns on a persisted model, like merge()", () => {
    const report = loaded(stored());

    report.assign({ id: 999, _id: "x", name: "Monthly" } as any);

    expect(report.get("id")).toBe(1);
    expect(report.get("_id")).toBeUndefined();
    expect(report.get("name")).toBe("Monthly");
  });

  it("does not mutate the values it receives", () => {
    const report = loaded(stored());
    const body = { id: 999, name: "Monthly" };

    report.assign(body as any);

    expect(body).toEqual({ id: 999, name: "Monthly" });
  });

  it("keeps the id of a new model", () => {
    const report = new Report();

    report.assign({ id: 5, name: "Fresh" } as any);

    expect(report.get("id")).toBe(5);
  });

  it("returns the model", () => {
    const report = loaded(stored());

    expect(report.assign({ name: "x" })).toBe(report);
  });

  it("is typed like merge()", () => {
    const report = new Report();

    expectTypeOf(report.assign).parameters.toEqualTypeOf<Parameters<typeof report.merge>>();
    expectTypeOf(report.assign).returns.toEqualTypeOf<Report>();
  });
});

describe("merge() regression", () => {
  it("still deep-merges nested objects and keeps omitted keys", () => {
    const report = loaded(stored());

    report.merge({ filters: { status: "closed" } as any });

    expect(report.get("filters")).toEqual({ status: "closed", owner: "ada" });
  });
});
