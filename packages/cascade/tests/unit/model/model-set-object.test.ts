import { v } from "@warlock.js/seal";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import type { ModelData } from "../../../src/model/model.types";
import { createMockDriver } from "../../utils/test-helpers";

const schema = v.object({
  name: v.string().required(),
  filters: v.object({ status: v.string(), owner: v.string() }).optional(),
  settings: v.object({ theme: v.string(), lang: v.string() }).optional(),
  tags: v.array(v.string()).optional(),
});

class Report extends Model<ModelData<typeof schema>> {
  public static table = "reports";
  public static primaryKey = "id";
  public static schema = schema;
}

class LooseReport extends Model {
  public static table = "reports";
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
  settings: { theme: "light", lang: "en" },
  tags: ["a", "b"],
});

beforeAll(() => {
  dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
});

afterAll(() => {
  dataSourceRegistry.clear();
});

describe("set({ ... })", () => {
  it("replaces a nested object whole, so omitted keys are gone", () => {
    const report = loaded(stored());

    report.set({ filters: { status: "closed" } as any });

    expect(report.get("filters")).toEqual({ status: "closed" });
  });

  it("replaces arrays", () => {
    const report = loaded(stored());

    report.set({ tags: ["z"] });

    expect(report.get("tags")).toEqual(["z"]);
  });

  it("writes only the leaf for a dot-path key", () => {
    const report = loaded(stored());

    report.set({ "settings.theme": "dark" });

    expect(report.get("settings")).toEqual({ theme: "dark", lang: "en" });
  });

  it("mixes top-level and dot-path keys on different fields", () => {
    const report = loaded(stored());

    report.set({ name: "Monthly", filters: { status: "x" } as any, "settings.theme": "dark" });

    expect(report.get("name")).toBe("Monthly");
    expect(report.get("filters")).toEqual({ status: "x" });
    expect(report.get("settings")).toEqual({ theme: "dark", lang: "en" });
  });

  it("leaves columns that are not named alone", () => {
    const report = loaded(stored());

    report.set({ name: "Monthly" });

    expect(report.get("filters")).toEqual({ status: "open", owner: "ada" });
  });

  it("throws on overlapping keys and writes nothing", () => {
    const report = loaded(stored());

    expect(() =>
      report.set({
        name: "Monthly",
        settings: { theme: "x", lang: "y" },
        "settings.theme": "dark",
      }),
    ).toThrow(/"settings".*"settings\.theme"/);

    expect(report.data).toEqual(stored());
    expect(report.hasChanges()).toBe(false);
  });

  it("throws on overlapping dot paths regardless of key order", () => {
    const report = loaded(stored());

    expect(() => report.set({ "a.b.c": 1, "a.b": {} } as any)).toThrow(/"a\.b".*"a\.b\.c"/);
    expect(() => report.set({ "a.b": {}, "a.b.c": 1 } as any)).toThrow(/overlap/);
    expect(report.hasChanges()).toBe(false);
  });

  it("does not treat a shared name prefix as overlap", () => {
    const report = loaded(stored());

    report.set({ settings: { theme: "x", lang: "y" }, settings2: 1 } as any);

    expect(report.get("settings2" as any)).toBe(1);
  });

  it("drops identity columns on a persisted model", () => {
    const report = loaded(stored());

    report.set({ id: 999, _id: "x", name: "Monthly" } as any);

    expect(report.get("id")).toBe(1);
    expect(report.get("_id")).toBeUndefined();
    expect(report.get("name")).toBe("Monthly");
  });

  it("keeps the id of a new model", () => {
    const report = new Report();

    report.set({ id: 5, name: "Fresh" });

    expect(report.get("id")).toBe(5);
  });

  it("matches sequential single set() calls: same data, same dirty state", () => {
    const viaObject = loaded(stored());
    const viaSingle = loaded(stored());

    viaObject.set({ filters: { status: "x" } as any, name: "N", "settings.theme": "dark" });
    viaSingle
      .set("filters", { status: "x" } as any)
      .set("name", "N")
      .set("settings.theme", "dark");

    expect(viaObject.data).toEqual(viaSingle.data);
    expect(viaObject.getDirtyColumns()).toEqual(viaSingle.getDirtyColumns());
    expect(viaObject.dirtyTracker.getReplacedColumns()).toEqual(
      viaSingle.dirtyTracker.getReplacedColumns(),
    );
  });

  it("does not mark an unchanged column dirty", () => {
    const report = loaded(stored());

    report.set({ name: "Weekly" });

    expect(report.hasChanges()).toBe(false);
  });

  it("returns the model", () => {
    const report = loaded(stored());

    expect(report.set({ name: "x" })).toBe(report);
  });

  it("does not mutate the input", () => {
    const report = loaded(stored());
    const body = { id: 999, name: "Monthly", "settings.theme": "dark" };

    report.set(body as any);

    expect(body).toEqual({ id: 999, name: "Monthly", "settings.theme": "dark" });
  });

  it("rejects a non-object first argument", () => {
    const report = loaded(stored());

    expect(() => report.set(null as any)).toThrow(TypeError);
    expect(() => report.set([] as any)).toThrow(TypeError);
  });
});

describe("set() types", () => {
  it("checks each value against its key", () => {
    const report = new Report();

    // @ts-expect-error name is a string
    report.set({ name: 5 });
    report.set({ name: "ok", id: 3, createdAt: new Date() });
  });

  it("rejects an unknown key on a typed model", () => {
    const report = new Report();

    // @ts-expect-error unknown column
    report.set({ nope: 1 });
  });

  it("accepts a dot path with any value", () => {
    const report = new Report();

    report.set({ "settings.theme": "dark", "filters.deep.x": 1 });
  });

  it("accepts any key on a loose model", () => {
    new LooseReport().set({ anything: 1, "a.b": 2 });
  });

  it("leaves the single-key overloads unchanged", () => {
    const report = new Report();

    report.set("name", "x");
    report.set("settings.theme", 1);
    // @ts-expect-error wrong value type
    report.set("name", 5);
    // @ts-expect-error unknown column
    report.set("nope", 1);

    expectTypeOf(report.set).returns.toEqualTypeOf<Report>();
  });
});

describe("merge() regression", () => {
  it("still deep-merges nested objects and keeps omitted keys", () => {
    const report = loaded(stored());

    report.merge({ filters: { status: "closed" } as any });

    expect(report.get("filters")).toEqual({ status: "closed", owner: "ada" });
  });
});
