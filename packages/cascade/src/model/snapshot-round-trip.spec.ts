import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { MongoDbDriver } from "../drivers/mongodb/mongodb-driver";
import { PostgresDriver } from "../drivers/postgres/postgres-driver";
import { Model } from "./model";

class Product extends Model<any> {
  public static table = "products";
  public static schema = v.object({
    name: v.object({ en: v.string(), ar: v.string() }),
    tags: v.array(v.string()).default([]),
    seoNote: v.string().optional(),
    publishedAt: v.date().optional(),
  });
}

const row = () => ({
  id: 7,
  name: { en: "Tea", ar: "tea-ar" },
  tags: ["hot", "drink"],
  meta: { nested: { list: [1, { deep: true }], flag: false } },
  scores: [1, 2, 3],
  emptyList: [],
  publishedAt: new Date("2024-05-01T10:00:00.000Z"),
  createdAt: new Date("2024-05-02T10:00:00.000Z"),
  note: null,
  label: "2024-05-01T10:00:00.000Z",
});

const drivers: Array<[string, () => unknown]> = [
  ["postgres", () => new PostgresDriver({ database: "test" })],
  ["mongodb", () => new MongoDbDriver({ database: "test" } as never)],
];

describe.each(drivers)("model snapshot round trip (%s)", (_name, makeDriver) => {
  beforeEach(() => {
    dataSourceRegistry.clear();
    dataSourceRegistry.register(
      new DataSource({ name: "snap", driver: makeDriver() as never, isDefault: true }),
    );
  });

  it("rebuilds a model equal to the one the database returned", () => {
    const original = Product.hydrate(row());
    const rebuilt = Product.fromSnapshot(original.toSnapshot());

    expect(rebuilt.data).toEqual(original.data);
    expect(rebuilt.get("name")).toEqual({ en: "Tea", ar: "tea-ar" });
    expect(rebuilt.get("tags")).toEqual(["hot", "drink"]);
    expect(rebuilt.get("meta")).toEqual({ nested: { list: [1, { deep: true }], flag: false } });
    expect(rebuilt.get("scores")).toEqual([1, 2, 3]);
    expect(rebuilt.get("emptyList")).toEqual([]);
    expect(rebuilt.get("note")).toBeNull();
    expect(rebuilt.get("publishedAt")).toBeInstanceOf(Date);
    expect(rebuilt.get("createdAt")).toBeInstanceOf(Date);
    expect((rebuilt.get("createdAt") as Date).toISOString()).toBe("2024-05-02T10:00:00.000Z");
    expect(rebuilt.get("label")).toBe("2024-05-01T10:00:00.000Z");
    expect(rebuilt.isNew).toBe(false);
  });

  it("keeps plain values in the snapshot and survives a JSON trip", () => {
    const snapshot = Product.hydrate(row()).toSnapshot();

    expect(snapshot.data.name).toEqual({ en: "Tea", ar: "tea-ar" });
    expect(snapshot.data.tags).toEqual(["hot", "drink"]);
    expect(snapshot.data.publishedAt).toBe("2024-05-01T10:00:00.000Z");

    const rebuilt = Product.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));

    expect(rebuilt.data).toEqual(Product.hydrate(row()).data);
  });

  it("loads a snapshot an earlier version stored with JSON text columns", () => {
    const legacy = {
      data: {
        id: 7,
        name: '{"en":"Tea","ar":"tea-ar"}',
        tags: '["hot","drink"]',
        seoNote: '{"not":"parsed because the schema says string"}',
      },
      relations: {},
    };

    const rebuilt = Product.fromSnapshot(legacy);

    expect(rebuilt.get("name")).toEqual({ en: "Tea", ar: "tea-ar" });
    expect(rebuilt.get("tags")).toEqual(["hot", "drink"]);
    expect(rebuilt.get("seoNote")).toBe('{"not":"parsed because the schema says string"}');
  });
});
